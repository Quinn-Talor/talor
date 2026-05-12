import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((s: AbortSignal) => s),
}))

vi.mock('./quote-verifier', () => ({
  verifyQuotedFacts: vi.fn((cleaned: string) => ({ cleaned, unverifiedCount: 0 })),
  verifyEntityGrounding: vi.fn((cleaned: string) => ({
    cleaned,
    ungroundedCount: 0,
    ungroundedEntities: [] as string[],
  })),
}))

import { verifyQuotedFacts, verifyEntityGrounding } from './quote-verifier'

const {
  mockMessageCreate,
  mockMessageListBySession,
  mockSessionTouch,
  mockStreamText,
  mockLedgerBuildSummary,
} = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockMessageListBySession: vi.fn(() => [] as unknown[]),
  mockSessionTouch: vi.fn(),
  mockStreamText: vi.fn(),
  mockLedgerBuildSummary: vi.fn(() => ''),
}))

vi.mock('../repos/session-repo', () => ({
  messageRepo: { create: mockMessageCreate, listBySession: mockMessageListBySession },
  sessionRepo: { touch: mockSessionTouch },
}))

vi.mock('../repos/side-effect-ledger', () => ({
  sideEffectLedger: { buildSummary: mockLedgerBuildSummary },
}))

vi.mock('ai', () => ({ streamText: (...args: unknown[]) => mockStreamText(...args) }))

import {
  runForcedSummary,
  stripToolCallMarkup,
  FALLBACK_SUMMARY_OPTS,
  failureStreakSummaryOpts,
  forcedClosureSummaryOpts,
  signatureDeadLoopSummaryOpts,
  type ForcedSummaryCtx,
} from './forced-summary'

function makeCtx(): ForcedSummaryCtx {
  return {
    sessionId: 's1',
    userContent: 'test',
    mappedAttachments: [],
    abortSignal: new AbortController().signal,
    pipeline: {
      build: vi.fn().mockResolvedValue({ messages: [], tools: [] }),
    } as unknown as ForcedSummaryCtx['pipeline'],
    provider: {} as ForcedSummaryCtx['provider'],
    providerConfig: {} as ForcedSummaryCtx['providerConfig'],
    workspace: '/tmp',
    model: {} as ForcedSummaryCtx['model'],
    agent: {} as ForcedSummaryCtx['agent'],
    agentId: '__chat__',
    skillTracker: {} as ForcedSummaryCtx['skillTracker'],
    events: {} as ForcedSummaryCtx['events'],
    callbacks: { onTextDelta: vi.fn() },
    turnStartTime: '2026-05-12T00:00:00.000Z',
  }
}

function mockTextStream(text: string) {
  mockStreamText.mockReturnValue({
    textStream: (async function* () {
      yield text
    })(),
  })
}

describe('runForcedSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // mockReset 清 mockReturnValueOnce 残留队列, 再设默认 impl, 避免 case 间污染
    vi.mocked(verifyQuotedFacts).mockReset()
    vi.mocked(verifyEntityGrounding).mockReset()
    vi.mocked(verifyQuotedFacts).mockImplementation((cleaned: string) => ({
      cleaned,
      unverifiedCount: 0,
    }))
    vi.mocked(verifyEntityGrounding).mockImplementation((cleaned: string) => ({
      cleaned,
      ungroundedCount: 0,
      ungroundedEntities: [],
    }))
  })

  describe('FALLBACK_SUMMARY_OPTS', () => {
    it('正常输出 → 落库带 [auto-summary] label', async () => {
      mockTextStream('the answer is X')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      expect(mockMessageCreate).toHaveBeenCalledTimes(1)
      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[auto-summary]')
      expect(text).toContain('the answer is X')
    })

    it('空输出 → 不落库 (fallback summary 设计)', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)
      expect(mockMessageCreate).not.toHaveBeenCalled()
    })
  })

  describe('failureStreakSummaryOpts', () => {
    it('正常输出 → 落库带 [failure-recovery] label', async () => {
      mockTextStream('failed because X')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[failure-recovery]')
      expect(text).toContain('failed because X')
    })

    it('空输出 → 用 fallbackTextIfEmpty', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('unable to complete the task after 3 consecutive tool failures')
    })
  })

  describe('forcedClosureSummaryOpts', () => {
    it('模型输出含 marker → 落库不补 ⏸', async () => {
      mockTextStream('summary ✓ Done')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure]')
      expect(text).toContain('✓ Done')
      expect(text).not.toContain('please re-engage')
    })

    it('模型输出无 marker → 服务端补 ⏸ Blocked', async () => {
      mockTextStream('vague text')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure]')
      expect(text).toContain('vague text')
      expect(text).toContain('⏸ Blocked')
      expect(text).toContain('please re-engage')
    })

    it('空输出 → 用 fallbackTextIfEmpty + 补 ⏸ Blocked', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('Cannot determine task state')
      expect(text).toContain('⏸ Blocked')
    })
  })

  describe('Verify tag 拼接 (applyVerification=true 路径)', () => {
    it('unverifiedCount > 0 → label 含 "N unverifiable quote(s) masked"', async () => {
      vi.mocked(verifyQuotedFacts).mockReturnValueOnce({
        cleaned: 'redacted output',
        unverifiedCount: 2,
      })
      mockTextStream('original output')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toMatch(/^\[auto-summary • 2 unverifiable quotes masked\]/)
      expect(text).toContain('redacted output')
    })

    it('unverifiedCount=1 → 单数 "quote"', async () => {
      vi.mocked(verifyQuotedFacts).mockReturnValueOnce({
        cleaned: 'x',
        unverifiedCount: 1,
      })
      mockTextStream('x')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toMatch(/1 unverifiable quote masked/)
    })

    it('ungroundedCount > 0 → label 含 "N ungrounded entity/entities masked"', async () => {
      vi.mocked(verifyEntityGrounding).mockReturnValueOnce({
        cleaned: 'output',
        ungroundedCount: 3,
        ungroundedEntities: ['e1', 'e2', 'e3'],
      })
      mockTextStream('original')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toMatch(/3 ungrounded entities masked/)
    })

    it('ungroundedCount=1 → 单数 "entity"', async () => {
      vi.mocked(verifyEntityGrounding).mockReturnValueOnce({
        cleaned: 'x',
        ungroundedCount: 1,
        ungroundedEntities: ['e1'],
      })
      mockTextStream('x')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toMatch(/1 ungrounded entity masked/)
    })

    it('两种 verify tag 同时触发 → 用 "; " 连接', async () => {
      vi.mocked(verifyQuotedFacts).mockReturnValueOnce({
        cleaned: 'x',
        unverifiedCount: 2,
      })
      vi.mocked(verifyEntityGrounding).mockReturnValueOnce({
        cleaned: 'x',
        ungroundedCount: 1,
        ungroundedEntities: ['e1'],
      })
      mockTextStream('y')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toMatch(
        /^\[failure-recovery • 2 unverifiable quotes masked; 1 ungrounded entity masked\]/,
      )
    })

    it('forced-closure 关闭 verify (applyVerification=false) → 即便 mock 返回 N>0 label 不带 tag', async () => {
      vi.mocked(verifyQuotedFacts).mockReturnValueOnce({
        cleaned: 'should not be used',
        unverifiedCount: 99,
      })
      mockTextStream('summary ✓ Done')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      // forced-closure 不跑 verify, label 干净
      expect(text).toContain('[forced-closure]')
      expect(text).not.toMatch(/unverifiable/)
    })
  })

  describe('signatureDeadLoopSummaryOpts', () => {
    it('isError=true: 正常输出 → 落库带 [signature-dead-loop] label', async () => {
      mockTextStream('I kept calling SHOW TABLES FROM game; same error.')
      await runForcedSummary(
        makeCtx(),
        0,
        signatureDeadLoopSummaryOpts('mysql_query#abc:def', 1, true),
      )

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[signature-dead-loop]')
      expect(text).toContain('SHOW TABLES')
    })

    it('isError=false: 重复同 input 同 output (无 error) → 同样收尾', async () => {
      mockTextStream('I kept getting the same result.')
      await runForcedSummary(makeCtx(), 0, signatureDeadLoopSummaryOpts('read#xy:zw', 2, false))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[signature-dead-loop]')
    })

    it('空输出 → 用 fallbackTextIfEmpty', async () => {
      mockTextStream('')
      await runForcedSummary(makeCtx(), 0, signatureDeadLoopSummaryOpts('tool#a:b', 1, true))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('kept calling the same tool')
      expect(text).toContain('2 times') // repeatCount + 1
    })

    it('pipeline.build 抛错 → errorFallbackText 含 ⏸ Blocked', async () => {
      const ctx = makeCtx()
      ctx.pipeline.build = vi.fn().mockRejectedValue(new Error('boom'))
      await runForcedSummary(ctx, 0, signatureDeadLoopSummaryOpts('tool#a:b', 1, true))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[signature-dead-loop failed]')
      expect(text).toContain('⏸ Blocked')
    })
  })

  describe('stripToolCallMarkup (公开 helper)', () => {
    it('ASCII pipe 变体 <||...> → ⟨tool-call-attempt⟩', () => {
      const input = 'before <||DSML||tool_calls> after'
      expect(stripToolCallMarkup(input)).toContain('⟨tool-call-attempt⟩')
      expect(stripToolCallMarkup(input)).not.toContain('<||')
    })

    it('全角 pipe 变体 <｜｜...> → ⟨tool-call-attempt⟩ (本次 bug)', () => {
      const input = '好的方案 <｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="mysql_query">'
      const out = stripToolCallMarkup(input)
      expect(out).toContain('⟨tool-call-attempt⟩')
      expect(out).not.toContain('<｜｜')
    })

    it('XML 标签 <invoke> <parameter> <tool_call> → 移除', () => {
      const input = '<invoke name="x"><parameter name="y">z</parameter></invoke>'
      const out = stripToolCallMarkup(input)
      expect(out).not.toContain('<invoke')
      expect(out).not.toContain('<parameter')
      expect(out).toBe('z')
    })

    it('多个连续占位符合并 → 单个', () => {
      const input = '<||A||><||B||><||C||>'
      const out = stripToolCallMarkup(input)
      // 连续多个 ⟨tool-call-attempt⟩ 合并为 1 个
      expect(out.match(/⟨tool-call-attempt⟩/g)?.length).toBe(1)
    })

    it('空字符串 → 空', () => {
      expect(stripToolCallMarkup('')).toBe('')
    })

    it('无 markup 的文本 → 原样', () => {
      const plain = 'just some plain text without markup'
      expect(stripToolCallMarkup(plain)).toBe(plain)
    })
  })

  describe('Strip markup 在 applyVerification=false 路径也跑 (A2 修复)', () => {
    it('forced-closure 输出含全角 DSML markup → 被剥', async () => {
      const polluted =
        '好,方案确认了。<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="mysql_query">SELECT *</｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>'
      mockTextStream(polluted)
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(5))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      // markup 全部被剥 (包括 invoke 闭合标签)
      expect(text).not.toContain('<｜｜DSML｜｜')
      expect(text).not.toContain('<invoke')
      // 占位符出现
      expect(text).toContain('⟨tool-call-attempt⟩')
      // 业务文本保留
      expect(text).toContain('方案确认了')
      // forced-closure 兜底补 ⏸ Blocked (因为输出无 marker)
      expect(text).toContain('⏸ Blocked')
    })

    it('fallback-summary 也跑 strip (applyVerification=true 路径,与 verify 解耦)', async () => {
      mockTextStream('result <||DSML||tool_calls> 是这样')
      await runForcedSummary(makeCtx(), 0, FALLBACK_SUMMARY_OPTS)

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).not.toContain('<||')
      expect(text).toContain('⟨tool-call-attempt⟩')
    })
  })

  describe('错误兜底', () => {
    it('pipeline.build 抛错 → 落 errorFallbackText', async () => {
      const ctx = makeCtx()
      ctx.pipeline.build = vi.fn().mockRejectedValue(new Error('build failed'))
      await runForcedSummary(ctx, 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[auto-halt]')
      expect(text).toContain('Task blocked by 3 consecutive tool failures')
    })

    it('forced-closure 错误兜底文案含 ⏸ Blocked', async () => {
      const ctx = makeCtx()
      ctx.pipeline.build = vi.fn().mockRejectedValue(new Error('boom'))
      await runForcedSummary(ctx, 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('[forced-closure failed]')
      expect(text).toContain('⏸ Blocked')
    })
  })

  describe('v3.6 — sideEffectLedger summary 拼接', () => {
    it('ledger 有 entries → forced summary 内嵌 "Side effects this turn"', async () => {
      mockLedgerBuildSummary.mockReturnValueOnce(
        '\n## Side effects this turn\n\n- ✓ sql:INSERT on game.rule (approved)',
      )
      mockTextStream('Inserted 1 row')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('Inserted 1 row')
      expect(text).toContain('## Side effects this turn')
      expect(text).toContain('sql:INSERT on game.rule')
    })

    it('ledger 空 → 不附加 ledger 区块', async () => {
      mockLedgerBuildSummary.mockReturnValueOnce('')
      mockTextStream('plain summary')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('plain summary')
      expect(text).not.toContain('Side effects this turn')
    })

    it('ledger.buildSummary 抛错 → forced summary 不中断, 不附加', async () => {
      mockLedgerBuildSummary.mockImplementationOnce(() => {
        throw new Error('db error')
      })
      mockTextStream('summary continues')
      await runForcedSummary(makeCtx(), 0, failureStreakSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('summary continues')
      expect(text).not.toContain('Side effects')
    })

    it('forced-closure 也拼接 ledger', async () => {
      mockLedgerBuildSummary.mockReturnValueOnce(
        '\n## Side effects this turn\n\n- ✓ file:write on /tmp/x (approved)',
      )
      mockTextStream('Cannot determine')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('Side effects this turn')
      // forced-closure 仍在文本末尾补 ⏸ Blocked
      expect(text).toContain('⏸ Blocked')
    })

    it('opts.includeLedgerSummary=false → 跳过 ledger 调用', async () => {
      mockLedgerBuildSummary.mockReturnValue('SHOULD_NOT_APPEAR')
      mockTextStream('clean summary')
      await runForcedSummary(makeCtx(), 0, {
        ...failureStreakSummaryOpts(3),
        includeLedgerSummary: false,
      })

      const text = mockMessageCreate.mock.calls[0][0].content[0].text
      expect(text).toContain('clean summary')
      expect(text).not.toContain('SHOULD_NOT_APPEAR')
      expect(mockLedgerBuildSummary).not.toHaveBeenCalled()
    })
  })

  describe('v3.6 — guardrail 教模型优先 talor block', () => {
    /** 从 mockStreamText 的最后一次调用里捕获 guardrail system message 的 content */
    function extractLastGuardrailContent(): string {
      const lastCall = mockStreamText.mock.calls[mockStreamText.mock.calls.length - 1]
      const args = lastCall[0] as { messages: Array<{ role: string; content: string }> }
      // guardrail 总是 messages 数组末尾的 system message (pipeline.build 返回 [] + 追加 guardrail)
      const last = args.messages[args.messages.length - 1]
      return last.content
    }

    it('forcedClosureSummaryOpts: guardrail 含 done/need_input/blocked talor block 模板', async () => {
      mockTextStream('summary ✓ Done')
      await runForcedSummary(makeCtx(), 0, forcedClosureSummaryOpts(3))
      const guardrail = extractLastGuardrailContent()
      // talor block 优先 — 三种 type 都列出来
      expect(guardrail).toMatch(/```talor/)
      expect(guardrail).toContain('"type":"done"')
      expect(guardrail).toContain('"type":"need_input"')
      expect(guardrail).toContain('"type":"blocked"')
      // legacy fallback 保留
      expect(guardrail).toContain('✓ Done')
      expect(guardrail).toContain('❓ Need input')
      expect(guardrail).toContain('⏸ Blocked')
      // 反"伪工具调用 markup"段保留
      expect(guardrail).toContain('pseudo tool-call syntax')
    })

    it('signatureDeadLoopSummaryOpts: guardrail 含 need_input/blocked talor block 模板', async () => {
      mockTextStream('repeated error.')
      await runForcedSummary(makeCtx(), 0, signatureDeadLoopSummaryOpts('tool#a:b', 1, true))
      const guardrail = extractLastGuardrailContent()
      expect(guardrail).toMatch(/```talor/)
      expect(guardrail).toContain('"type":"need_input"')
      expect(guardrail).toContain('"type":"blocked"')
      // legacy fallback 保留
      expect(guardrail).toContain('❓ Need input')
      expect(guardrail).toContain('⏸ Blocked')
      // signature 仍透传给模型 (重要诊断信息)
      expect(guardrail).toContain('tool#a:b')
    })
  })
})
