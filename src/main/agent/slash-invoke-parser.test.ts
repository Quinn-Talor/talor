import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { parseSlashInvoke } from './slash-invoke-parser'
import { AgentLoader } from './loader'

const VALID_AGENT = {
  schemaVersion: '2.0',
  id: 'sales-001',
  name: '销售分析师',
  description: '自动分析销售数据',
  version: '1.0.0',
  agentPrompt: '## Workflow\n1. 分析销售数据。',
}

let tempDir: string
let loader: AgentLoader

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'slash-'))
  const dir = join(tempDir, 'sales')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(VALID_AGENT))
  loader = new AgentLoader(tempDir)
  loader.loadAll()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('parseSlashInvoke', () => {
  it('AC-D4-02: matches agent by name', () => {
    const result = parseSlashInvoke('/销售分析师 帮我看下本周数据', loader)
    expect(result).not.toBeNull()
    expect(result!.entry.profile.id).toBe('sales-001')
    expect(result!.remainingText).toBe('帮我看下本周数据')
  })

  it('returns null for unmatched agent', () => {
    const result = parseSlashInvoke('/不存在的agent 你好', loader)
    expect(result).toBeNull()
  })

  it('returns null for non-slash text', () => {
    const result = parseSlashInvoke('普通消息', loader)
    expect(result).toBeNull()
  })

  it('handles agent name without trailing text', () => {
    const result = parseSlashInvoke('/销售分析师', loader)
    expect(result).not.toBeNull()
    expect(result!.remainingText).toBe('')
  })

  it('returns null for empty slash', () => {
    const result = parseSlashInvoke('/ 你好', loader)
    expect(result).toBeNull()
  })
})
