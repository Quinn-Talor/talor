import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const { home } = vi.hoisted(() => ({ home: { dir: '' } }))

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => home.dir } }))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: () => undefined }) },
}))

import log from 'electron-log'
import {
  createHookRunner,
  createMcpHost,
  defineTask,
  fakeMcpServer,
  fakeModel,
  memoryArchive,
  modelHub,
  type Approver,
  type FakeReply,
  type HookExecResult,
  type HookSpec,
  type McpHost,
} from 'agent-engine'
import type { AgentProfile } from '@shared/types/agent'
import type { PermissionRequest, PermissionResponse } from '@shared/types/permissions'
import { permissionStore } from '../permissions/permission-store'
import type { MCPServer } from '../repos/mcp-server-repo'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import { agentFor } from './agents'
import { approvalTargetsOf, createSessionApprover, registerApprovalPort } from './approval'
import { catalogSnapshot, type CatalogAgent } from './catalog'
import { createRuntime, interactiveEnvironment } from './engine'
import { claudeToolView, HOOK_ASK_REASON, markHookAsks, withHooks } from './hooks'

let workspace: string

beforeEach(() => {
  home.dir = mkdtempSync(join(tmpdir(), 'talor-hooks-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'talor-hooks-ws-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
  rmSync(home.dir, { recursive: true, force: true })
})

const result = (exitCode: number, stdout = '', stderr = ''): HookExecResult => ({
  exitCode,
  stdout,
  stderr,
  timedOut: false,
})

type ExecCall = { command: string; input: Record<string, unknown>; cwd?: string }

/** 假 hook 执行：记录每次调用，按 reply 返回结果。 */
function fakeRunner(
  reply: (command: string, input: Record<string, unknown>, n: number) => HookExecResult,
) {
  const calls: ExecCall[] = []
  const runner = createHookRunner({
    exec: async (command, input, opts) => {
      const parsed = JSON.parse(input) as Record<string, unknown>
      calls.push({ command, input: parsed, ...(opts.cwd ? { cwd: opts.cwd } : {}) })
      return reply(command, parsed, calls.length)
    },
  })
  return { runner, calls }
}

let seq = 0
const profile = (patch: Partial<AgentProfile> = {}): AgentProfile => ({
  id: `hook-agent-${++seq}`,
  name: 'H',
  description: '',
  agentPrompt: 'Help.',
  ...patch,
})

async function runWith(opts: {
  hooks: HookSpec[]
  reply: (command: string, input: Record<string, unknown>, n: number) => HookExecResult
  replies: FakeReply[]
  approver?: Approver
  mcp?: McpHost
  servers?: MCPServer[]
  agents?: CatalogAgent[]
  profile?: AgentProfile
}) {
  const model = fakeModel({ replies: opts.replies, repeatLast: true })
  const approve = vi.fn<Approver['approve']>().mockResolvedValue({ approved: true })
  const { runner, calls } = fakeRunner(opts.reply)
  const runtime = createRuntime({
    models: modelHub({ providers: [model], default: model.ref }),
    archive: memoryArchive(),
    approver: opts.approver ?? { approve },
    hooks: opts.hooks,
    hookRunner: runner,
    ...(opts.mcp ? { mcp: opts.mcp } : {}),
  })
  const snapshot = catalogSnapshot({
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => opts.servers ?? [],
    skills: () => [],
    agents: () => opts.agents ?? [],
  })
  const agent = agentFor(opts.profile ?? profile(), snapshot)
  const task = defineTask({
    input: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
    scope: { workspace },
    subject: 's1',
  })
  const res = await runtime.interactive.start(agent, task).result
  return { res, model, approve, calls, runtime }
}

const text = (v: unknown) => JSON.stringify(v)

describe('plugin hooks in the execution environment (B2)', () => {
  it('AC-001 lets a PreToolUse hook deny a write, seeing Claude Code names and input', async () => {
    const { model, approve, calls } = await runWith({
      hooks: [{ event: 'PreToolUse', matcher: 'Write|Edit', command: 'guard' }],
      reply: () => result(2, '', 'no writes here'),
      replies: [
        { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
        { text: 'ok' },
      ],
    })
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false)
    expect(text(model.inputs[1]!.messages)).toContain('no writes here')
    expect(approve).not.toHaveBeenCalled()
    expect(calls[0]!.input).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'a.txt', content: 'hi' },
    })
    expect(calls[0]!.input.tool_input).not.toHaveProperty('path')
    expect(calls[0]!.cwd).toBe(workspace)
  })

  it('AC-002 denies an MCP tool by its mcp__<server>__<tool> name', async () => {
    const crm = fakeMcpServer({ tools: [{ name: 'lookup', handler: () => 'A' }] })
    const at = '2026-01-01T00:00:00.000Z'
    const { calls } = await runWith({
      hooks: [{ event: 'PreToolUse', matcher: 'mcp__crm__.*', command: 'guard' }],
      reply: () => result(2, '', 'no crm'),
      replies: [
        { toolCalls: [{ name: 'search_tool', input: { query: 'lookup' } }] },
        { toolCalls: [{ name: 'crm__lookup', input: {} }] },
        { text: 'done' },
      ],
      mcp: createMcpHost({ connect: crm.connect }),
      servers: [
        {
          id: 'c',
          name: 'crm',
          type: 'stdio',
          command: 'crm-server',
          enabled: true,
          created_at: at,
          updated_at: at,
        },
      ],
    })
    expect(crm.calls).toEqual([])
    expect(calls.map((c) => c.input.tool_name)).toContain('mcp__crm__lookup')
  })

  it('AC-003 adds SessionStart output as notice', async () => {
    const { model } = await runWith({
      hooks: [{ event: 'SessionStart', command: 'start' }],
      reply: () => result(0, 'Answer in French.'),
      replies: [{ text: 'oui' }],
    })
    expect(text(model.inputs[0]!.messages)).toContain('Answer in French.')
  })

  it('AC-004 makes the run continue once when the Stop hook blocks', async () => {
    const { res, model } = await runWith({
      hooks: [{ event: 'Stop', command: 'stop' }],
      reply: (_c, _i, n) => (n === 1 ? result(2, '', 'run the tests first') : result(0)),
      replies: [{ text: 'done 1' }, { text: 'done 2' }],
    })
    expect(res.status).toBe('completed')
    expect(model.inputs.length).toBeGreaterThanOrEqual(2)
    expect(text(model.inputs[1]!.messages)).toContain('run the tests first')
  })

  it('AC-005 logs PreCompact and Notification hooks and gives them no effect', () => {
    vi.mocked(log.info).mockClear()
    const base = interactiveEnvironment({})
    const hooks: HookSpec[] = [
      { event: 'PreCompact', command: 'a', source: 'plugin:x' },
      { event: 'Notification', command: 'b', source: 'plugin:x' },
    ]
    const config = withHooks(base, hooks)
    expect(config.notice).toHaveLength(base.notice!.length)
    expect(config.permissions).toHaveLength(base.permissions!.length)
    const logged = text(vi.mocked(log.info).mock.calls)
    expect(logged).toContain('PreCompact')
    expect(logged).toContain('Notification')
    expect(() =>
      createRuntime({
        models: modelHub({ providers: [fakeModel({ replies: [{ text: 'x' }] })] }),
        archive: memoryArchive(),
        hooks,
        hookRunner: fakeRunner(() => result(0)).runner,
      }),
    ).not.toThrow()
  })

  it('AC-005 returns the same config when there are no hooks', () => {
    const base = interactiveEnvironment({})
    expect(withHooks(base, [])).toBe(base)
  })

  it('places hook rules right after the workspace sandbox', () => {
    const base = interactiveEnvironment({})
    const config = withHooks(base, [{ event: 'PreToolUse', command: 'g' }])
    const ids = config.permissions!.map((r) => r.id)
    expect(ids[0]).toBe('workspace-sandbox')
    expect(ids[1]).toBe('hook:PreToolUse:0')
    expect(ids.slice(2)).toEqual(base.permissions!.slice(1).map((r) => r.id))
  })

  it('AC-007 rebuilds the environment only when the hooks change', async () => {
    const model = fakeModel({ replies: [{ hang: true }] })
    const A: HookSpec[] = [{ event: 'SessionStart', command: 'a' }]
    const B: HookSpec[] = [{ event: 'SessionStart', command: 'b' }]
    const { runner, calls } = fakeRunner((command) => result(0, `from ${command}`))
    const runtime = createRuntime({
      models: modelHub({ providers: [model], default: model.ref }),
      archive: memoryArchive(),
      hooks: A,
      hookRunner: runner,
    })
    const first = runtime.interactive
    const run = first.start(
      agentFor(
        profile(),
        catalogSnapshot({
          builtins: () => [],
          mcpServers: () => [],
          skills: () => [],
          agents: () => [],
        }),
      ),
      defineTask({ input: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }] }),
    )
    await vi.waitFor(() => expect(model.inputs.length).toBe(1))
    runtime.setHooks(A)
    expect(runtime.interactive).toBe(first)
    runtime.setHooks(B)
    expect(runtime.interactive).not.toBe(first)
    expect(runtime.interactive.fingerprint).not.toBe(first.fingerprint)
    run.abort('test')
    await run.result
    expect(calls.map((c) => c.command)).toEqual(['a'])
  })

  it('AC-013 maps Talor tools to Claude Code names and input fields', () => {
    expect(claudeToolView({ toolName: 'read', input: { path: 'a', offset: 2 } })).toEqual({
      toolName: 'Read',
      input: { file_path: 'a', offset: 2 },
    })
    expect(claudeToolView({ toolName: 'write', input: { path: 'a', content: 'x' } })).toEqual({
      toolName: 'Write',
      input: { file_path: 'a', content: 'x' },
    })
    expect(
      claudeToolView({
        toolName: 'edit',
        input: { path: 'a', old: 'o', new: 'n', replaceAll: true },
      }),
    ).toEqual({
      toolName: 'Edit',
      input: { file_path: 'a', old_string: 'o', new_string: 'n', replace_all: true },
    })
    expect(claudeToolView({ toolName: 'bash', input: { command: 'ls' } })).toEqual({
      toolName: 'Bash',
      input: { command: 'ls' },
    })
    for (const [from, to] of [
      ['glob', 'Glob'],
      ['grep', 'Grep'],
      ['ls', 'LS'],
    ]) {
      expect(claudeToolView({ toolName: from!, input: { pattern: 'x' } })).toEqual({
        toolName: to,
        input: { pattern: 'x' },
      })
    }
    for (const view of [
      { toolName: 'mcp__x__y', input: { path: 'a' } },
      { toolName: 'unknown', input: { path: 'a' } },
    ]) {
      expect(claudeToolView(view)).toEqual(view)
    }
    expect(claudeToolView({ toolName: 'write', input: 'raw' })).toEqual({
      toolName: 'Write',
      input: 'raw',
    })
  })

  it('marks hook asks with HOOK_ASK_REASON and leaves other outcomes alone', async () => {
    const asks = markHookAsks([
      {
        id: 'a',
        version: '1',
        permit: async () => ({ ask: { summary: 's', risk: 'high', detail: { reason: 'r' } } }),
      },
      { id: 'b', version: '1', permit: async () => ({ ask: { summary: 's', risk: 'high' } }) },
      { id: 'c', version: '1', permit: async () => 'allow' as const },
    ])
    const out = await Promise.all(asks.map((r) => r.permit({} as never, {} as never, {} as never)))
    expect(out[0]).toMatchObject({ ask: { detail: { reason: `r；${HOOK_ASK_REASON}` } } })
    expect(out[1]).toMatchObject({ ask: { detail: { reason: HOOK_ASK_REASON } } })
    expect(out[2]).toBe('allow')
  })

  it('AC-015 asks the user for a hook ask even when a remembered rule allows the call', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'talor-hooks-out-'))
    try {
      permissionStore.addSessionRule(workspace, {
        tool: 'read',
        argPattern: `${outside}/`,
        effect: 'allow',
      })
      const before = permissionStore.allRulesFor(workspace).length
      const requests: PermissionRequest[] = []
      const prompt = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => {
        requests.push(req)
        return { requestId: req.requestId, decision: 'approved' }
      })
      const unregister = registerApprovalPort('s1', prompt)
      const approver = createSessionApprover({ skillRoots: [] })
      const readOutside = [
        { toolCalls: [{ name: 'read', input: { path: join(outside, 'x.txt') } }] },
        { text: 'done' },
      ]
      await runWith({
        hooks: [{ event: 'PreToolUse', matcher: 'Read', command: 'ask' }],
        reply: () =>
          result(
            0,
            JSON.stringify({
              hookSpecificOutput: {
                permissionDecision: 'ask',
                permissionDecisionReason: 'confirm read',
              },
            }),
          ),
        replies: readOutside,
        approver,
      })
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(requests[0]!.inputSummary).toContain('confirm read')
      expect(requests[0]!.suggestedPatterns).toEqual([])
      expect(permissionStore.allRulesFor(workspace)).toHaveLength(before)

      prompt.mockClear()
      await runWith({ hooks: [], reply: () => result(0), replies: readOutside, approver })
      expect(prompt).not.toHaveBeenCalled()
      unregister()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('AC-015 treats a hook ask without input as a risk target, never a path-only ask', () => {
    const base = { callId: 'c', toolName: 'read', summary: 'confirm', risk: 'low' as const }
    expect(approvalTargetsOf({ ...base, detail: { paths: ['/x'] } }).risk).toBeUndefined()
    expect(
      approvalTargetsOf({ ...base, detail: { paths: ['/x'], reason: HOOK_ASK_REASON } }).risk,
    ).toMatchObject({ reason: 'high_risk_tool' })
  })

  it('AC-016 runs PostToolUse after successful calls only', async () => {
    const sensitive = join(homedir(), '.ssh', 'talor-hooks-test')
    const { model, calls } = await runWith({
      hooks: [{ event: 'PostToolUse', matcher: 'Write', command: 'lint' }],
      reply: () => result(2, '', 'lint failed'),
      replies: [
        { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
        { toolCalls: [{ name: 'write', input: { path: sensitive, content: 'x' } }] },
        { text: 'done' },
      ],
    })
    expect(existsSync(join(workspace, 'a.txt'))).toBe(true)
    expect(existsSync(sensitive)).toBe(false)
    expect(text(model.inputs[1]!.messages)).toContain('lint failed')
    expect(calls.filter((c) => c.input.hook_event_name === 'PostToolUse')).toHaveLength(1)
  })

  it('AC-017 applies SubagentStop to child runs only', async () => {
    const reply = (_c: string, _i: Record<string, unknown>, n: number) =>
      n === 1 ? result(2, '', 'child must verify') : result(0)
    const hooks: HookSpec[] = [{ event: 'SubagentStop', command: 'sub' }]

    const alone = await runWith({ hooks, reply, replies: [{ text: 'root only' }] })
    expect(alone.calls).toHaveLength(0)
    expect(alone.model.inputs).toHaveLength(1)

    const helper: AgentProfile = {
      id: 'helper',
      name: 'Helper',
      description: 'helps',
      agentPrompt: 'Help.',
    }
    const delegated = await runWith({
      hooks,
      reply,
      replies: [
        { toolCalls: [{ name: 'delegate', input: { agent: 'helper', task: 'verify' } }] },
        { text: 'child v1' },
        { text: 'child v2' },
        { text: 'root done' },
      ],
      agents: [{ profile: helper, featureTools: [] }],
      profile: profile({ subagents: { ids: [{ id: 'helper', required: false }] } }),
    })
    expect(delegated.res.status).toBe('completed')
    expect(delegated.calls.length).toBeGreaterThanOrEqual(1)
    const childSecond = delegated.model.inputs.find((input) =>
      text(input.messages).includes('child must verify'),
    )
    expect(childSecond).toBeDefined()
  })
})
