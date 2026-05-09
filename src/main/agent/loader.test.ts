// src/main/agent/loader.test.ts — Schema 1.0 loader tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentLoader } from './loader'

const VALID_AGENT_V1 = {
  schemaVersion: '1.0',
  identity: {
    id: 'sales_analyst',
    name: '销售分析师',
    description: '汇总销售数据',
    version: '1.0.0',
  },
  mission: {
    objective: '汇总销售数据并产出周报',
    outcomes: [
      {
        id: 'weekly_summary',
        description: 'User receives weekly sales summary report',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'sales_summary',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: { capabilities: ['汇总销售数据并生成 weekly summary'] },
  delivery: {
    deliverables: [{ id: 'sales_summary', format: 'markdown', mustContain: ['# Weekly'] }],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'sales_summary',
        kind: 'deterministic',
        severity: 'must',
      },
    ],
  },
  execution: {
    limits: { maxSteps: 20, maxTokens: 100000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
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
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(json, null, 2))
}

describe('AgentLoader (schema 1.0)', () => {
  it('auto-creates agents directory if missing', () => {
    const nonExistDir = join(tempDir, 'agents')
    expect(existsSync(nonExistDir)).toBe(false)
    const loader = new AgentLoader(nonExistDir)
    expect(existsSync(nonExistDir)).toBe(true)
    expect(loader.size).toBe(0)
  })

  it('loads valid v1 agent', () => {
    writeAgent('sales', VALID_AGENT_V1)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    const entry = loader.getById('sales_analyst')
    expect(entry).toBeDefined()
    expect(entry!.profile.identity.name).toBe('销售分析师')
    expect(entry!.status).toBe('disabled')
    expect(entry!.dirPath).toBe(join(tempDir, 'sales'))
  })

  it('AC-002: rejects old schema profile (no schemaVersion)', () => {
    writeAgent('old', OLD_SCHEMA_AGENT)
    writeAgent('new', VALID_AGENT_V1)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    // 旧 schema profile 直接 reject
    expect(loader.size).toBe(1)
    expect(loader.getById('sales_001')).toBeUndefined()
    expect(loader.getById('sales_analyst')).toBeDefined()
  })

  it('skips invalid v1 agent.json and logs warning', () => {
    writeAgent('broken', { ...VALID_AGENT_V1, identity: { id: 'broken' } })
    writeAgent('good', VALID_AGENT_V1)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    expect(loader.getById('broken')).toBeUndefined()
    expect(loader.getById('sales_analyst')).toBeDefined()
  })

  it('returns empty for empty directory', () => {
    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.getAll()).toEqual([])
  })

  it('getByName finds by profile.identity.name', () => {
    writeAgent('sales', VALID_AGENT_V1)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.getByName('销售分析师')).toBeDefined()
    expect(loader.getByName('不存在')).toBeUndefined()
  })

  it('setStatus updates agent status', () => {
    writeAgent('sales', VALID_AGENT_V1)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    loader.setStatus('sales_analyst', 'ready')
    expect(loader.getById('sales_analyst')!.status).toBe('ready')
  })

  it('remove deletes agent from index', () => {
    writeAgent('sales', VALID_AGENT_V1)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.remove('sales_analyst')).toBe(true)
    expect(loader.getById('sales_analyst')).toBeUndefined()
    expect(loader.size).toBe(0)
  })

  it('skips non-directory entries', () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a directory')
    writeAgent('sales', VALID_AGENT_V1)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('skips directories without agent.json', () => {
    mkdirSync(join(tempDir, 'empty-dir'))
    writeAgent('sales', VALID_AGENT_V1)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('loads multiple agents', () => {
    writeAgent('sales', VALID_AGENT_V1)
    writeAgent('translator', {
      ...VALID_AGENT_V1,
      identity: { ...VALID_AGENT_V1.identity, id: 'translator', name: '翻译助手' },
    })

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(2)
    expect(
      loader
        .getAll()
        .map((e) => e.profile.identity.id)
        .sort(),
    ).toEqual(['sales_analyst', 'translator'])
  })
})
