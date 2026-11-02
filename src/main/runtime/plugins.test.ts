import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const { home, config, parseSpy } = vi.hoisted(() => ({
  home: { dir: '' },
  config: { plugins: undefined as { enabled: string[] } | undefined },
  parseSpy: vi.fn(),
}))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => home.dir } }))
vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: () => ({ get: (key: string) => (key === 'plugins' ? config.plugins : undefined) }),
  },
}))
vi.mock('agent-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('agent-engine')>()
  return {
    ...actual,
    parsePlugin: (dir: string) => {
      parseSpy(dir)
      return actual.parsePlugin(dir)
    },
  }
})

import log from 'electron-log'
import { createMcpHost, fakeMcpServer, type AskRequest, type RunInfo } from 'agent-engine'
import { registerApprovalPort, sessionApprover } from './approval'
import {
  currentPlugins,
  HOOK_TIMEOUT_CAP_MS,
  loadPlugins,
  onPluginsChanged,
  pluginContribution,
  pluginHooks,
  pluginSkillRoots,
  pluginsDir,
  reloadPlugins,
} from './plugins'
import { createTalorVault } from './vault'
import { bindPluginHooks } from './engine'

/** 在 root 下建测试插件：p1（name alpha，全套组件）、p2（无 plugin.json、坏 skill）、p3（坏 skill）。 */
function writePlugins(root: string): void {
  const write = (path: string, text: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
  write(join(root, 'p1', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'alpha' }))
  write(
    join(root, 'p1', 'skills', 'review', 'SKILL.md'),
    '---\nname: review\ndescription: review code\n---\n# Review\nSee [ref](ref.md)\n',
  )
  write(
    join(root, 'p1', 'agents', 'checker.md'),
    '---\nname: checker\ndescription: checks\ntools: Read, Bash, WebFetch\n---\nCheck things.\n',
  )
  write(
    join(root, 'p1', 'agents', 'web.md'),
    '---\nname: web\ndescription: web\ntools: WebFetch\n---\nWeb.\n',
  )
  write(join(root, 'p1', 'agents', 'free.md'), '---\nname: free\ndescription: free\n---\nFree.\n')
  write(
    join(root, 'p1', '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        gh: { command: 'gh-mcp', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } },
        api: {
          type: 'http',
          url: 'https://api.example.com',
          headers: { Authorization: 'Bearer ${TOKEN}' },
        },
      },
    }),
  )
  write(
    join(root, 'p1', 'commands', 'review.md'),
    '---\ndescription: review\n---\nReview: $ARGUMENTS\n',
  )
  write(join(root, 'p2', 'skills', 'bad', 'SKILL.md'), '---\nname: bad\n---\nno description\n')
  write(join(root, 'p3', 'skills', 'bad', 'SKILL.md'), '---\nname: bad\n---\nno description\n')
}

let root: string

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'talor-plugins-'))
  root = join(home.dir, '.talor', 'plugins')
  writePlugins(root)
  parseSpy.mockClear()
  config.plugins = undefined
})

afterEach(() => {
  rmSync(home.dir, { recursive: true, force: true })
})

describe('loadPlugins', () => {
  it('B1 AC-006 parses only enabled plugins and isolates failures', async () => {
    const result = await loadPlugins(root, ['alpha', 'p3'])
    expect(result.plugins.map((p) => [p.name, p.dir])).toEqual([['alpha', join(root, 'p1')]])
    expect(result.plugins[0]!.parsed.skills.map((s) => s.name)).toEqual(['review'])
    expect(result.errors.map((e) => e.dir)).toEqual([join(root, 'p3')])
    expect(result.errors[0]!.message).toBeTruthy()
    expect(result.available.map((a) => a.name)).toEqual(['alpha', 'p2', 'p3'])
    expect(parseSpy.mock.calls.map((c) => c[0])).not.toContain(join(root, 'p2'))

    const missing = await loadPlugins(join(home.dir, 'nope'), ['alpha'])
    expect(missing).toEqual({ plugins: [], errors: [], available: [] })
  })

  it('B1 AC-006 resolves the plugin directory under the home', () => {
    expect(pluginsDir()).toBe(root)
  })
})

describe('reloadPlugins', () => {
  it('B1 AC-007 reloads from the config and notifies listeners until they unsubscribe', async () => {
    config.plugins = { enabled: ['alpha'] }
    const listener = vi.fn()
    const off = onPluginsChanged(listener)
    await reloadPlugins()
    expect(currentPlugins().map((p) => p.name)).toEqual(['alpha'])
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    await reloadPlugins()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('B1 keeps notifying other listeners when one throws', async () => {
    config.plugins = { enabled: [] }
    const offBad = onPluginsChanged(() => {
      throw new Error('bad listener')
    })
    const good = vi.fn()
    const offGood = onPluginsChanged(good)
    await reloadPlugins()
    expect(good).toHaveBeenCalledTimes(1)
    expect(currentPlugins()).toEqual([])
    offBad()
    offGood()
  })
})

describe('pluginContribution', () => {
  async function alpha() {
    return (await loadPlugins(root, ['alpha'])).plugins
  }

  it('B1 AC-009 prefixes skills and agents and maps agent tools', async () => {
    vi.mocked(log.warn).mockClear()
    const c = pluginContribution(await alpha())
    expect(c.skills!().map((s) => [s.metadata.name, s.filePath])).toEqual([
      ['alpha:review', join(root, 'p1', 'skills', 'review', 'SKILL.md')],
    ])
    const agents = new Map(c.agents!().map((a) => [a.profile.id, a]))
    expect(agents.get('alpha:checker')!.profile).toMatchObject({
      id: 'alpha:checker',
      tools: ['read', 'bash'],
      skills: ['alpha:review'],
      agentPrompt: 'Check things.',
    })
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).toContain('WebFetch')
    expect(agents.get('alpha:web')!.profile.tools).toEqual(['read'])
    expect(agents.get('alpha:free')!.profile).not.toHaveProperty('tools')
    expect(agents.get('alpha:checker')!.featureTools).toEqual([])
  })

  it('B1 AC-010 maps the plugin MCP servers to env references', async () => {
    const entries = pluginContribution(await alpha()).mcpEntries!()
    const gh = entries.find((e) => e.name === 'alpha:gh')!
    expect(gh).toMatchObject({ id: 'plugin:alpha:gh', name: 'alpha:gh', slug: 'plugin_alpha_gh' })
    expect(gh.spec).toMatchObject({
      name: 'plugin_alpha_gh',
      transport: {
        kind: 'stdio',
        command: 'gh-mcp',
        env: { GITHUB_TOKEN: { secret: 'env:GITHUB_TOKEN' } },
      },
      connectTimeoutMs: 60000,
      callTimeoutMs: 300000,
    })
    const api = entries.find((e) => e.name === 'alpha:api')!
    expect(api.spec).toMatchObject({
      transport: {
        kind: 'http',
        headers: { Authorization: { secret: 'env:TOKEN', template: 'Bearer ${env:TOKEN}' } },
      },
      connectTimeoutMs: 60000,
      callTimeoutMs: 300000,
    })
    expect(pluginContribution(await alpha()).commands!()).toEqual([
      {
        name: 'alpha:review',
        description: 'review',
        content: 'Review: $ARGUMENTS',
        source: 'plugin:alpha',
      },
    ])
  })

  it('B1 AC-012 resolves plugin MCP credentials when the engine connects', async () => {
    const entries = pluginContribution(await alpha()).mcpEntries!()
    const vault = createTalorVault({
      accountValue: (k) => ({ GITHUB_TOKEN: 'acc', TOKEN: 't0k' })[k],
      mcpServer: () => null,
      envValue: () => undefined,
    })
    const fake = fakeMcpServer({ tools: [{ name: 'ping' }] })
    const host = createMcpHost({ connect: fake.connect })
    const signal = new AbortController().signal
    for (const e of entries) (await host.acquire(e.spec, { vault, signal })).release()
    const transports = fake.connects.map((c) => c.transport) as Array<Record<string, unknown>>
    expect(transports.find((t) => t.kind === 'stdio')).toMatchObject({
      env: { GITHUB_TOKEN: 'acc' },
    })
    expect(transports.find((t) => t.kind === 'http')).toMatchObject({
      headers: { Authorization: 'Bearer t0k' },
    })
    await host.shutdown()
  })

  it('B1 AC-021 reads in enabled plugin skill directories without asking', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'talor-plugins-ws-'))
    try {
      const prompt = vi.fn(async () => ({ decision: 'rejected' as const }))
      const off = registerApprovalPort('s1', prompt as never)
      const run = {
        runId: 'r1',
        rootRunId: 'r1',
        environment: { name: 'interactive', principalReachable: true },
        agent: { id: 'talor__chat__' },
        task: { subject: 's1', scope: { workspace } },
      } as unknown as RunInfo
      // 引擎给审批人的是真实路径（macOS 的临时目录经 /private）
      const ref = join(realpathSync(join(root, 'p1', 'skills', 'review')), 'ref.md')
      const req = {
        callId: 'c1',
        toolName: 'read',
        summary: 'read 要访问工作区外的路径',
        risk: 'low',
        detail: { paths: [ref], reason: '不在工作区内' },
      } as AskRequest & { callId: string; toolName: string }

      config.plugins = { enabled: ['alpha'] }
      await reloadPlugins()
      expect(pluginSkillRoots()).toEqual([join(root, 'p1', 'skills')])
      expect(await sessionApprover.approve(req, run)).toEqual({ approved: true })
      expect(prompt).not.toHaveBeenCalled()

      config.plugins = { enabled: [] }
      await reloadPlugins()
      expect(await sessionApprover.approve(req, run)).toEqual({ approved: false })
      expect(prompt).toHaveBeenCalledTimes(1)
      off()
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('plugin hooks (B2)', () => {
  const hooksJson = (event: string, entries: Array<{ command: string; timeout?: number }>) =>
    JSON.stringify({
      hooks: {
        [event]: [{ hooks: entries.map((e) => ({ type: 'command', ...e })) }],
      },
    })

  function writeHooks(): void {
    mkdirSync(join(root, 'p1', 'hooks'), { recursive: true })
    writeFileSync(
      join(root, 'p1', 'hooks', 'hooks.json'),
      hooksJson('PreToolUse', [
        { command: 'a1', timeout: 60 },
        { command: 'a2', timeout: 20 },
      ]),
    )
    mkdirSync(join(root, 'p4', '.claude-plugin'), { recursive: true })
    writeFileSync(
      join(root, 'p4', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'beta' }),
    )
    mkdirSync(join(root, 'p4', 'hooks'), { recursive: true })
    writeFileSync(join(root, 'p4', 'hooks', 'hooks.json'), hooksJson('Stop', [{ command: 'b1' }]))
  }

  it('B2 AC-008 lists the hooks of enabled plugins and rebinds them on change', async () => {
    writeHooks()
    config.plugins = { enabled: ['alpha', 'beta'] }
    await reloadPlugins()
    expect(pluginHooks().map((h) => h.command)).toEqual(['a1', 'a2', 'b1'])

    const setHooks = vi.fn()
    const off = bindPluginHooks({ setHooks })
    await reloadPlugins()
    expect(setHooks).toHaveBeenCalledTimes(1)
    expect(setHooks.mock.calls[0]![0].map((h: { command: string }) => h.command)).toEqual([
      'a1',
      'a2',
      'b1',
    ])
    off()
    await reloadPlugins()
    expect(setHooks).toHaveBeenCalledTimes(1)
  })

  it('B2 AC-014 caps hook timeouts at 25 seconds with a warning', async () => {
    writeHooks()
    config.plugins = { enabled: ['alpha', 'beta'] }
    await reloadPlugins()
    vi.mocked(log.warn).mockClear()
    expect(pluginHooks().map((h) => h.timeoutMs)).toEqual([HOOK_TIMEOUT_CAP_MS, 20000, undefined])
    expect(HOOK_TIMEOUT_CAP_MS).toBe(25000)
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1)
    const warned = JSON.stringify(vi.mocked(log.warn).mock.calls)
    expect(warned).toContain('alpha')
    expect(warned).toContain('PreToolUse')
  })
})
