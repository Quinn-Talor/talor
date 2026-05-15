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

  it('complete=false, confidence>=0.5 → internalNudge (role=system, 监督指令身份)', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        complete: false,
        pendingItems: ['Y not done'],
        reason: 'Y missing',
        confidence: 0.8,
      }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    // chain 通常会注入 perTurnIndex; 这里手动塞模拟首次触发
    const ctx = { ...turnEndCtx(), perTurnIndex: 1, perTurnLimit: 2 } as ReflectContext
    const out = await r.reflect(ctx)
    expect(out?.internalNudge).toBeDefined()
    // 'system' 而非 'user' — reflect 是系统级监督, 不是用户输入
    // 不冒充用户避免 history 污染 + prompt injection 攻击面
    expect(out!.internalNudge!.role).toBe('system')
    expect(out!.internalNudge!.label).toBe('[reflection-judge]')
    expect(out!.internalNudge!.text).toContain('Y not done')
    // counter 标记本次是 1/2
    expect(out!.internalNudge!.text).toContain('Supervision check 1/2')
    // 关键: 不能是 userOutput, 否则会被 UI 渲染
    expect(out!.userOutput).toBeUndefined()
  })

  it('perTurnIndex 达 maxPerTurn → text 含 "last allowed" 提示', async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        complete: false,
        pendingItems: ['x'],
        reason: 'r',
        confidence: 0.8,
      }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    const ctx = { ...turnEndCtx(), perTurnIndex: 2, perTurnLimit: 2 } as ReflectContext
    const out = await r.reflect(ctx)
    expect(out!.internalNudge!.text).toContain('Supervision check 2/2')
    expect(out!.internalNudge!.text).toContain('Last allowed supervision')
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

  it('防御性 schema: 漏字段 (e.g. DeepSeek 输出残缺) → fallback 默认值, 行为等效 complete=true', async () => {
    // 模拟 provider 仅输出 reason, 缺 complete / confidence / pendingItems
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({ reason: 'partial output' }),
    })
    const r = new JudgeCompletionReflector({ sessionId: 's1' })
    // complete 默认 true → reflector 返 null 放行 final, 不浪费这次 LLM 调用
    const out = await r.reflect(turnEndCtx())
    expect(out).toBeNull()
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

    it('ACTION_VERBS 覆盖探索类中文 imperative ("看 X" / "看看" / "列出" / "总结")', async () => {
      // 所有这些都属于 action intent (执行类), 零工作量时应该信号 A 触发
      const exploreCases = [
        '看 game 数据库里有什么',
        '看看 game 数据库',
        '看一下 users 表',
        '列出所有表',
        '总结 schema',
        '探索这个项目',
        '梳理一下代码结构',
        '浏览这个 repo',
        '比较 v1 和 v2',
        'show me all tables',
        'list everything',
        'browse the repo',
        'summarize the data',
      ]
      for (const intent of exploreCases) {
        mockGenerateText.mockReset()
        mockGenerateText.mockResolvedValueOnce({
          text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
        })
        const r = new JudgeCompletionReflector({ sessionId: 's1' })
        const ctx = turnEndCtx({
          userIntent: intent,
          recentHistory: makeHistory([]),
          outcome: { stepText: '已经做完了。', toolNames: [] } as never,
        })
        await r.reflect(ctx)
        // 命中后, score=5 (action + 0 tools) >= 阈值, 触发 LLM
        expect(
          mockGenerateText,
          `intent "${intent}" should match ACTION_VERBS`,
        ).toHaveBeenCalledTimes(1)
      }
    })

    it('ACTION_VERBS 仍排除询问类 ("解释" / "什么是" / "为什么")', async () => {
      const questionCases = [
        '解释 React hooks',
        '什么是 dict',
        '为什么 useState 这样设计',
        'what is JSX',
        'why does promise need then',
      ]
      for (const intent of questionCases) {
        mockGenerateText.mockReset()
        const r = new JudgeCompletionReflector({ sessionId: 's1' })
        const ctx = turnEndCtx({
          userIntent: intent,
          recentHistory: makeHistory([]),
          outcome: { stepText: 'Some explanation', toolNames: [] } as never,
        })
        await r.reflect(ctx)
        expect(
          mockGenerateText,
          `question intent "${intent}" should NOT match ACTION_VERBS`,
        ).not.toHaveBeenCalled()
      }
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

    // ── 信号 E: 完整性 claim — 抓开放探索 final 主观判定 "完整" ──
    it('信号 E: 完整性 claim ("齐全了") + 长 trajectory (>=5 步) → 调 LLM', async () => {
      mockGenerateText.mockResolvedValueOnce({
        text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
      })
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      // 截图场景: 开放探索 + 大量工作 + 主观完整宣告
      const ctx = turnEndCtx({
        userIntent: '看看 game 数据库',
        recentHistory: makeHistory([
          ['mysql_query'],
          ['mysql_query', 'mysql_query'],
          ['mysql_query'],
          ['mysql_query', 'mysql_query', 'mysql_query'],
          ['mysql_query'],
        ]), // 5 步 + 多工具
        outcome: { stepText: '数据齐全了！all tables covered。', toolNames: [] } as never,
      })
      await r.reflect(ctx)
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('信号 E 各完整性词都命中: 齐全 / 完整 / 完毕 / 所有 / 全部 / 整理好 / 都查 / covered all / fully', async () => {
      const claims = [
        '数据齐全了',
        '完整地探索完毕',
        '所有表都查到了',
        '全部字段都列出来了',
        '已整理好',
        '都查完了',
        'covered all tables',
        'fully explored the schema',
      ]
      for (const final of claims) {
        mockGenerateText.mockReset()
        mockGenerateText.mockResolvedValueOnce({
          text: JSON.stringify({ complete: true, pendingItems: [], reason: 'ok', confidence: 0.9 }),
        })
        const r = new JudgeCompletionReflector({ sessionId: 's1' })
        const ctx = turnEndCtx({
          userIntent: '看看数据库',
          recentHistory: makeHistory([
            ['mysql_query'],
            ['mysql_query'],
            ['mysql_query'],
            ['mysql_query'],
            ['mysql_query'],
          ]),
          outcome: { stepText: final, toolNames: [] } as never,
        })
        await r.reflect(ctx)
        expect(mockGenerateText, `claim "${final}" should trigger judge`).toHaveBeenCalledTimes(1)
      }
    })

    it('信号 E: 短 trajectory (<5 步) 即使含完整性 claim → 不触发 (短任务豁免)', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '查这张表',
        recentHistory: makeHistory([['mysql_query']]), // 仅 1 步
        outcome: { stepText: '查询完毕, 所有数据都拿到了。', toolNames: [] } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })

    it('信号 E: 长 trajectory 但 final 不含完整性 claim → 不触发 (健康路径)', async () => {
      const r = new JudgeCompletionReflector({ sessionId: 's1' })
      const ctx = turnEndCtx({
        userIntent: '看看数据库',
        recentHistory: makeHistory([
          ['mysql_query'],
          ['mysql_query'],
          ['mysql_query'],
          ['mysql_query'],
          ['mysql_query'],
        ]),
        outcome: {
          stepText: '已查询 15 张表 schema, 未深入索引详情, 要继续吗?',
          toolNames: [],
        } as never,
      })
      expect(await r.reflect(ctx)).toBeNull()
      expect(mockGenerateText).not.toHaveBeenCalled()
    })
  })
})
