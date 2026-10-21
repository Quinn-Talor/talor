// src/main/memory/ShortTermMemory.ts —— 业务层(memory):会话短期记忆(压缩 + 锚点)
//
// 职责:给 prompt 的 history 层产出"摘要 + 锚点 + recent 原文"。history 逼近上下文上限时
// 把旧消息增量压缩为结构化摘要(落 session_summaries),之后每轮复用。
//
// 不变量:返回的 recentMessages 必须满足 SDK 的 tool_use/tool_result 配对 ——
// 不以孤立 tool 开头;history 末尾的 assistant(tool_use) 必在其中(其 tool_result 是
// MessagePlugin 注入的当前 turn)。
//
// 允许依赖:providers/*、observe/*、repos/*、db/*、prompt/types(类型)、chat/events(类型)
// 禁止依赖:ipc/*

import { generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import log from 'electron-log'
import { getAdapter } from '../providers/model-adapter'
import { recordUsage } from '../providers/usage-recorder'
import { withGenerationName } from '../observe/trace-context'
import { messageRepo } from '../repos/session-repo'
import { getDb } from '../db/index'
import type { ProviderContextConfig } from '../prompt/types'
import {
  estimate,
  estimateMessage,
  messagesToCoreMessages,
  type MemoryContext,
  type MemoryRequestOptions,
  type SessionSummary,
} from './types'
import type { ChatMessage } from '../repos/session-repo'

/**
 * 压缩摘要的结构化 schema。
 *
 *   - user_intent       — 用户原始意图,锚定整轮目标
 *   - key_facts         — tool 输出建立的关键事实
 *   - pending_actions   — LLM 承诺但未执行的动作
 *   - resolved_issues   — 已诊断 + 已修的错误
 *   - current_blocker   — 当前阻塞(可空)
 *
 * 输出走 generateText + 手动 JSON 解析(与 loop/reflect/agents 同模式):generateObject
 * 在 openai chat 上发 response_format=json_schema,DeepSeek 等兼容端点不支持。
 * 字段带 default/catch:模型漏字段或类型错时退到保守值,不让整次压缩作废。
 */
const CompressionSchema = z.object({
  user_intent: z.string().default('unspecified').catch('unspecified'),
  key_facts: z.array(z.string()).default([]).catch([]),
  pending_actions: z.array(z.string()).default([]).catch([]),
  resolved_issues: z.array(z.string()).default([]).catch([]),
  current_blocker: z.string().nullable().default(null).catch(null),
})
type CompressionObject = z.infer<typeof CompressionSchema>

/**
 * 把结构化压缩 object 渲染回 markdown,以便插入 messages history。
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
const COMPRESSION_TIMEOUT_MS = 60_000

/** 压缩触发线:history + 固定开销超过 context_limit 的该比例即压缩。 */
const COMPRESSION_TRIGGER_RATIO = 0.9

/**
 * 单次压缩调用的输入上限(占 context_limit 的比例)。待压缩消息超过时分批折叠:
 * 每批以上一批的摘要为 prevSummary,保证压缩调用本身不会超出模型窗口。
 */
const COMPRESSION_INPUT_RATIO = 0.5

/** 单条消息进入压缩输入时的字节上限,防止个别巨型 tool 输出独占压缩预算。 */
const MAX_CONTENT_BYTES = 8192

export class ShortTermMemory {
  private compressionFailures = new Map<string, { count: number; lastAttempt: number }>()

  /**
   * Returns the message context to include in the next LLM call.
   *
   * Path A (history + fixed overhead ≤ 90% of context_limit): return history verbatim.
   * Path B (above threshold): keep the most recent `recent_ratio` of tokens verbatim;
   *   compress everything older into a summary stored in session_summaries.
   *   The summary is extended incrementally — only messages after `covered_until`
   *   are sent to the compressor.
   *
   * `opts.fixedOverheadTokens` (system / agent / tool definitions) counts toward the
   * threshold, so compression kicks in before the loop's context-overflow halt.
   * Emits 'memory.compressed' on `opts.events` when a NEW summary is generated.
   */
  async getContext(
    sessionId: string,
    config: ProviderContextConfig,
    opts: MemoryRequestOptions = {},
  ): Promise<MemoryContext> {
    const allMessages: ChatMessage[] = messageRepo.listBySession(sessionId)

    if (allMessages.length === 0) {
      return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
    }

    // Pop 最末那条——它由 MessagePlugin 独立注入到 prompt 末尾(volatile 层)。
    // Memory 只处理"真·历史",压缩判定/recent 切分/锚点抽取全部基于 history:
    //   1. 末尾消息在 MessagePlugin 注入,Memory 再带一遍会重复
    //   2. 当前 turn 的 user 消息不应触发历史压缩
    //   3. history 末尾若是 assistant(tool_use) → MessagePlugin 注入 tool(result) → 配对完整
    const history: ChatMessage[] = allMessages.slice(0, -1)

    if (history.length === 0) {
      return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
    }

    const estimates = history.map(estimateMessage)
    const totalTokens = estimates.reduce((sum, n) => sum + n, 0)
    const fixedOverhead = Math.max(0, opts.fixedOverheadTokens ?? 0)
    const threshold = Math.max(0, COMPRESSION_TRIGGER_RATIO * config.context_limit - fixedOverhead)
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
    const splitIdx = findRecentSplit(history, estimates, recentBudget)
    const recentMessages = history.slice(splitIdx)
    const recentTokens = estimates.slice(splitIdx).reduce((sum, n) => sum + n, 0)
    const oldMessages = history.slice(0, splitIdx)

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
    const pending = selectUncompressed(history, compressible, existing)

    let summaryText: string

    if (pending === null) {
      summaryText = existing!.summary_text
    } else {
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
        summaryText = await compressIncrementally({
          prevSummary: pending.prevSummary,
          messages: pending.messages,
          summaryBudget,
          maxInputTokens: COMPRESSION_INPUT_RATIO * config.context_limit,
          model: createCompressionModel(config),
          sessionId,
          abortSignal: opts.abortSignal,
        })
        this.saveSummary(sessionId, summaryText, lastCompressedId, estimate(summaryText))
        this.compressionFailures.delete(sessionId)
        opts.events?.emit({ type: 'memory.compressed', coveredUntilMessageId: lastCompressedId })
      } catch (err) {
        // 用户中止不是压缩故障:不计入失败冷却,直接上抛让本轮随中止结束。
        if (opts.abortSignal?.aborted) throw err
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

/** assistant 消息是否含 tool-call part(其 tool_result 必须紧随其后)。 */
function isToolUseAssistant(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant') return false
  try {
    const content = JSON.parse(msg.content) as unknown
    return (
      Array.isArray(content) &&
      content.some((p) => (p as { type?: unknown } | null)?.type === 'tool-call')
    )
  } catch {
    return false
  }
}

/**
 * 计算 recent 窗口起点(history 下标),保证 recent 满足 tool 配对:
 *   1. 倒序装入,直到超出 recentBudget
 *   2. history 末尾的 assistant(tool_use) 即使超预算也保留 —— 它的 tool_result 是
 *      MessagePlugin 注入的当前 turn,压缩掉会让当前 tool_result 成孤儿
 *   3. recent 不得以 tool 开头:开头的 tool 让给 old(其 assistant 在 old 尾部,
 *      锚点抽取会把这对一并保留原文)
 */
export function findRecentSplit(
  history: ChatMessage[],
  estimates: number[],
  recentBudget: number,
): number {
  let splitIdx = history.length
  let used = 0
  for (let i = history.length - 1; i >= 0; i--) {
    if (used + estimates[i] > recentBudget) break
    used += estimates[i]
    splitIdx = i
  }
  if (splitIdx === history.length && history.length > 0) {
    if (isToolUseAssistant(history[history.length - 1])) splitIdx = history.length - 1
  }
  while (splitIdx < history.length && history[splitIdx].role === 'tool') splitIdx++
  return splitIdx
}

/**
 * 从 oldMessages 尾部抽取最近 N 条 tool 消息作为锚点（含配对的 assistant(tool_use)）。
 * 剩下的是 compressible 池，参与摘要压缩。
 *
 * 为什么要连带 assistant(tool_use)：AI SDK 约束"每个 tool_result 必须有对应 tool_use"，
 * 只保留 tool 而不保留 assistant 会让 SDK rebuild 时报错。同一 assistant 后连续多条
 * tool 时向前越过这些 tool 找到 assistant;找不到 assistant 的 tool 不作锚点。
 */
export function splitAnchorsAndCompressible(
  oldMessages: ChatMessage[],
  anchorCount: number,
): { anchors: ChatMessage[]; compressible: ChatMessage[] } {
  if (anchorCount <= 0) return { anchors: [], compressible: oldMessages }

  const anchorIdx = new Set<number>()
  let toolSeen = 0
  for (let i = oldMessages.length - 1; i >= 0 && toolSeen < anchorCount; i--) {
    if (oldMessages[i].role !== 'tool' || anchorIdx.has(i)) continue
    let j = i - 1
    while (j >= 0 && oldMessages[j].role === 'tool') j--
    if (j < 0 || oldMessages[j].role !== 'assistant') continue
    for (let k = j; k <= i; k++) anchorIdx.add(k)
    toolSeen++
  }

  const anchors: ChatMessage[] = []
  const compressible: ChatMessage[] = []
  for (let i = 0; i < oldMessages.length; i++) {
    if (anchorIdx.has(i)) anchors.push(oldMessages[i])
    else compressible.push(oldMessages[i])
  }
  return { anchors, compressible }
}

/**
 * 计算本次需要送去压缩的消息。
 *
 * 返回 null:已有摘要覆盖到(或越过)compressible 末尾,直接复用。
 * 已有摘要的 covered_until 仍在 history 中:只送其后的 compressible 消息 + 旧摘要。
 * covered_until 已不在 history(消息被删改):旧摘要不再可信,从头压缩。
 */
function selectUncompressed(
  history: ChatMessage[],
  compressible: ChatMessage[],
  existing: SessionSummary | null,
): { prevSummary: string | null; messages: ChatMessage[] } | null {
  if (existing === null) return { prevSummary: null, messages: compressible }
  const coveredIdx = history.findIndex((m) => m.id === existing.covered_until)
  if (coveredIdx < 0) return { prevSummary: null, messages: compressible }
  const position = new Map(history.map((m, i) => [m.id, i]))
  const fresh = compressible.filter((m) => (position.get(m.id) ?? -1) > coveredIdx)
  if (fresh.length === 0) return null
  return { prevSummary: existing.summary_text, messages: fresh }
}

/**
 * 压缩调用使用会话当前的模型(经 ProviderContextConfig.modelId 传入);
 * 未提供时退到 provider 模型列表首项。
 */
function createCompressionModel(config: ProviderContextConfig): LanguageModel {
  const modelId = config.modelId ?? config.provider.models?.[0]?.id
  if (!modelId) {
    throw new Error(`No model available for compression on provider ${config.provider.id}`)
  }
  return getAdapter(config.provider.type).createModel(config.provider, modelId)
}

/** 把一条 DB 消息渲染为压缩输入的一段文本;无可读内容时返回空串。 */
function renderMessageForCompression(msg: ChatMessage): string {
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
    for (const b of Array.isArray(blocks) ? blocks : []) {
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
  return raw.trim() ? `${msg.role}: ${raw}` : ''
}

/**
 * 增量压缩:把待压缩消息按 maxInputTokens 分批,逐批折叠进摘要。
 * 每批输入 = 上一版摘要 + 本批消息,调用规模与会话总长度无关。
 */
async function compressIncrementally(args: {
  prevSummary: string | null
  messages: ChatMessage[]
  summaryBudget: number
  maxInputTokens: number
  model: LanguageModel
  sessionId: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const rendered = args.messages.map(renderMessageForCompression).filter((s) => s.length > 0)
  const batches: string[][] = []
  let current: string[] = []
  let currentTokens = 0
  for (const seg of rendered) {
    const t = estimate(seg)
    if (current.length > 0 && currentTokens + t > args.maxInputTokens) {
      batches.push(current)
      current = []
      currentTokens = 0
    }
    current.push(seg)
    currentTokens += t
  }
  if (current.length > 0 || batches.length === 0) batches.push(current)

  let summary = args.prevSummary
  for (const batch of batches) {
    summary = await generateSummary({ ...args, prevSummary: summary, segments: batch })
  }
  return summary ?? ''
}

const JSON_INSTRUCTION =
  '\n\nRespond ONLY with a valid JSON object with exactly these keys: ' +
  'user_intent (string), key_facts (string[]), pending_actions (string[]), ' +
  'resolved_issues (string[]), current_blocker (string or null). ' +
  'No markdown code fences. No prose before or after. Output starts with { and ends with }.'

/** 剥离 markdown JSON 代码围栏;即便被要求不加,部分模型仍会输出。 */
function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim()
}

async function generateSummary(args: {
  prevSummary: string | null
  segments: string[]
  summaryBudget: number
  model: LanguageModel
  sessionId: string
  abortSignal?: AbortSignal
}): Promise<string> {
  const summaryBudgetChars = args.summaryBudget * 3

  const parts: string[] = []
  if (args.prevSummary !== null) {
    // prevSummary 明确标为"参考，可能有误"——禁止把它继承为事实结论。
    parts.push(
      `[Existing summary — reference only, may be incomplete or wrong]\n${args.prevSummary}`,
    )
  }
  parts.push('[Conversation to compress]')
  parts.push(...args.segments)

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
    `Respond in English. Total output ≤ ~${summaryBudgetChars} characters.` +
    JSON_INSTRUCTION

  const timeout = AbortSignal.timeout(COMPRESSION_TIMEOUT_MS)
  const abortSignal = args.abortSignal ? AbortSignal.any([args.abortSignal, timeout]) : timeout
  const { text, usage, providerMetadata } = await withGenerationName('llm:compress', () =>
    generateText({
      model: args.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      maxOutputTokens: Math.ceil(args.summaryBudget),
      abortSignal,
      allowSystemInMessages: true, // v7: system 走 messages 数组
    }),
  )
  recordUsage(args.sessionId, usage, providerMetadata as Record<string, unknown> | undefined)

  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(text))
  } catch (err) {
    throw new Error(
      `compression output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const validated = CompressionSchema.safeParse(parsed)
  if (!validated.success) {
    throw new Error(`compression output failed schema: ${validated.error.message}`)
  }
  const object = validated.data

  const rendered = renderCompressionAsText(object)
  log.info(
    `[ShortTermMemory] summary generated (structured) — ` +
      `facts=${object.key_facts.length} pending=${object.pending_actions.length} ` +
      `resolved=${object.resolved_issues.length} blocker=${object.current_blocker !== null} ` +
      `chars=${rendered.length}`,
  )
  return rendered
}
