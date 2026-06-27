import { generateObject } from 'ai'
import { z } from 'zod'
import { getAdapter } from '../providers/model-adapter'
import { recordUsage } from '../providers/usage-recorder'
import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import log from 'electron-log'

/**
 * v4 Phase 5: Memory 压缩结构化 schema (generateObject 替代 generateText free-form)。
 *
 * 字段设计:
 *   - user_intent       — 用户原始意图,锚定整轮目标
 *   - key_facts         — tool 输出建立的关键事实
 *   - pending_actions   — LLM 承诺但未执行的动作(天然解决长对话 promise-then-stop)
 *   - resolved_issues   — 已诊断 + 已修的错误
 *   - current_blocker   — 当前阻塞(可空)
 *
 * 见 docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md §3.4
 */
const CompressionSchema = z.object({
  user_intent: z.string().describe('What the user originally asked for'),
  key_facts: z.array(z.string()).describe('Critical facts established by tool results'),
  pending_actions: z.array(z.string()).describe('Actions LLM committed to but not yet executed'),
  resolved_issues: z.array(z.string()).describe('Errors diagnosed and fixed'),
  current_blocker: z
    .string()
    .nullable()
    .describe('What is currently blocking progress, or null if none'),
})
type CompressionObject = z.infer<typeof CompressionSchema>

/**
 * 把结构化压缩 object 渲染回 markdown,以便插入 messages history。
 * 保留对外接口 string 不变,所有 saveSummary/loadSummary 调用方无感知。
 */
function renderCompressionAsText(obj: CompressionObject): string {
  const lines: string[] = []
  lines.push(`User intent: ${obj.user_intent}`)
  if (obj.key_facts.length > 0) {
    lines.push('')
    lines.push('Key facts established:')
    for (const f of obj.key_facts) lines.push(`  - ${f}`)
  }
  if (obj.pending_actions.length > 0) {
    lines.push('')
    lines.push('Pending actions (LLM committed but not yet executed):')
    for (const a of obj.pending_actions) lines.push(`  - ${a}`)
  }
  if (obj.resolved_issues.length > 0) {
    lines.push('')
    lines.push('Resolved issues:')
    for (const r of obj.resolved_issues) lines.push(`  - ${r}`)
  }
  if (obj.current_blocker) {
    lines.push('')
    lines.push(`Current blocker: ${obj.current_blocker}`)
  }
  return lines.join('\n')
}
import type { ProviderContextConfig } from '../prompt/types'
import type { ExecutionEventBus } from '../chat/events'
import {
  estimate,
  estimateMessage,
  messagesToCoreMessages,
  type MemoryContext,
  type SessionSummary,
} from './types'
import type { ChatMessage } from '../repos/session-repo'

/**
 * 锚点保留策略：最近 N 条 tool 消息 + 对应的 assistant(tool_use) 不进压缩池，
 * 保留原文作为事实依据。摘要再怎么压，这几条永远是可验证的锚点。
 *
 * 为什么是 tool 而不是 user/assistant：工具结果是"外部事实"，压缩风险最大；
 * 用户/助手消息即使被压缩成摘要也通常不影响任务推进。
 */
const TOOL_ANCHOR_COUNT = 4

const COMPRESSION_RETRY_LIMIT = 3
const COMPRESSION_COOLDOWN_MS = 60_000

export class ShortTermMemory {
  private compressionFailures = new Map<string, { count: number; lastAttempt: number }>()

  /**
   * Returns the message context to include in the next LLM call.
   *
   * Path A (below 90% of context_limit): return all messages verbatim.
   * Path B (above threshold): keep the most recent `recent_ratio` of tokens verbatim;
   *   compress everything older into a summary stored in session_summaries.
   *   The summary is reused on subsequent calls as long as `covered_until` hasn't changed.
   *
   * If `events` is provided, emits 'memory.compressed' when a NEW summary is generated
   * (cache hits don't emit — subscribers only care about actual state transitions).
   */
  async getContext(
    sessionId: string,
    config: ProviderContextConfig,
    events?: ExecutionEventBus,
  ): Promise<MemoryContext> {
    const allMessages: ChatMessage[] = messageRepo.listBySession(sessionId)

    if (allMessages.length === 0) {
      return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
    }

    // Pop 最末那条——它由 MessagePlugin 独立注入到 prompt 末尾(Layer 7)。
    // Memory 只处理"真·历史",压缩判定/recent 切分/锚点抽取全部基于 history。
    // 原因:
    //   1. 末尾消息在 MessagePlugin 注入,Memory 再带一遍会重复
    //   2. 当前 turn 的 user 消息不应触发历史压缩
    //   3. SDK 看到的 [Memory 输出] + [MessagePlugin 输出] 顺序即标准 ReAct:
    //      history 末尾若是 assistant(tool_use) → MessagePlugin 注入 tool(result) → 配对完整
    const history: ChatMessage[] = allMessages.slice(0, -1)

    if (history.length === 0) {
      return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
    }

    const totalTokens = history.reduce((sum, m) => sum + estimateMessage(m), 0)
    const threshold = 0.9 * config.context_limit
    const recentBudget = config.recent_ratio * config.context_limit

    // Path A: below threshold
    if (totalTokens <= threshold) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(history),
        tokenEstimate: totalTokens,
      }
    }

    // Path B: above threshold — split recent / old
    const recentMessages: ChatMessage[] = []
    let recentTokens = 0

    for (const msg of [...history].reverse()) {
      const est = estimateMessage(msg)
      if (recentTokens + est <= recentBudget) {
        recentMessages.unshift(msg)
        recentTokens += est
      } else {
        break
      }
    }

    const oldMessages = history.slice(0, history.length - recentMessages.length)

    // Edge case: all messages fit in recent window
    if (oldMessages.length === 0) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(history),
        tokenEstimate: totalTokens,
      }
    }

    // ⚓ 锚点抽取：从 oldMessages 尾部抽最近 N 条 tool（含配对的 assistant(tool_use)），
    // 它们不参与压缩，保留原文。压缩池是剩下的更早消息。
    const { anchors, compressible } = splitAnchorsAndCompressible(oldMessages, TOOL_ANCHOR_COUNT)

    // Edge case: 没东西可压缩（全是锚点），直接返回 anchors + recent
    if (compressible.length === 0) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages([...anchors, ...recentMessages]),
        tokenEstimate: totalTokens,
      }
    }

    const lastCompressedId = compressible[compressible.length - 1].id
    const summaryBudget = config.summary_ratio * config.context_limit
    const existing = this.loadSummary(sessionId)

    let summaryText: string

    if (existing === null || existing.covered_until !== lastCompressedId) {
      const failState = this.compressionFailures.get(sessionId)
      const shouldSkipRetry =
        failState &&
        failState.count >= COMPRESSION_RETRY_LIMIT &&
        Date.now() - failState.lastAttempt < COMPRESSION_COOLDOWN_MS

      if (shouldSkipRetry) {
        log.warn(
          `[ShortTermMemory] skipping summary retry: ${failState!.count} failures, cooldown active`,
        )
        return {
          summaryMessage: {
            role: 'system',
            content:
              `[CONTEXT GAP WARNING] Summary generation failed ${failState!.count} times and is on cooldown. ` +
              `${compressible.length} earlier messages from this conversation are NOT visible in this turn. ` +
              `Do NOT make claims that rely on that hidden history. ` +
              `If the user references earlier work, tell them history compression failed and ask for a recap.`,
          },
          recentMessages: messagesToCoreMessages([...anchors, ...recentMessages]),
          tokenEstimate: recentTokens,
        }
      }

      try {
        summaryText = await generateSummary(
          existing?.summary_text ?? null,
          compressible,
          summaryBudget,
          config,
          sessionId,
        )
        this.saveSummary(sessionId, summaryText, lastCompressedId, estimate(summaryText))
        this.compressionFailures.delete(sessionId)
        events?.emit({ type: 'memory.compressed', coveredUntilMessageId: lastCompressedId })
      } catch (err) {
        const prev = this.compressionFailures.get(sessionId)
        this.compressionFailures.set(sessionId, {
          count: (prev?.count ?? 0) + 1,
          lastAttempt: Date.now(),
        })
        log.warn(
          `[ShortTermMemory] summary generation failed (attempt ${(prev?.count ?? 0) + 1}), returning gap warning`,
          err,
        )
        return {
          summaryMessage: {
            role: 'system',
            content:
              `[CONTEXT GAP WARNING] Summary generation failed. ` +
              `${compressible.length} earlier messages from this conversation are NOT visible in this turn. ` +
              `Do NOT make claims that rely on that hidden history. ` +
              `If the user references earlier work, tell them history compression failed and ask for a recap.`,
          },
          recentMessages: messagesToCoreMessages([...anchors, ...recentMessages]),
          tokenEstimate: recentTokens,
        }
      }
    } else {
      summaryText = existing.summary_text
    }

    // 摘要标题明确声明"可能不完整"——抑制模型继承到推断结论当事实。
    // 锚点追加一段提示，把"事实依据"位置点给模型看。
    return {
      summaryMessage: {
        role: 'system',
        content:
          `[Conversation summary — may be incomplete. If it conflicts with the raw tool outputs below, trust the raw outputs.]\n${summaryText}\n\n` +
          `[The raw tool_use / tool_result messages below are preserved verbatim and should be treated as authoritative facts.]`,
      },
      recentMessages: messagesToCoreMessages([...anchors, ...recentMessages]),
      tokenEstimate: estimate(summaryText) + recentTokens,
    }
  }

  private loadSummary(sessionId: string): SessionSummary | null {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM session_summaries WHERE session_id = ?')
      .get(sessionId) as SessionSummary | null
    if (!row || !row.covered_until) return null
    return row
  }

  private saveSummary(
    sessionId: string,
    text: string,
    coveredUntil: string,
    tokenEst: number,
  ): void {
    const db = getDb()
    db.prepare(
      `
      INSERT OR REPLACE INTO session_summaries
        (session_id, summary_text, covered_until, token_estimate, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(sessionId, text, coveredUntil, tokenEst, new Date().toISOString())
  }
}

/**
 * 从 oldMessages 尾部抽取最近 N 条 tool 消息作为锚点（含配对的 assistant(tool_use)）。
 * 剩下的是 compressible 池，参与摘要压缩。
 *
 * 为什么要连带 assistant(tool_use)：AI SDK 约束"每个 tool_result 必须有对应 tool_use"，
 * 只保留 tool 而不保留 assistant 会让 SDK rebuild 时报错。
 */
function splitAnchorsAndCompressible(
  oldMessages: ChatMessage[],
  anchorCount: number,
): { anchors: ChatMessage[]; compressible: ChatMessage[] } {
  if (anchorCount <= 0) return { anchors: [], compressible: oldMessages }

  const anchorIdx = new Set<number>()
  let toolSeen = 0
  for (let i = oldMessages.length - 1; i >= 0 && toolSeen < anchorCount; i--) {
    if (oldMessages[i].role === 'tool') {
      anchorIdx.add(i)
      // 向前回溯配对的 assistant(tool_use)
      if (i > 0 && oldMessages[i - 1].role === 'assistant') {
        anchorIdx.add(i - 1)
      }
      toolSeen++
    }
  }

  const anchors: ChatMessage[] = []
  const compressible: ChatMessage[] = []
  for (let i = 0; i < oldMessages.length; i++) {
    if (anchorIdx.has(i)) anchors.push(oldMessages[i])
    else compressible.push(oldMessages[i])
  }
  return { anchors, compressible }
}

async function generateSummary(
  prevSummary: string | null,
  oldMessages: ChatMessage[],
  summaryBudget: number,
  config: ProviderContextConfig,
  sessionId: string,
): Promise<string> {
  const summaryBudgetChars = summaryBudget * 3
  const MAX_CONTENT_BYTES = 8192

  const parts: string[] = []
  if (prevSummary !== null) {
    // prevSummary 明确标为"参考，可能有误"——禁止把它继承为事实结论。
    parts.push(`[Existing summary — reference only, may be incomplete or wrong]\n${prevSummary}`)
  }
  parts.push('[Conversation to compress]')
  for (const msg of oldMessages) {
    let textContent: string
    try {
      const blocks = JSON.parse(msg.content) as Array<{
        type: string
        text?: string
        output?: { type: string; value: string } | string
        input?: unknown
        isError?: boolean
        toolName?: string
      }>
      const texts: string[] = []
      for (const b of blocks) {
        if (b.type === 'text' && b.text) texts.push(b.text)
        else if (b.type === 'reasoning' && b.text) texts.push(`[reasoning: ${b.text}]`)
        else if (b.type === 'tool-result' && b.output) {
          const outputStr =
            typeof b.output === 'string' ? b.output : ((b.output as { value: string })?.value ?? '')
          const errTag = b.isError ? ' ERROR' : ''
          const toolTag = b.toolName ? ` tool=${b.toolName}` : ''
          texts.push(`[tool-result${errTag}${toolTag}: ${outputStr}]`)
        } else if (b.type === 'tool-call' && b.input)
          texts.push(`[tool-call: ${JSON.stringify(b.input)}]`)
      }
      textContent = texts.join('\n')
    } catch {
      textContent = msg.content
    }
    const byteLen = Buffer.byteLength(textContent, 'utf8')
    const raw =
      byteLen > MAX_CONTENT_BYTES
        ? textContent.slice(0, Math.floor(MAX_CONTENT_BYTES * 0.8)) + '…[truncated]'
        : textContent
    if (raw.trim()) parts.push(`${msg.role}: ${raw}`)
  }

  const userContent = parts.join('\n\n')
  const systemPrompt =
    `You compress conversation history into a structured summary.\n` +
    `\n` +
    `Source the summary only from what actually appeared above:\n` +
    `- Quote literal content for facts, requests, tool calls, tool outputs.\n` +
    `- Preserve tool errors verbatim. Never rewrite failures as successes.\n` +
    `- Never infer unstated intent, conclusions, or causes.\n` +
    `- Never fabricate paths, names, numbers, code, signatures. Write "unspecified" when unclear.\n` +
    `\n` +
    `Field discipline:\n` +
    `- user_intent: 1-2 sentences.\n` +
    `- key_facts: only facts established by actual tool results.\n` +
    `- pending_actions: things the assistant committed to but did NOT execute (no matching tool call).\n` +
    `- resolved_issues: errors diagnosed AND fixed.\n` +
    `- current_blocker: set only when work is stuck; otherwise null.\n` +
    `\n` +
    `Respond in English. Total output ≤ ~${summaryBudgetChars} characters.`

  const model = getAdapter(config.provider.type).createModel(config.provider, 'default')
  const { object, usage, providerMetadata } = await generateObject({
    model,
    schema: CompressionSchema,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    maxOutputTokens: Math.ceil(summaryBudget),
    abortSignal: AbortSignal.timeout(60_000),
    allowSystemInMessages: true, // v7: system 走 messages 数组
  })
  recordUsage(sessionId, usage, providerMetadata as Record<string, unknown> | undefined)

  const text = renderCompressionAsText(object)
  log.info(
    `[ShortTermMemory] summary generated (structured) — ` +
      `facts=${object.key_facts.length} pending=${object.pending_actions.length} ` +
      `resolved=${object.resolved_issues.length} blocker=${object.current_blocker !== null} ` +
      `chars=${text.length}`,
  )
  return text
}
