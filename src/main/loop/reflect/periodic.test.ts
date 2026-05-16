import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateText, mockLedgerRecord } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockLedgerRecord: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  }
})

vi.mock('../../repos/reflection-ledger', () => ({
  reflectionLedger: { record: mockLedgerRecord },
}))

import { PeriodicReflector } from './periodic'
import type { ReflectContext } from './types'

// healthy trajectory: 全部成功 + 文本充足 + 工具多样性 — code-filter 视为无需 LLM
function healthyHistory(n: number): import('../types').StepOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    stepText: 'looked at table ' + i + ' and confirmed columns match expected schema',
    wroteAssistantFinal: false,
    shouldContinue: true,
    durationMs: 100,
    toolNames: [['read', 'glob', 'grep', 'bash'][i % 4]],
    signature: 'sig-' + i,
    allToolsFailed: false,
    containsSubagentFailure: false,
  })) as import('../types').StepOutcome[]
}

// 异常 trajectory: 失败率 > 30%, code-filter 命中 → 触发 LLM
function unhealthyHistory(): import('../types').StepOutcome[] {
  return [
    {
      stepText: '',
      toolNames: ['bash'],
      signature: 'a',
      allToolsFailed: true,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    },
    {
      stepText: '',
      toolNames: ['bash'],
      signature: 'b',
      allToolsFailed: true,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    },
    {
      stepText: 'ok',
      toolNames: ['read'],
      signature: 'c',
      allToolsFailed: false,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    },
    {
      stepText: 'ok',
      toolNames: ['read'],
      signature: 'd',
      allToolsFailed: false,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    },
    {
      stepText: 'ok',
      toolNames: ['read'],
      signature: 'e',
      allToolsFailed: false,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    },
  ] as import('../types').StepOutcome[]
}

function postCtx(
  stepIndex: number,
  history: import('../types').StepOutcome[] = unhealthyHistory(),
): ReflectContext {
  return {
    phase: 'post-step',
    stepIndex,
    userIntent: 'task',
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: history,
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText: 'x', toolNames: [] } as never,
    raw: { stepText: 'x' },
  }
}

beforeEach(() => {
  mockGenerateText.mockReset()
  mockLedgerRecord.mockReset()
})

describe('PeriodicReflector', () => {
  it('非 post-step 返 null', async () => {
    const r = new PeriodicReflector({ every: 5 })
    const ctx = { ...postCtx(4), phase: 'turn-end' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('stepIndex < every-1 → null', async () => {
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(3))).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('stepIndex+1 % every == 0 触发, confidence ≥ 0.5 返 hint', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        progressSoFar: '已完成 X',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: '继续 Y',
        confidence: 0.8,
      }),
    })
    const r = new PeriodicReflector({ every: 5 })
    const out = await r.reflect(postCtx(4)) // stepIndex 4, (4+1)%5==0
    expect(out?.hint).toBeDefined()
    expect(out!.hint!).toMatch(/^\[reflection\]/)
    expect(mockLedgerRecord).toHaveBeenCalled()
  })

  it('confidence < 0.5 → 丢弃 hint 但记 ledger', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        progressSoFar: 'x',
        blockerIdentified: null,
        strategyShift: 'continue',
        nextStepGuidance: 'y',
        confidence: 0.3,
      }),
    })
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(4))).toBeNull()
    expect(mockLedgerRecord).toHaveBeenCalledTimes(1)
  })

  it('blockerIdentified 非空时 hint 含 Blocker:', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        progressSoFar: '已查 3 张表',
        blockerIdentified: '第 4 张表 schema 不全',
        strategyShift: 'switch_tool',
        nextStepGuidance: '试 DESCRIBE',
        confidence: 0.7,
      }),
    })
    const r = new PeriodicReflector({ every: 5 })
    const out = await r.reflect(postCtx(4))
    expect(out!.hint!).toContain('Blocker: 第 4 张表 schema 不全')
  })

  it('LLM 失败 → null', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('LLM down'))
    const r = new PeriodicReflector({ every: 5 })
    expect(await r.reflect(postCtx(4))).toBeNull()
  })

  it('every=0 关闭周期反思', async () => {
    const r = new PeriodicReflector({ every: 0 })
    expect(await r.reflect(postCtx(4))).toBeNull()
    expect(await r.reflect(postCtx(9))).toBeNull()
  })

  describe('code-filter (健康轨迹不调 LLM)', () => {
    it('healthy trajectory (零失败 + 文本充足 + 工具多样) → 直接 null, 零 LLM', async () => {
      const r = new PeriodicReflector({ every: 5 })
      const ctx = postCtx(4, healthyHistory(5))
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('失败率 > 30% → 触发 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          progressSoFar: 'p',
          blockerIdentified: 'blk',
          strategyShift: 'switch_tool',
          nextStepGuidance: 'g',
          confidence: 0.7,
        }),
      })
      const r = new PeriodicReflector({ every: 5 })
      await r.reflect(postCtx(4, unhealthyHistory()))
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('平均文本长度 < 50 字符 → 触发 LLM (tool-only 倾向)', async () => {
      const silentHistory = Array.from({ length: 5 }, (_, i) => ({
        stepText: '', // 全无文本
        toolNames: ['read'],
        signature: 'sig-' + i,
        allToolsFailed: false,
        wroteAssistantFinal: false,
        shouldContinue: true,
        durationMs: 100,
        containsSubagentFailure: false,
      })) as import('../types').StepOutcome[]
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          progressSoFar: 'p',
          blockerIdentified: null,
          strategyShift: 'continue',
          nextStepGuidance: 'g',
          confidence: 0.7,
        }),
      })
      const r = new PeriodicReflector({ every: 5 })
      await r.reflect(postCtx(4, silentHistory))
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('同一工具名连续 ≥ 3 次 → 触发 LLM (低效循环嫌疑)', async () => {
      const repeatHistory = Array.from({ length: 5 }, (_, i) => ({
        stepText: 'querying table ' + i + ' to map foreign keys carefully',
        toolNames: ['mysql_query', 'mysql_query'], // 同步骤连用同一工具
        signature: 'sig-' + i,
        allToolsFailed: false,
        wroteAssistantFinal: false,
        shouldContinue: true,
        durationMs: 100,
        containsSubagentFailure: false,
      })) as import('../types').StepOutcome[]
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          progressSoFar: 'p',
          blockerIdentified: null,
          strategyShift: 'continue',
          nextStepGuidance: 'g',
          confidence: 0.7,
        }),
      })
      const r = new PeriodicReflector({ every: 5 })
      await r.reflect(postCtx(4, repeatHistory))
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })
  })

  describe('防御性 schema (LLM 返回无效值 → catch fallback, 不浪费 LLM 调用)', () => {
    // 异常 trajectory 让 reflector 走到 LLM 调用阶段
    const abnormalHistory = Array.from({ length: 5 }, () => ({
      stepText: '',
      toolNames: ['x'],
      signature: 's',
      allToolsFailed: true,
      wroteAssistantFinal: false,
      shouldContinue: true,
      durationMs: 100,
      containsSubagentFailure: false,
    })) as import('../types').StepOutcome[]

    it('strategyShift 返回非法 enum 值 ("retry"/"stop") → catch 为 "continue"', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          progressSoFar: 'p',
          blockerIdentified: 'b',
          strategyShift: 'retry', // 非法! enum 仅 continue/switch_tool/parallelize/ask_user/wrap_up
          nextStepGuidance: 'g',
          confidence: 0.7,
        }),
      })
      const r = new PeriodicReflector({ every: 5 })
      const out = await r.reflect(postCtx(4, abnormalHistory))
      // 不再 schema fail; 返回 hint (因为 confidence 0.7 >= 0.5)
      expect(out?.hint).toBeDefined()
    })

    it('confidence 越界 (1.5 / -0.1 / "0.8") → catch 为 0.5', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({
          progressSoFar: 'p',
          blockerIdentified: null,
          strategyShift: 'continue',
          nextStepGuidance: 'g',
          confidence: 1.5, // 越界
        }),
      })
      const r = new PeriodicReflector({ every: 5 })
      // 不 schema fail; confidence fallback 0.5 → reflector 自决 (>= 0.5 注入)
      const out = await r.reflect(postCtx(4, abnormalHistory))
      expect(out?.hint).toBeDefined()
    })

    it('完全无效 JSON (空对象) → 全字段 fallback, 走 confidence 0.5 路径', async () => {
      mockGenerateText.mockResolvedValueOnce({ text: '{}' })
      const r = new PeriodicReflector({ every: 5 })
      // 不再 throw / fail; schema 通过, fallback values
      const out = await r.reflect(postCtx(4, abnormalHistory))
      // confidence fallback 0.5 >= 0.5 阈值, 注入空 hint (无 progress / blocker / guidance)
      expect(out?.hint).toBeDefined()
    })
  })
})
