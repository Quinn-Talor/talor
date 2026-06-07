// src/main/agent/loader.test.ts — Schema 2.0 loader tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentLoader } from './loader'

const VALID_AGENT_V2 = {
  schemaVersion: '2.0',
  id: 'sales_analyst',
  name: '销售分析师',
  description: '汇总销售数据并产出周报。',
  version: '1.0.0',
  agentPrompt: '## Workflow\n1. Test.\n\n## Output\nText.',
}

const OLD_SCHEMA_AGENT = {
  id: 'sales_001',
  name: '销售',
  description: 'old',
  version: '1.0.0',
  role: { capabilities: ['x'], outputFormat: 'md' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'agent-loader-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function writeAgent(name: string, json: unknown): void {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  // 拆 splitter: agent.json (不含 agentPrompt) + prompt.md
  const obj = json as Record<string, unknown>
  const { agentPrompt, ...rest } = obj
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(rest, null, 2))
  writeFileSync(join(dir, 'prompt.md'), (agentPrompt as string) ?? '')
}

describe('AgentLoader (schema 2.0)', () => {
  it('auto-creates agents directory if missing', () => {
    const nonExistDir = join(tempDir, 'agents')
    expect(existsSync(nonExistDir)).toBe(false)
    const loader = new AgentLoader(nonExistDir)
    expect(existsSync(nonExistDir)).toBe(true)
    expect(loader.size).toBe(0)
  })

  it('loads valid v2 agent', () => {
    writeAgent('sales', VALID_AGENT_V2)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    const entry = loader.getById('sales_analyst')
    expect(entry).toBeDefined()
    expect(entry!.profile.name).toBe('销售分析师')
    expect(entry!.status).toBe('disabled')
    expect(entry!.dirPath).toBe(join(tempDir, 'sales'))
  })

  it('AC-002: rejects old schema profile (no schemaVersion)', () => {
    writeAgent('old', OLD_SCHEMA_AGENT)
    writeAgent('new', VALID_AGENT_V2)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    // 旧 schema profile 直接 reject
    expect(loader.size).toBe(1)
    expect(loader.getById('sales_001')).toBeUndefined()
    expect(loader.getById('sales_analyst')).toBeDefined()
  })

  it('rejects v1.0 agent.json with rule 1 warn', () => {
    const v1Profile = {
      schemaVersion: '1.0',
      identity: { id: 'legacy', name: 'Legacy', description: 'old.', version: '1.0.0' },
    }
    const dir = join(tempDir, 'legacy')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'agent.json'), JSON.stringify(v1Profile))
    writeFileSync(join(dir, 'prompt.md'), '## Workflow\n1. Do.')

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.getById('legacy')).toBeUndefined()
  })

  it('skips invalid v2 agent.json and logs warning', () => {
    writeAgent('broken', { ...VALID_AGENT_V2, id: 'Bad Id!' })
    writeAgent('good', VALID_AGENT_V2)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    expect(loader.getById('Bad Id!')).toBeUndefined()
    expect(loader.getById('sales_analyst')).toBeDefined()
  })

  it('returns empty for empty directory', () => {
    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.getAll()).toEqual([])
  })

  it('getByName finds by profile.name', () => {
    writeAgent('sales', VALID_AGENT_V2)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.getByName('销售分析师')).toBeDefined()
    expect(loader.getByName('不存在')).toBeUndefined()
  })

  it('setStatus updates agent status', () => {
    writeAgent('sales', VALID_AGENT_V2)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    loader.setStatus('sales_analyst', 'ready')
    expect(loader.getById('sales_analyst')!.status).toBe('ready')
  })

  it('remove deletes agent from index', () => {
    writeAgent('sales', VALID_AGENT_V2)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.remove('sales_analyst')).toBe(true)
    expect(loader.getById('sales_analyst')).toBeUndefined()
    expect(loader.size).toBe(0)
  })

  it('skips non-directory entries', () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a directory')
    writeAgent('sales', VALID_AGENT_V2)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('skips directories without agent.json', () => {
    mkdirSync(join(tempDir, 'empty-dir'))
    writeAgent('sales', VALID_AGENT_V2)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('loads multiple agents', () => {
    writeAgent('sales', VALID_AGENT_V2)
    writeAgent('translator', {
      ...VALID_AGENT_V2,
      id: 'translator',
      name: '翻译助手',
    })

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(2)
    expect(
      loader
        .getAll()
        .map((e) => e.profile.id)
        .sort(),
    ).toEqual(['sales_analyst', 'translator'])
  })

  describe('引用化 schema 加载', () => {
    it('loads agent with string[] skills/mcpServers/cli (new schema)', () => {
      writeAgent('refs', {
        ...VALID_AGENT_V2,
        skills: ['lark-doc'],
        mcpServers: ['github'],
        cli: ['gh', 'jq'],
      })

      const loader = new AgentLoader(tempDir)
      loader.loadAll()
      expect(loader.size).toBe(1)
      const entry = loader.getById('sales_analyst')!
      expect(entry.profile.skills).toEqual(['lark-doc'])
      expect(entry.profile.mcpServers).toEqual(['github'])
      expect(entry.profile.cli).toEqual(['gh', 'jq'])
    })

    it('rejects agent.json with object[] skills (旧 schema,无 backward compat)', () => {
      writeAgent('legacy', {
        ...VALID_AGENT_V2,
        skills: [{ name: 'lark-doc', required: true }],
      })

      const loader = new AgentLoader(tempDir)
      loader.loadAll()
      // 旧格式不再被接受 — agent 加载失败,不进入 entries
      expect(loader.size).toBe(0)
    })
  })
})
