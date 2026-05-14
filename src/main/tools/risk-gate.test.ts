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

  describe('路径 1 (v3.7.2): 静态 HIGH riskLevel → high-static', () => {
    it('bash 工具 (HIGH) + 有效 command → confirm + pass', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      const decision = await gate.gate(tool, { command: 'echo hi' }, makeCtx(), confirmTool)
      expect(decision.action).toBe('pass')
      expect(decision.via).toBe('high-static')
      expect(confirmTool).toHaveBeenCalledTimes(1)
      const req = confirmTool.mock.calls[0][0] as ToolConfirmRequest
      expect(req.preview).toContain('echo hi')
      expect(req.allowRemember).toBe(false)
    })

    it('bash 工具 + 用户 deny → deny + via=high-static', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: false })
      const decision = await gate.gate(tool, { command: 'rm -rf /' }, makeCtx(), confirmTool)
      expect(decision.action).toBe('deny')
      expect(decision.via).toBe('high-static')
    })

    it('bash 工具 + 缺 command 字段 → deny + 诊断 summary', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      const confirmTool = vi.fn()
      const decision = await gate.gate(tool, {}, makeCtx(), confirmTool)
      expect(decision.action).toBe('deny')
      expect(decision.via).toBe('high-static')
      expect(decision.summary).toContain('command') // 诊断提到缺失字段
      expect(confirmTool).not.toHaveBeenCalled()
    })

    it('write 工具 (HIGH) → preview 包含 path + content', async () => {
      const tool = makeTool({
        name: 'write',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'],
        },
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      await gate.gate(tool, { path: '/tmp/x.txt', content: 'hello\nworld' }, makeCtx(), confirmTool)
      const req = confirmTool.mock.calls[0][0] as ToolConfirmRequest
      expect(req.preview).toContain('/tmp/x.txt')
      expect(req.preview).toContain('hello')
    })

    it('HIGH static 通过后 → ledger 记 high-static', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: true })
      await gate.gate(tool, { command: 'echo hi' }, makeCtx(), confirmTool)
      expect(ledgerRecordSpy).toHaveBeenCalledTimes(1)
      const entry = ledgerRecordSpy.mock.calls[0][0]
      expect(entry.confirmed_by).toBe('high-static')
      expect(entry.user_decision).toBe('approved')
    })

    it('HIGH static deny → ledger 记 user_decision=denied', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      const confirmTool = vi.fn().mockResolvedValue({ approved: false })
      await gate.gate(tool, { command: 'rm -rf /' }, makeCtx(), confirmTool)
      expect(ledgerRecordSpy.mock.calls[0][0].user_decision).toBe('denied')
    })

    it('HIGH static 缺字段不弹 confirm 也不记账', async () => {
      const tool = makeTool({
        name: 'bash',
        riskLevel: 'HIGH',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      })
      await gate.gate(tool, {}, makeCtx(), vi.fn())
      expect(ledgerRecordSpy).not.toHaveBeenCalled()
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
      expect(req.summary).toContain('SQL DML')
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
    // v4 Phase 4b: pendingBlock / memory-via-block 路径测试删除 (pending_confirm block 退役)。
    // memory pattern 现在通过 SessionApprovalMemory 静默查询,不在 gate 内显式分支。

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

    // v3.7.2: pass-to-legacy 路径已删 (并入 high-static) — 见上方"路径 1" describe

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
