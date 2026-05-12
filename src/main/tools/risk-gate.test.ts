import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import { RiskGate, detectFallbackRisk, __TEST__ } from './risk-gate'
import { SessionApprovalMemory } from './session-approval-memory'
import { SideEffectLedger } from '../repos/side-effect-ledger'
import type { ToolDefinition, ToolExecuteContext } from './types'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'
import type { ToolConfirmRequest } from '@shared/types/message'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'mysql_query',
    description: '',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'LOW',
    execute: async () => ({ output: 'ok' }),
    ...overrides,
  }
}

function makeCtx(blocks?: TalorBlock[], toolCallId = 'tc-1'): ToolExecuteContext {
  return {
    sessionId: 's1',
    currentStepBlocks: blocks,
    toolCallId,
    workspace: '/tmp',
  } as ToolExecuteContext
}

describe('RiskGate.gate', () => {
  let memory: SessionApprovalMemory
  let ledger: SideEffectLedger
  let ledgerRecordSpy: ReturnType<typeof vi.fn>
  let gate: RiskGate

  beforeEach(() => {
    memory = new SessionApprovalMemory()
    // 注入一个 stub ledger,避免单测真的 touch sqlite。
    // 只覆盖 RiskGate 用到的 record 方法 — 不调用 buildSummary / listByRootSession。
    ledgerRecordSpy = vi.fn()
    ledger = { record: ledgerRecordSpy } as unknown as SideEffectLedger
    gate = new RiskGate(memory, ledger)
  })

  describe('路径 1: 静态 HIGH riskLevel → pass-to-legacy', () => {
    it('bash 工具 (HIGH) → pass-to-legacy, 不弹 confirm', async () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'HIGH' })
      const confirmTool = vi.fn()
      const decision = await gate.gate(tool, { command: 'rm -rf /' }, makeCtx(), confirmTool)
      expect(decision.action).toBe('pass-to-legacy')
      expect(decision.via).toBe('legacy')
      expect(confirmTool).not.toHaveBeenCalled()
    })
  })

  describe('路径 2: LLM emit pending_confirm block (主路径)', () => {
    it('用户批准 → pass + via=pendingBlock', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: 'INSERT 1 row',
        pattern: 'sql:INSERT:game.rule',
      }
      const confirmTool = vi.fn().mockResolvedValue({ approved: true, remember: false })
      const decision = await gate.gate(
        makeTool(),
        { sql: 'INSERT INTO game.rule ...' },
        makeCtx([block]),
        confirmTool,
      )
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('pendingBlock')
      expect(decision.summary).toBe('INSERT 1 row')
      expect(confirmTool).toHaveBeenCalledTimes(1)
      const req = confirmTool.mock.calls[0][0] as ToolConfirmRequest
      expect(req.summary).toBe('INSERT 1 row')
      expect(req.allowRemember).toBe(true)
    })

    it('用户批准 + remember → memory.approve', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: '...',
        pattern: 'sql:INSERT:x',
      }
      const confirmTool = vi.fn().mockResolvedValue({ approved: true, remember: true })
      await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)
      expect(memory.isApproved('s1', 'sql:INSERT:x')).toBe(true)
    })

    it('memory 已批准 → 自动通过, 不弹 confirm', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: '...',
        pattern: 'sql:INSERT:x',
      }
      memory.approve('s1', 'sql:INSERT:x')
      const confirmTool = vi.fn()
      const decision = await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('memory')
      expect(confirmTool).not.toHaveBeenCalled()
    })

    it('用户拒绝 → deny', async () => {
      const block: TalorBlock = { type: 'pending_confirm', summary: '...' }
      const confirmTool = vi.fn().mockResolvedValue({ approved: false, remember: false })
      const decision = await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)
      expect(decision.action).toBe('deny')
      expect(decision.via).toBe('pendingBlock')
    })

    it('risk_level=destructive → allowRemember=false', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: 'DROP table',
        pattern: 'sql:DROP:x',
        risk_level: 'destructive',
      }
      const confirmTool = vi.fn().mockResolvedValue({ approved: true, remember: true })
      await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)
      const req = confirmTool.mock.calls[0][0] as ToolConfirmRequest
      expect(req.allowRemember).toBe(false)
      expect(req.riskLevel).toBe('destructive')
      // 即便用户勾 remember,destructive 也不入 memory
      expect(memory.isApproved('s1', 'sql:DROP:x')).toBe(false)
    })

    it('confirmTool 返 boolean (legacy 兼容) → 仍能识别', async () => {
      const block: TalorBlock = { type: 'pending_confirm', summary: '...' }
      const confirmTool = vi.fn().mockResolvedValue(true)
      const decision = await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)
      expect(decision.action).toBe('pass')
    })
  })

  describe('路径 3: 代码兜底 regex', () => {
    it('SQL INSERT 无 pending_confirm block → 兜底弹 confirm', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const decision = await gate.gate(
        makeTool(),
        { sql: 'INSERT INTO x VALUES (1)' },
        makeCtx(),
        confirmTool,
      )
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('fallback')
      const req = confirmTool.mock.calls[0][0] as ToolConfirmRequest
      expect(req.summary).toContain('did not declare')
      expect(req.allowRemember).toBe(false)
    })

    it('rm -rf / 无 pending_confirm → 兜底', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const decision = await gate.gate(
        makeTool({ name: 'bash', riskLevel: 'LOW' }),
        { command: 'rm -rf /tmp' },
        makeCtx(),
        confirmTool,
      )
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('fallback')
    })

    it('兜底路径用户拒绝 → deny', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: false })
      const decision = await gate.gate(makeTool(), { sql: 'DROP TABLE x' }, makeCtx(), confirmTool)
      expect(decision.action).toBe('deny')
      expect(decision.via).toBe('fallback')
    })
  })

  describe('路径 4: 无风险信号 → 直接通过', () => {
    it('SELECT 查询 → auto-low', async () => {
      const confirmTool = vi.fn()
      const decision = await gate.gate(
        makeTool(),
        { sql: 'SELECT * FROM x WHERE id = 1' },
        makeCtx(),
        confirmTool,
      )
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('auto-low')
      expect(confirmTool).not.toHaveBeenCalled()
    })

    it('普通文本工具 input → auto-low', async () => {
      const confirmTool = vi.fn()
      const decision = await gate.gate(
        makeTool({ name: 'read' }),
        { path: '/tmp/file.txt' },
        makeCtx(),
        confirmTool,
      )
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('auto-low')
    })
  })

  describe('Ledger 记账 (Gate 内部职责)', () => {
    it('pendingBlock approved → record(confirmed_by=pendingBlock, user_decision=approved)', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: 'INSERT 1 row',
        pattern: 'sql:INSERT:x',
      }
      const confirmTool = vi.fn().mockResolvedValue({ approved: true, remember: false })
      await gate.gate(
        makeTool(),
        { sql: 'INSERT INTO x VALUES (1)' },
        makeCtx([block]),
        confirmTool,
      )

      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      const entry = ledgerRecordSpy.mock.calls[0][0]
      expect(entry.confirmed_by).toBe('pendingBlock')
      expect(entry.user_decision).toBe('approved')
      expect(entry.op).toBe('mysql_query:invoke')
      expect(entry.target).toContain('INSERT 1 row')
    })

    it('memory 自动通过 → record(confirmed_by=memory, user_decision=auto)', async () => {
      const block: TalorBlock = {
        type: 'pending_confirm',
        summary: '...',
        pattern: 'sql:INSERT:x',
      }
      memory.approve('s1', 'sql:INSERT:x')
      await gate.gate(makeTool(), {}, makeCtx([block]), vi.fn())

      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      const entry = ledgerRecordSpy.mock.calls[0][0]
      expect(entry.confirmed_by).toBe('memory')
      expect(entry.user_decision).toBe('auto')
    })

    it('pendingBlock denied → record(user_decision=denied)', async () => {
      const block: TalorBlock = { type: 'pending_confirm', summary: '...' }
      const confirmTool = vi.fn().mockResolvedValue({ approved: false, remember: false })
      await gate.gate(makeTool(), {}, makeCtx([block]), confirmTool)

      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      expect(ledgerRecordSpy.mock.calls[0][0].user_decision).toBe('denied')
    })

    it('fallback approved → record(confirmed_by=fallback)', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      await gate.gate(makeTool(), { sql: 'INSERT INTO x VALUES (1)' }, makeCtx(), confirmTool)

      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      const entry = ledgerRecordSpy.mock.calls[0][0]
      expect(entry.confirmed_by).toBe('fallback')
      expect(entry.user_decision).toBe('approved')
    })

    it('fallback denied → record(user_decision=denied)', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: false })
      await gate.gate(makeTool(), { sql: 'DROP TABLE x' }, makeCtx(), confirmTool)

      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      expect(ledgerRecordSpy.mock.calls[0][0].user_decision).toBe('denied')
    })

    it('auto-low → 不记账 (无风险信号不入 ledger)', async () => {
      await gate.gate(makeTool(), { sql: 'SELECT 1' }, makeCtx(), vi.fn())
      expect(ledgerRecordSpy).not.toHaveBeenCalled()
    })

    it('pass-to-legacy → 不记账 (legacy 路径自有 confirm/记账)', async () => {
      const tool = makeTool({ name: 'bash', riskLevel: 'HIGH' })
      await gate.gate(tool, { command: 'echo hi' }, makeCtx(), vi.fn())
      expect(ledgerRecordSpy).not.toHaveBeenCalled()
    })

    it('record 抛错不阻塞 gate (failsafe)', async () => {
      ledgerRecordSpy.mockImplementation(() => {
        throw new Error('db locked')
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const decision = await gate.gate(
        makeTool(),
        { sql: 'INSERT INTO x VALUES (1)' },
        makeCtx(),
        confirmTool,
      )
      // 决策仍正常返回, 不被 ledger 错误劫持
      expect(decision.action).toBe('pass')
    })

    it('rootSessionId 透传到 ledger entry.parent_session_id', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const ctx = { ...makeCtx(), rootSessionId: 'parent-sess-id' } as ToolExecuteContext
      await gate.gate(makeTool(), { sql: 'INSERT INTO x VALUES (1)' }, ctx, confirmTool)
      expect(ledgerRecordSpy.mock.calls[0][0].parent_session_id).toBe('parent-sess-id')
    })

    it('stepIndex 透传到 ledger entry.step_index', async () => {
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const ctx = { ...makeCtx(), stepIndex: 7 } as ToolExecuteContext
      await gate.gate(makeTool(), { sql: 'INSERT INTO x VALUES (1)' }, ctx, confirmTool)
      expect(ledgerRecordSpy.mock.calls[0][0].step_index).toBe(7)
    })
  })
})

describe('detectFallbackRisk', () => {
  it('DROP TABLE → 命中', () => {
    expect(detectFallbackRisk({ sql: 'DROP TABLE x' })).not.toBeNull()
  })

  it('INSERT/UPDATE/DELETE → 命中', () => {
    expect(detectFallbackRisk({ sql: 'INSERT INTO x VALUES (1)' })).not.toBeNull()
    expect(detectFallbackRisk({ sql: 'UPDATE x SET y=1' })).not.toBeNull()
    expect(detectFallbackRisk({ sql: 'DELETE FROM x' })).not.toBeNull()
  })

  it('rm -rf 命中', () => {
    expect(detectFallbackRisk({ command: 'rm -rf /tmp' })).not.toBeNull()
  })

  it('SELECT 不命中', () => {
    expect(detectFallbackRisk({ sql: 'SELECT * FROM x' })).toBeNull()
  })

  it('字符串字面量中的 DROP 不误报 (stripSqlNoise)', () => {
    expect(detectFallbackRisk({ sql: "SELECT 'DROP TABLE x' as msg" })).toBeNull()
  })

  it('SQL 注释中的 INSERT 不误报', () => {
    expect(detectFallbackRisk({ sql: '-- INSERT INTO x\nSELECT 1' })).toBeNull()
    expect(detectFallbackRisk({ sql: '/* DROP TABLE */ SELECT 1' })).toBeNull()
  })
})

describe('__TEST__.stripSqlNoise', () => {
  it('剥离行注释', () => {
    expect(__TEST__.stripSqlNoise('SELECT 1 -- DROP TABLE x')).toBe('SELECT 1 ')
  })

  it('剥离块注释', () => {
    expect(__TEST__.stripSqlNoise('SELECT /* INSERT */ 1')).toBe('SELECT  1')
  })

  it('剥离单引号字符串', () => {
    expect(__TEST__.stripSqlNoise("SELECT 'DROP'")).toBe("SELECT ''")
  })
})
