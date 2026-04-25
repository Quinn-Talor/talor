import { generateText } from 'ai'
import { createModel } from '../providers/llm-provider'
import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import log from 'electron-log'
import type { ProviderContextConfig } from '../prompt/types'
import {
  estimate,
  estimateMessage,
  messagesToCoreMessages,
  type MemoryContext,
  type SessionSummary,
} from './types'
import type { ChatMessage } from '../repos/session-repo'

export class ShortTermMemory {
  async getContext(sessionId: string, config: ProviderContextConfig): Promise<MemoryContext> {
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

    const lastOldMessageId = oldMessages[oldMessages.length - 1].id
    const summaryBudget = config.summary_ratio * config.context_limit
    const existing = this.loadSummary(sessionId)

    let summaryText: string

    if (existing === null || existing.covered_until !== lastOldMessageId) {
      // No catch: failure propagates up and blocks the request
      summaryText = await generateSummary(
        existing?.summary_text ?? null,
        oldMessages,
        summaryBudget,
        config,
      )
      this.saveSummary(sessionId, summaryText, lastOldMessageId, estimate(summaryText))
    } else {
      summaryText = existing.summary_text
    }

    return {
      summaryMessage: { role: 'system', content: `[对话历史摘要]\n${summaryText}` },
      recentMessages: messagesToCoreMessages(recentMessages),
      tokenEstimate: estimate(summaryText) + recentTokens,
    }
  }

  private loadSummary(sessionId: string): SessionSummary | null {
    const db = getDb()
    return db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(sessionId) as SessionSummary | null
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
    parts.push(`[已有摘要]\n${prevSummary}`)
  }
  parts.push('[需压缩的对话]')
  for (const msg of oldMessages) {
    let textContent: string
    try {
      const blocks = JSON.parse(msg.content) as Array<{ type: string; text?: string; output?: string; input?: unknown }>
      const texts: string[] = []
      for (const b of blocks) {
        if (b.type === 'text' && b.text) texts.push(b.text)
        else if (b.type === 'tool_result' && b.output) texts.push(`[工具结果: ${b.output}]`)
        else if (b.type === 'tool_use' && b.input) texts.push(`[工具调用: ${JSON.stringify(b.input)}]`)
      }
      textContent = texts.join('\n')
    } catch {
      textContent = msg.content
    }
    const byteLen = Buffer.byteLength(textContent, 'utf8')
    const raw = byteLen > MAX_CONTENT_BYTES
      ? textContent.slice(0, Math.floor(MAX_CONTENT_BYTES * 0.8)) + '…[已截断]'
      : textContent
    if (raw.trim()) parts.push(`${msg.role}: ${raw}`)
  }

  const userContent = parts.join('\n\n')
  const systemPrompt =
    `请将以下对话历史压缩为简洁摘要，保留关键信息、决策和结论，` +
    `忽略闲聊和重复内容。用中文，输出不超过 ${summaryBudgetChars} 个字。`

  const model = createModel(config.provider, undefined)
  const { text } = await generateText({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userContent  },
    ],
    maxTokens: Math.ceil(summaryBudget),
    abortSignal: AbortSignal.timeout(3_600_000),
  })

  log.info(`[ShortTermMemory] 摘要生成完成，长度=${text.length}字符`)
  return text
}
