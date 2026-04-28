import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { exportAgent } from './exporter'
import { importAgent } from './importer'

let tempDir: string

const VALID_AGENT = {
  id: 'export-test-001',
  name: '导出测试',
  description: 'test',
  version: '1.0.0',
  role: { capabilities: ['test'], outputFormat: 'text' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'export-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function createAgentDir(name: string): string {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(VALID_AGENT, null, 2))
  mkdirSync(join(dir, 'knowledge'), { recursive: true })
  writeFileSync(join(dir, 'knowledge', 'manual.md'), '# Manual')
  return dir
}

describe('exportAgent + importAgent', () => {
  it('AC-B1-01: export produces valid zip that can be imported', () => {
    const agentDir = createAgentDir('my-agent')
    const zipBuffer = exportAgent(agentDir)

    expect(zipBuffer).toBeInstanceOf(Buffer)
    expect(zipBuffer.length).toBeGreaterThan(0)

    const importDir = mkdtempSync(join(tmpdir(), 'import-target-'))
    try {
      const result = importAgent(zipBuffer, importDir)
      expect(result.profile.id).toBe('export-test-001')
      expect(result.overwritten).toBe(false)
    } finally {
      rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('AC-B1-03: import detects overwrite', () => {
    const agentDir = createAgentDir('my-agent')
    const zipBuffer = exportAgent(agentDir)

    const importDir = mkdtempSync(join(tmpdir(), 'import-target-'))
    try {
      importAgent(zipBuffer, importDir)
      const result2 = importAgent(zipBuffer, importDir)
      expect(result2.overwritten).toBe(true)
    } finally {
      rmSync(importDir, { recursive: true, force: true })
    }
  })

  it('export throws for non-existent directory', () => {
    expect(() => exportAgent('/nonexistent')).toThrow('Agent directory not found')
  })

  it('export throws for directory without agent.json', () => {
    mkdirSync(join(tempDir, 'empty'), { recursive: true })
    expect(() => exportAgent(join(tempDir, 'empty'))).toThrow('agent.json not found')
  })
})
