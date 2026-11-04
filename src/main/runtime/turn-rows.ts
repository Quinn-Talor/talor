// src/main/runtime/turn-rows.ts — 业务层：界面消息的读模型（引擎运行事件 → messages 行形状）
//
// 会话的事实来源是引擎会话日志（runs.db），界面消息由它折叠出来，不再写 messages 表。
// 折叠函数 createTurnFold 历史与实时共用：投影逐条喂实时事件，rowsOfRun 一次读出整轮事件，同一组事件
// 折叠出的行（id、内容、时间）完全相同。分类规则沿用原投影：带工具调用的步、被退回或转兜底的步是过程，
// 交付的文本是答复；判定为完成的纯文本步等 delivery_checked（或 run_ended）再折叠。
// 用户行取自 run_started 的本轮输入的最后一段（前面的段是前置输入，只给模型看）。退出时被打断的轮
// （aborted / interrupted）末尾加一条中断提示行。工具结果在预览模式下超过 2000 字截断。
// sessionRows 按轮分页（最近 20 轮一页），会话元数据里的提示行（notices）插在对应的轮之前。
// 结束的运行按 runId 缓存。
//
// 允许依赖: agent-engine（类型）、@shared/turn-phase、@shared/intents、repos/session-repo（类型与元数据）、electron-log
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import type { Archive, BlobRef, ContentPart, RunEvent } from 'agent-engine'
import { isIntentCall } from '@shared/intents'
import { phaseMarker, type TurnPhase } from '@shared/turn-phase'
import { sessionRepo, type ChatMessage } from '../repos/session-repo'

export const TOOL_PREVIEW_CHARS = 2000
export const SESSION_PAGE_TURNS = 20
export const ROW_CACHE_RUNS = 200
export const INTERRUPTED_NOTE = '⚠️ 这一轮回答在应用退出时中断，没有完成。'

const MISSING_RESULT =
  '<tool_output>\nERROR [TOOL_MISSING_RESULT]: 没有记录到这次调用的结果\n</tool_output>'
const UNREADABLE_RESULT = '<tool_output>\n（读不到这次调用的结果正文）\n</tool_output>'

/** 会话元数据里只给界面看的提示行：放在第 afterTurn + 1 轮之前。 */
export interface SessionNotice {
  id: string
  afterTurn: number
  role: 'user' | 'assistant'
  text: string
}

type Verdict = 'complete' | 'continue' | 'finalize' | 'awaitInput' | 'stop'

function verdictOf(v: Record<string, unknown>): Verdict {
  if ('complete' in v) return 'complete'
  if ('continue' in v) return 'continue'
  if ('finalize' in v) return 'finalize'
  if ('awaitInput' in v) return 'awaitInput'
  return 'stop'
}

interface StepState {
  responded: boolean
  folded: boolean
  text: string
  reasoning?: { text: string; providerData?: unknown }
  toolCalls: Array<{ id: string; name: string; input: unknown }>
  results: Map<string, { shown: string; isError: boolean }>
  verdict?: Verdict
}

/** `shown` 去掉 `<tool_output>` 包装，并还原被转义的结束标签。 */
export function toolOutputBody(shown: string): string {
  return shown
    .replace(/^<tool_output>\n/, '')
    .replace(/\n<\/tool_output>$/, '')
    .replaceAll('<\\/tool_output>', '</tool_output>')
}

/** 预览模式下工具结果正文超过 2000 字时只留前 2000 字。 */
export function previewShown(shown: string): string {
  const body = toolOutputBody(shown)
  if (body.length <= TOOL_PREVIEW_CHARS) return shown
  return `<tool_output>\n${body.slice(0, TOOL_PREVIEW_CHARS)}\n…[已截断，共 ${body.length} 字]\n</tool_output>`
}

export const textOf = (blob: string | Uint8Array) =>
  typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8')

const iso = (at: number) => new Date(at).toISOString()

/** 引擎输入段 → 界面用户行内容：只有一段文字时为字符串。 */
export function userContentOf(parts: readonly ContentPart[]): unknown {
  if (parts.length === 1 && parts[0]!.type === 'text') return parts[0]!.text
  return parts.flatMap((p): unknown[] => {
    if (p.type === 'text') return [{ type: 'text', text: p.text }]
    if (p.type === 'image') return [{ type: 'image', image: p.image }]
    if (p.type === 'file') return [{ type: 'file', data: p.data, mediaType: p.mediaType }]
    return []
  })
}

export interface TurnFold {
  /** 折叠一条事件，返回这条事件折叠完成的步号。 */
  apply(e: RunEvent): Promise<number[]>
  rows(): ChatMessage[]
  /** 等交付结果的纯文本步。 */
  pendingDelivery(): number | undefined
  toolNameOf(callId: string): string
  /** 工具结果全文（实时回调用，不截断）。 */
  resultOf(callId: string): { shown: string; isError: boolean } | undefined
  /** 已收到 run_started。 */
  started(): boolean
  /** 已收到 run_ended。 */
  ended(): boolean
}

export function createTurnFold(opts: {
  sessionId: string
  runId: string
  agentId: string
  getBlob(ref: BlobRef): Promise<string | Uint8Array>
  /** 全文模式：工具结果不截断（提炼读源会话用）。 */
  full?: boolean
}): TurnFold {
  const { sessionId, runId, agentId } = opts
  const steps = new Map<number, StepState>()
  const stepOfCall = new Map<string, number>()
  const out: ChatMessage[] = []
  let userRow: ChatMessage | undefined
  let pending: number | undefined
  let started = false
  let ended = false

  const row = (
    id: string,
    role: ChatMessage['role'],
    content: unknown,
    at: number,
    extra: Partial<ChatMessage> = {},
  ): ChatMessage => ({
    id,
    session_id: sessionId,
    role,
    content: JSON.stringify(content),
    agent_id: agentId,
    created_at: iso(at),
    trace_id: runId,
    ...extra,
  })

  const stepState = (step: number): StepState => {
    let state = steps.get(step)
    if (!state) {
      state = { responded: false, folded: false, text: '', toolCalls: [], results: new Map() }
      steps.set(step, state)
    }
    return state
  }

  /** 折叠一步；产生了行时返回 true。 */
  const flush = (step: number, phase: TurnPhase, at: number): boolean => {
    const state = steps.get(step)
    if (!state || state.folded) return false
    state.folded = true
    if (!state.text && state.toolCalls.length === 0) return false
    const assistant: unknown[] = []
    if (state.reasoning?.text) {
      assistant.push({
        type: 'reasoning',
        text: state.reasoning.text,
        ...(state.reasoning.providerData !== undefined
          ? { providerOptions: state.reasoning.providerData }
          : {}),
      })
    }
    const marker = phaseMarker(phase)
    if (state.text) assistant.push({ type: 'text', text: state.text, providerOptions: marker })
    for (const call of state.toolCalls) {
      assistant.push({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
        providerOptions: marker,
      })
    }
    out.push(row(`${runId}:s${step}:a`, 'assistant', assistant, at))
    if (state.toolCalls.length > 0) {
      const results = state.toolCalls.map((call) => {
        const result = state.results.get(call.id)
        const shown = result ? (opts.full ? result.shown : previewShown(result.shown)) : undefined
        return {
          type: 'tool-result',
          toolCallId: call.id,
          toolName: call.name,
          output: { type: 'text', value: shown ?? MISSING_RESULT },
          isError: result ? result.isError : true,
        }
      })
      out.push(row(`${runId}:s${step}:t`, 'tool', results, at))
    }
    return true
  }

  const lastStep = () => Math.max(0, ...steps.keys())
  /** 带普通工具调用的步（只含意图调用的不算）。 */
  const hasWorkCalls = (state: StepState) =>
    state.toolCalls.length > 0 && !state.toolCalls.every((c) => isIntentCall(c.name))

  async function userRowOf(e: Extract<RunEvent, { t: 'run_started' }>): Promise<ChatMessage> {
    let content: unknown = e.task.goal ?? ''
    try {
      const body = JSON.parse(textOf(await opts.getBlob(e.task.content))) as {
        input?: Array<{ parts?: ContentPart[] }>
      }
      const last = body.input?.at(-1)?.parts
      if (last && last.length > 0) content = userContentOf(last)
    } catch (error) {
      log.warn(`[turn-rows] 读不到运行 ${runId} 的本轮输入，改用 goal`, error)
    }
    return row(`${runId}:u`, 'user', content, e.at)
  }

  async function apply(e: RunEvent): Promise<number[]> {
    switch (e.t) {
      case 'run_started':
        started = true
        userRow = await userRowOf(e)
        return []
      case 'model_responded': {
        const state = stepState(e.step)
        state.responded = true
        state.text = e.response.text
        if (e.response.reasoning) state.reasoning = e.response.reasoning
        state.toolCalls = e.response.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          input: c.input,
        }))
        for (const call of state.toolCalls) stepOfCall.set(call.id, e.step)
        return []
      }
      case 'model_aborted': {
        const state = stepState(e.step)
        if (!state.responded) state.text = e.partialText
        return []
      }
      case 'tool_finished': {
        const step = stepOfCall.get(e.callId)
        if (step === undefined) return []
        let shown = UNREADABLE_RESULT
        try {
          shown = textOf(await opts.getBlob(e.shown))
        } catch (error) {
          // 一个结果正文读不到不影响整轮的其余部分
          log.warn(`[turn-rows] 读不到运行 ${runId} 调用 ${e.callId} 的结果正文`, error)
        }
        stepState(step).results.set(e.callId, { shown, isError: e.isError })
        return []
      }
      case 'evaluated':
        stepState(e.step).verdict = verdictOf(e.verdict as unknown as Record<string, unknown>)
        return []
      case 'step_ended': {
        const state = stepState(e.step)
        if (hasWorkCalls(state)) return flush(e.step, 'process', e.at) ? [e.step] : []
        if (state.verdict === 'complete') {
          pending = e.step
          return []
        }
        const phase =
          state.verdict === 'continue' || state.verdict === 'finalize' ? 'process' : 'answer'
        return flush(e.step, phase, e.at) ? [e.step] : []
      }
      case 'delivery_checked': {
        if (pending === undefined) return []
        const step = pending
        pending = undefined
        const phase = e.outcome === 'returned' || e.outcome === 'fallback' ? 'process' : 'answer'
        return flush(step, phase, e.at) ? [step] : []
      }
      case 'fallback_generated': {
        const step = lastStep() + 1
        stepState(step).folded = true
        out.push(
          row(
            `${runId}:fallback`,
            'assistant',
            [{ type: 'text', text: e.text, providerOptions: phaseMarker('answer') }],
            e.at,
          ),
        )
        return [step]
      }
      case 'run_ended': {
        ended = true
        const folded: number[] = []
        if (pending !== undefined) {
          if (flush(pending, 'answer', e.at)) folded.push(pending)
          pending = undefined
        }
        for (const step of [...steps.keys()].sort((a, b) => a - b)) {
          if (flush(step, hasWorkCalls(steps.get(step)!) ? 'process' : 'answer', e.at)) {
            folded.push(step)
          }
        }
        if (e.result.status === 'aborted' && e.result.code === 'interrupted') {
          out.push(
            row(`${runId}:notice`, 'assistant', [{ type: 'text', text: INTERRUPTED_NOTE }], e.at, {
              content_type: 'notice',
            }),
          )
        }
        return folded
      }
      default:
        return []
    }
  }

  return {
    apply,
    rows: () => (userRow ? [userRow, ...out] : [...out]),
    pendingDelivery: () => pending,
    toolNameOf: (callId) => {
      const step = stepOfCall.get(callId)
      return (
        (step !== undefined && steps.get(step)?.toolCalls.find((c) => c.id === callId)?.name) || ''
      )
    },
    resultOf: (callId) => {
      const step = stepOfCall.get(callId)
      return step === undefined ? undefined : steps.get(step)?.results.get(callId)
    },
    started: () => started,
    ended: () => ended,
  }
}

/** 结束运行的行：`${runId}:${full}` → 行。 */
const cache = new Map<string, ChatMessage[]>()

export function clearRowCache(): void {
  cache.clear()
}

type ArchiveReader = Pick<Archive, 'read' | 'getBlob'>

/** 一轮（或一个子运行）的界面行；结束的运行进缓存。读不到时返回空数组。 */
export async function rowsOfRun(
  archive: ArchiveReader,
  opts: { runId: string; sessionId: string; agentId: string; full?: boolean },
): Promise<ChatMessage[]> {
  const key = `${opts.runId}:${opts.full === true}`
  const cached = cache.get(key)
  if (cached) return cached
  try {
    const fold = createTurnFold({ ...opts, getBlob: (ref) => archive.getBlob(ref) })
    for await (const e of archive.read(opts.runId)) await fold.apply(e)
    const rows = fold.rows()
    if (fold.ended()) {
      if (cache.size >= ROW_CACHE_RUNS) cache.delete(cache.keys().next().value!)
      cache.set(key, rows)
    }
    return rows
  } catch (error) {
    log.warn('[turn-rows] skip run', opts.runId, error)
    return []
  }
}

/** 会话元数据里的提示行；格式不对的丢弃。 */
export function sessionNotices(metadata: Record<string, unknown>): SessionNotice[] {
  const raw = metadata.notices
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (n): n is SessionNotice =>
      n !== null &&
      typeof n === 'object' &&
      typeof (n as SessionNotice).id === 'string' &&
      typeof (n as SessionNotice).afterTurn === 'number' &&
      ((n as SessionNotice).role === 'user' || (n as SessionNotice).role === 'assistant') &&
      typeof (n as SessionNotice).text === 'string',
  )
}

function noticeRow(sessionId: string, agentId: string, n: SessionNotice): ChatMessage {
  return {
    id: n.id,
    session_id: sessionId,
    role: n.role,
    content: JSON.stringify([{ type: 'text', text: n.text }]),
    agent_id: agentId,
    created_at: new Date(0).toISOString(),
    content_type: 'notice',
  }
}

/** 会话的全部轮（按序号升序）；受理失败、没有序号的尝试不算。 */
export async function sessionTurns(
  archive: Pick<Archive, 'query'>,
  sessionId: string,
): Promise<Array<{ runId: string; turn: number }>> {
  return (await archive.query({ session: sessionId }))
    .flatMap((r) => (r.turn !== undefined ? [{ runId: r.runId, turn: r.turn }] : []))
    .sort((a, b) => a.turn - b.turn)
}

/** 按轮分页的界面行：before 之前（缺省为最新）的 turns 轮，提示行插在对应的轮之前。 */
export async function sessionRows(
  archive: ArchiveReader & Pick<Archive, 'query'>,
  sessionId: string,
  opts: { before?: string; turns?: number; full?: boolean } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const turns = await sessionTurns(archive, sessionId)
  let end = turns.length
  if (opts.before !== undefined) {
    end = turns.findIndex((t) => t.runId === opts.before)
    if (end < 0) return { messages: [], hasMore: false }
  }
  const start = Math.max(0, end - (opts.turns ?? SESSION_PAGE_TURNS))
  const page = turns.slice(start, end)
  const session = sessionRepo.getById(sessionId)
  const agentId = session?.agent_id ?? '__chat__'
  const notices = sessionNotices(sessionRepo.getMetadata(sessionId))
  const lastTurn = turns.at(-1)?.turn ?? 0
  const latestPage = end === turns.length
  const noticesBefore = (turn: number) => notices.filter((n) => n.afterTurn + 1 === turn)

  const messages: ChatMessage[] = []
  for (const t of page) {
    for (const n of noticesBefore(t.turn)) messages.push(noticeRow(sessionId, agentId, n))
    messages.push(
      ...(await rowsOfRun(archive, {
        runId: t.runId,
        sessionId,
        agentId,
        ...(opts.full ? { full: true } : {}),
      })),
    )
  }
  if (latestPage) {
    for (const n of notices.filter((x) => x.afterTurn >= lastTurn)) {
      messages.push(noticeRow(sessionId, agentId, n))
    }
  }
  return { messages, hasMore: start > 0 }
}
