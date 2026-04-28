import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentLoader } from './loader'

const VALID_AGENT = {
  id: 'sales-001',
  name: '销售分析师',
  description: '汇总销售数据',
  version: '1.0.0',
  role: { capabilities: ['分析'], outputFormat: 'md' },
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

describe('AgentLoader', () => {
  it('AC-A2-03: auto-creates agents directory if missing', () => {
    const nonExistDir = join(tempDir, 'agents')
    expect(existsSync(nonExistDir)).toBe(false)
    const loader = new AgentLoader(nonExistDir)
    expect(existsSync(nonExistDir)).toBe(true)
    expect(loader.size).toBe(0)
  })

  it('AC-A2-01: loads valid agent', () => {
    writeAgent('sales', VALID_AGENT)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    const entry = loader.getById('sales-001')
    expect(entry).toBeDefined()
    expect(entry!.profile.name).toBe('销售分析师')
    expect(entry!.status).toBe('disabled')
    expect(entry!.dirPath).toBe(join(tempDir, 'sales'))
  })

  it('AC-A2-02: skips invalid agent.json and logs warning', () => {
    writeAgent('broken', { id: 'broken', description: 'no name', version: '1.0.0' })
    writeAgent('good', VALID_AGENT)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.size).toBe(1)
    expect(loader.getById('broken')).toBeUndefined()
    expect(loader.getById('sales-001')).toBeDefined()
  })

  it('returns empty for empty directory', () => {
    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.getAll()).toEqual([])
  })

  it('getByName finds by profile.name', () => {
    writeAgent('sales', VALID_AGENT)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.getByName('销售分析师')).toBeDefined()
    expect(loader.getByName('不存在')).toBeUndefined()
  })

  it('setStatus updates agent status', () => {
    writeAgent('sales', VALID_AGENT)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    loader.setStatus('sales-001', 'ready')
    expect(loader.getById('sales-001')!.status).toBe('ready')
  })

  it('remove deletes agent from index', () => {
    writeAgent('sales', VALID_AGENT)
    const loader = new AgentLoader(tempDir)
    loader.loadAll()

    expect(loader.remove('sales-001')).toBe(true)
    expect(loader.getById('sales-001')).toBeUndefined()
    expect(loader.size).toBe(0)
  })

  it('skips non-directory entries', () => {
    writeFileSync(join(tempDir, 'readme.txt'), 'not a directory')
    writeAgent('sales', VALID_AGENT)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('skips directories without agent.json', () => {
    mkdirSync(join(tempDir, 'empty-dir'))
    writeAgent('sales', VALID_AGENT)

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(1)
  })

  it('loads multiple agents', () => {
    writeAgent('sales', VALID_AGENT)
    writeAgent('translator', {
      ...VALID_AGENT,
      id: 'translator-001',
      name: '翻译助手',
    })

    const loader = new AgentLoader(tempDir)
    loader.loadAll()
    expect(loader.size).toBe(2)
    expect(loader.getAll().map(e => e.profile.id).sort()).toEqual(['sales-001', 'translator-001'])
  })
})
