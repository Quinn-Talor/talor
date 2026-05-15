import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { mockGenerateText } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
}))

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai')
  return {
    ...actual,
    generateText: (...args: unknown[]) => mockGenerateText(...args),
  }
})

import { JudgeCompletionReflector } from './judge-completion'
import type { ReflectContext } from './types'

// 默认 ctx 必须触发 score >= 3 让现有"决策路径"测试能进入 LLM judge:
//   - userIntent 含 action verb + 多任务标记
//   - recentHistory 工作量低
//   - 这些信号叠加足以越过阈值
const ACTION_INTENT = '查询 users 表和 orders 表的 schema, 然后写入 result.md'

function makeHistory(toolCalls: string[][]): import('../types').StepOutcome[] {
  return toolCalls.map((names, i) => ({
    stepText: 'step ' + i,
    toolNames: names,
    signature: 'sig-' + i,
    allToolsFailed: false,
    wroteAssistantFinal: false,
    shouldContinue: true,
    durationMs: 100,
    containsSubagentFailure: false,
  })) as import('../types').StepOutcome[]
}

function turnEndCtx(overrides: Partial<ReflectContext> = {}): ReflectContext {
  const base = {
    phase: 'turn-end' as const,
    stepIndex: 0,
    userIntent: ACTION_INTENT,
    sessionId: 's1',
    abortSignal: new AbortController().signal,
    recentHistory: makeHistory([]), // 零 tool, 触发 action+0-tool 信号 (+5)
    reflectModel: {} as never,
    facts: {} as never,
    outcome: { stepText: 'done', toolNames: [] } as never,
    raw: { stepText: 'done' },
    policyDecision: 'final' as const,
  }
  return { ...base, ...overrides } as ReflectContext
}

describe('JudgeCompletionReflector', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
  })

  it('非 turn-end 返 null', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = { ...turnEndCtx(), phase: 'post-step' as const } as never
    expect(await r.reflect(ctx)).toBeNull()
    expect(mockGenerateText).not.toHaveBeenCalled()
  })

  it('outcome.toolNames 非空 → null (final 必无 tool)', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = turnEndCtx({ outcome: { stepText: 'x', toolNames: ['bash'] } as never })
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('outcome.stepText 空 → null', async () => {
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = turnEndCtx({ outcome: { stepText: '', toolNames: [] } as never })
    expect(await r.reflect(ctx)).toBeNull()
  })

  it('complete=true → null (放行 final)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  it('complete=false, confidence>=0.5 → internalNudge (role=user, UI 不渲染)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        complete: false,
        pendingItems: ['Y not done'],
        reason: 'Y missing',
        confidence: 0.8,
      }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const out = await r.reflect(turnEndCtx())
    expect(out?.internalNudge).toBeDefined()
    expect(out!.internalNudge!.role).toBe('user')
    expect(out!.internalNudge!.label).toBe('[reflection-judge]')
    expect(out!.internalNudge!.text).toContain('Y not done')
    // 关键: 不能是 userOutput, 否则会被 UI 渲染
    expect(out!.userOutput).toBeUndefined()
  })

  it('confidence < 0.5 → 丢弃 (放行 final)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ complete: false, pendingItems: ['x'], reason: 'r', confidence: 0.3 }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  it('generateObject 抛错 → null (失败静默, 不阻塞)', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('LLM down'))
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    expect(await r.reflect(turnEndCtx())).toBeNull()
  })

  // ── code-filter: 多信号风险打分 (回归 JudgeCompletion 抓 "幻觉完成" 的原始作用) ──
  describe('code-filter — 风险打分驱动', () => {
    it('询问类 intent + 有工作量 + 具体 final → 低风险, 不调 LLM', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: 'python 中 dict 怎么用?',
        recentHistory: makeHistory([]),
        outcome: {
          stepText:
            'Python dict is a hash map. Example: d = {"key": "value"}. Access via d["key"].',
          toolNames: [],
        } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('信号 A: action intent (查询/创建/写入) + 零 tool 工作量 → 强幻觉, 调 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '查询所有用户',
        recentHistory: makeHistory([]),
        outcome: { stepText: '已经查完了。', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('信号 B: final 声称写入但 trajectory 无 write/edit → 调 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '帮我整理文档',
        recentHistory: makeHistory([['read'], ['read']]), // 只读, 没写
        outcome: { stepText: '已写入到 result.md, 内容包含...', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('信号 B: final 含 "wrote" 但有 write tool → 信号不触发', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '简单任务',
        recentHistory: makeHistory([['write']]), // 确实写了
        outcome: { stepText: 'wrote the result to output.txt.', toolNames: [] } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('信号 C: 多任务 intent (3 张表) + 工作量不足 → 调 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '查 users、orders、products 三张表的 schema',
        recentHistory: makeHistory([['mysql_query']]), // 只查 1 次
        outcome: { stepText: '查询完毕。', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('信号 D: 长复杂 intent + 极短 final → 搪塞嫌疑, 调 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const longIntent =
        '帮我审查这个项目的代码质量，检查所有 src/main/loop 下的文件是否符合最佳实践，' +
        '识别潜在 bug，并给出具体改进建议。重点关注错误处理、类型安全、和测试覆盖率。'
      const ctx = turnEndCtx({
        userIntent: longIntent,
        recentHistory: makeHistory([['read'], ['read']]),
        outcome: { stepText: '已审查完毕，没问题。', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('healthy: 简单 action intent + 充分工作量 + 实质 final → 低风险, 不调 LLM', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '查询 users 表',
        recentHistory: makeHistory([['mysql_query']]),
        outcome: {
          stepText: '查询返回 5 行: alice (admin), bob (user), ...',
          toolNames: [],
        } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })
})
