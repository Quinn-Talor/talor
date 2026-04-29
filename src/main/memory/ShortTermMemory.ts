import { generateText } from 'ai'
import { createModel } from '../providers/llm-provider'
import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import log from 'electron-log'
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

export class ShortTermMemory {
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

    const totalTokens = allMessages.reduce((sum, m) => sum + estimateMessage(m), 0)
    const threshold    = 0.90 * config.context_limit
    const recentBudget = config.recent_ratio * config.context_limit

    // Path A: below threshold
    if (totalTokens <= threshold) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(allMessages),
        tokenEstimate: totalTokens,
      }
    }

    // Path B: above threshold — split recent / old
    const recentMessages: ChatMessage[] = []
    let recentTokens = 0

    for (const msg of [...allMessages].reverse()) {
      const est = estimateMessage(msg)
      if (recentTokens + est <= recentBudget) {
        recentMessages.unshift(msg)
        recentTokens += est
      } else {
        break
      }
    }

    const oldMessages = allMessages.slice(0, allMessages.length - recentMessages.length)

    // Edge case: all messages fit in recent window
    if (oldMessages.length === 0) {
      return {
        summaryMessage: null,
        recentMessages: messagesToCoreMessages(allMessages),
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
      try {
        summaryText = await generateSummary(
          existing?.summary_text ?? null,
          compressible,
          summaryBudget,
          config,
        )
        this.saveSummary(sessionId, summaryText, lastCompressedId, estimate(summaryText))
        events?.emit({ type: 'memory.compressed', coveredUntilMessageId: lastCompressedId })
      } catch (err) {
        log.warn('[ShortTermMemory] summary generation failed, falling back to anchors+recent', err)
        return {
          summaryMessage: null,
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
    const row = db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(sessionId) as SessionSummary | null
    if (!row || !row.covered_until) return null
    return row
  }

  private saveSummary(sessionId: string, text: string, coveredUntil: string, tokenEst: number): void {
    const db = getDb()
    db.prepare(`
      INSERT OR REPLACE INTO session_summaries
        (session_id, summary_text, covered_until, token_estimate, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, text, coveredUntil, tokenEst, new Date().toISOString())
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
        output?: string
        input?: unknown
        isError?: boolean
        toolName?: string
      }>
      const texts: string[] = []
      for (const b of blocks) {
        if (b.type === 'text' && b.text) texts.push(b.text)
        else if (b.type === 'tool_result' && b.output) {
          // 带 isError 标记的错误必须原样保留，这是下游 fallback/检测的事实依据
          const errTag = b.isError ? ' ERROR' : ''
          const toolTag = b.toolName ? ` tool=${b.toolName}` : ''
          texts.push(`[tool_result${errTag}${toolTag}: ${b.output}]`)
        }
        else if (b.type === 'tool_use' && b.input) texts.push(`[tool_use: ${JSON.stringify(b.input)}]`)
      }
      textContent = texts.join('\n')
    } catch {
      textContent = msg.content
    }
    const byteLen = Buffer.byteLength(textContent, 'utf8')
    const raw = byteLen > MAX_CONTENT_BYTES
      ? textContent.slice(0, Math.floor(MAX_CONTENT_BYTES * 0.8)) + '…[truncated]'
      : textContent
    if (raw.trim()) parts.push(`${msg.role}: ${raw}`)
  }

  const userContent = parts.join('\n\n')
  const systemPrompt =
    `You are a conversation-history compressor. Follow these rules strictly:\n` +
    `1. Only state facts, user requests, tool calls, and tool outputs that **actually appeared** above. Quote the literal content.\n` +
    `2. Do NOT infer unstated intent, conclusions, or causes.\n` +
    `3. Do NOT rewrite tool failures as successes. If a tool returned an error (ERROR tag / "File not found" / "[exit: non-zero]" / etc.), preserve it verbatim as "<tool> failed: <reason>".\n` +
    `4. Do NOT fabricate file names, paths, numbers, code snippets, or API signatures.\n` +
    `5. When information is unclear, write "unspecified" rather than guessing.\n` +
    `6. Respond in English, at most ${summaryBudgetChars} characters.\n` +
    `7. Structure: User intent → Key actions executed (mark success/failure) → Current state.`

  const model = createModel(config.provider, undefined)
  const { text } = await generateText({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
    maxTokens: Math.ceil(summaryBudget),
    abortSignal: AbortSignal.timeout(60_000),
  })

  log.info(`[ShortTermMemory] summary generated, length=${text.length} chars`)
  return text
}
