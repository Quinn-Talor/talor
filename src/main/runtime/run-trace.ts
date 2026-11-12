// src/main/runtime/run-trace.ts — 业务层：引擎运行档案 → Trace 面板的 trace 与 observation 形状
//
// 列表读运行摘要（只列顶层运行，子运行的 subject 与父会话相同）；详情读一次运行的全部事件，经引擎的
// buildTrace 得到层级，再映射成面板现有的 observation：run → AGENT、step → SPAN、model → GENERATION、
// tool → TOOL、external → CHAIN、opinion → GUARDRAIL（DEBUG，面板默认隐藏）、check（交付验收）→ EVALUATOR
// （没通过记 WARNING：没通过的验收不是出错）。会话的一轮在 AGENT 的 metadata 里带 session 与 turn（来自引擎）。
// GENERATION 的 input 写成面板的提示词索引（hash 为引擎的 blob 引用）。observation id 为 `${runId}:${n}`（前序遍历序号）。
// 列表的输入 / 输出预览与详情的 messages 取自读模型（turn-rows），不读 messages 表。
// 读 Trace 时运行档案文件不存在就不打开（不建 runs.db、不启动引擎）。
//
// 允许依赖: agent-engine、fs、runtime/run-archive、runtime/turn-rows（界面行与 toolOutputBody）、repos/session-repo（类型）、
//          @shared/types/trace
// 禁止依赖: ipc/*、db/*、runtime/engine（getRuntime 会启动引擎）

import { existsSync } from 'fs'
import {
  buildTrace,
  type Archive,
  type BlobRef,
  type ModelResponse,
  type RunEvent,
  type TraceNode,
} from 'agent-engine'
import type {
  ObservationRecord,
  ObservationType,
  TraceGetResult,
  TraceSummary,
} from '@shared/types/trace'
import type { ChatMessage } from '../repos/session-repo'
import { rowsOfRun, toolOutputBody } from './turn-rows'
import { runArchive, runsDbPath } from './run-archive'

const PREVIEW_CHARS = 200
const MAX_TOOL_OUTPUT_CHARS = 65536
const TRUNCATED = '…（已截断）'
const TOOL_DURATION_RUNS = 50

const TYPE_OF: Record<TraceNode['kind'], ObservationType> = {
  run: 'AGENT',
  step: 'SPAN',
  model: 'GENERATION',
  tool: 'TOOL',
  external: 'CHAIN',
  opinion: 'GUARDRAIL',
  check: 'EVALUATOR',
}

const iso = (ms: number) => new Date(ms).toISOString()

/** 有引擎运行档案时返回单例，否则 undefined（不建文件）。 */
export function engineTraceArchive(): Archive | undefined {
  return existsSync(runsDbPath()) ? runArchive() : undefined
}

const textOfBlob = (blob: string | Uint8Array) =>
  typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8')

/** 消息行的文本：字符串内容原样，片段数组拼接 text 片段。 */
function rowText(row: ChatMessage): string {
  let content: unknown
  try {
    content = JSON.parse(row.content)
  } catch {
    return row.content
  }
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((p) => p && (p as { type?: unknown }).type === 'text')
    .map((p) => String((p as { text?: unknown }).text ?? ''))
    .join('')
}

function preview(rows: ChatMessage[]): string | null {
  const text = rows.map(rowText).find((t) => t.trim().length > 0)
  return text === undefined ? null : text.slice(0, PREVIEW_CHARS)
}

const exitReasonOf = (status?: string, code?: string) =>
  status ? (code ? `${status}:${code}` : status) : null

export async function runTraceSummaries(
  archive: Archive,
  sessionId: string,
  limit: number,
): Promise<TraceSummary[]> {
  const runs = (await archive.query({ subject: sessionId, limit }))
    .filter((r) => r.parentRunId === undefined)
    .sort((a, b) => b.startedAt - a.startedAt)
  const summaries: TraceSummary[] = []
  for (const r of runs) {
    const msgs = await rowsOfRun(archive, { runId: r.runId, sessionId, agentId: r.agentId })
    summaries.push({
      id: r.runId,
      timestamp: iso(r.startedAt),
      end_time: r.endedAt !== undefined ? iso(r.endedAt) : null,
      name: 'engine-run',
      input_preview: preview(msgs.filter((m) => m.role === 'user')),
      output_preview: preview(msgs.filter((m) => m.role === 'assistant').reverse()),
      exit_reason: exitReasonOf(r.status, r.code),
      observation_count: 1 + r.steps + r.toolCalls,
      generation_count: r.steps,
      tool_count: r.toolCalls,
      error_count: r.status === 'failed' ? 1 : 0,
      usage: {
        input: r.usage.input,
        output: r.usage.output,
        cache_read_input_tokens: r.usage.cacheRead,
        cache_creation_input_tokens: r.usage.cacheWrite,
        output_reasoning_tokens: 0,
      },
    })
  }
  return summaries
}

async function readAll(archive: Archive, runId: string): Promise<RunEvent[]> {
  const events: RunEvent[] = []
  for await (const e of archive.read(runId)) events.push(e)
  return events
}

type EventOf<T extends RunEvent['t']> = Extract<RunEvent, { t: T }>

/** blob 引用 → 提示词索引项；读不到时 role 'unknown'、bytes 0。 */
async function promptRef(archive: Archive, ref: BlobRef) {
  try {
    const text = textOfBlob(await archive.getBlob(ref))
    let role = 'unknown'
    try {
      const parsed = JSON.parse(text) as { role?: unknown } | null
      if (parsed && typeof parsed.role === 'string') role = parsed.role
    } catch {
      /* 不是 JSON：role 记 unknown */
    }
    return { role, hash: ref, bytes: Buffer.byteLength(text, 'utf8') }
  } catch {
    return { role: 'unknown', hash: ref, bytes: 0 }
  }
}

async function toolOutput(archive: Archive, ref: BlobRef | undefined): Promise<string | null> {
  if (ref === undefined) return null
  try {
    const body = toolOutputBody(textOfBlob(await archive.getBlob(ref)))
    return body.length > MAX_TOOL_OUTPUT_CHARS
      ? body.slice(0, MAX_TOOL_OUTPUT_CHARS) + TRUNCATED
      : body
  } catch {
    return null
  }
}

const stepNumberOf = (node: TraceNode | undefined) => {
  const m = node?.kind === 'step' ? /(\d+)/.exec(node.name) : null
  return m ? Number(m[1]) : undefined
}

export async function runTraceDetail(
  archive: Archive,
  runId: string,
): Promise<Extract<TraceGetResult, { status: 'success' }> | null> {
  const events = await readAll(archive, runId)
  if (events.length === 0) return null
  const started = events.find((e): e is EventOf<'run_started'> => e.t === 'run_started')
  const ended = events.find((e): e is EventOf<'run_ended'> => e.t === 'run_ended')
  const tree = buildTrace(events)

  const ctxOfStep = new Map<number, BlobRef[]>()
  const respOfStep = new Map<number, ModelResponse>()
  const callInput = new Map<string, unknown>()
  const shownOf = new Map<string, BlobRef>()
  for (const e of events) {
    if (e.t === 'context_built') ctxOfStep.set(e.step, e.messages)
    else if (e.t === 'model_responded') {
      respOfStep.set(e.step, e.response)
      for (const c of e.response.toolCalls) callInput.set(c.id, c.input)
    } else if (e.t === 'tool_finished') shownOf.set(e.callId, e.shown)
  }

  const environment = started?.environment.name ?? ended?.origin?.environment ?? 'interactive'
  const model = started ? String(started.model) : null
  const observations: ObservationRecord[] = []
  let n = 0

  const visit = async (
    node: TraceNode,
    parentId: string | null,
    parent: TraceNode | undefined,
  ): Promise<void> => {
    const id = `${runId}:${n++}`
    const attrs = node.attrs
    const { usage, ...metadata } = attrs as { usage?: Record<string, number> } & Record<
      string,
      unknown
    >
    let level: ObservationRecord['level'] = 'DEFAULT'
    if (node.kind === 'opinion') level = 'DEBUG'
    else if (node.kind === 'tool' && attrs.isError === true) level = 'ERROR'
    else if (node.kind === 'model' && attrs.error !== undefined) level = 'ERROR'
    else if (node.kind === 'check' && attrs.pass === false) level = 'WARNING'
    let statusMessage: string | null = null
    if (node.kind === 'tool' && typeof attrs.errorCode === 'string') statusMessage = attrs.errorCode
    if (node.kind === 'model' && typeof attrs.error === 'string') statusMessage = attrs.error

    let input: string | null = null
    let output: string | null = null
    let usageDetails: Record<string, number> | null = null
    if (node.kind === 'model') {
      const step = stepNumberOf(parent)
      const refs = step !== undefined ? (ctxOfStep.get(step) ?? []) : []
      input = JSON.stringify({
        messages: await Promise.all(refs.map((ref) => promptRef(archive, ref))),
      })
      const resp = step !== undefined ? respOfStep.get(step) : undefined
      if (resp && attrs.error === undefined) {
        output = JSON.stringify({
          text: resp.text,
          toolCalls: resp.toolCalls.map((c) => ({ name: c.name, input: c.input })),
        })
      }
      if (usage) {
        usageDetails = {
          input: usage.input ?? 0,
          output: usage.output ?? 0,
          cache_read_input_tokens: usage.cacheRead ?? 0,
          cache_creation_input_tokens: usage.cacheWrite ?? 0,
        }
      }
    } else if (node.kind === 'tool' && typeof attrs.callId === 'string') {
      input = JSON.stringify(callInput.get(attrs.callId) ?? null)
      output = await toolOutput(archive, shownOf.get(attrs.callId))
    }

    observations.push({
      id,
      trace_id: runId,
      parent_observation_id: parentId,
      type: TYPE_OF[node.kind],
      name: node.name,
      start_time: iso(node.startedAt),
      end_time: node.durationMs !== undefined ? iso(node.startedAt + node.durationMs) : null,
      completion_start_time: null,
      level,
      status_message: statusMessage,
      provided_model_name: node.kind === 'model' ? model : null,
      model_parameters: null,
      input,
      output,
      metadata,
      usage_details: usageDetails,
      cost_details: null,
      prompt_name: null,
      prompt_version: null,
      version: null,
      environment,
    })
    for (const child of node.children) await visit(child, id, node)
  }
  if (tree) await visit(tree, null, undefined)

  const timestamp = iso(events[0]!.at)
  const endTime = ended ? iso(ended.at) : null
  return {
    status: 'success',
    trace: {
      id: runId,
      timestamp,
      name: 'engine-run',
      session_id: started?.task.subject ?? ended?.origin?.subject ?? '',
      user_id: null,
      release: null,
      version: null,
      tags: ['engine'],
      metadata: {
        source: 'engine',
        exit_reason: exitReasonOf(ended?.result.status, ended?.result.code),
        agent_id: started?.agent.id ?? ended?.origin?.agentId ?? null,
      },
      input: null,
      output: null,
      environment,
      end_time: endTime,
      created_at: timestamp,
      updated_at: endTime ?? timestamp,
    },
    observations,
    scores: [],
    messages: await rowsOfRun(archive, {
      runId,
      sessionId: started?.task.subject ?? ended?.origin?.subject ?? '',
      agentId: started?.agent.id ?? ended?.origin?.agentId ?? '',
    }),
  }
}

/** 会话最近 50 次运行（含子运行）的工具耗时：callId → durationMs。 */
export async function runToolDurations(
  archive: Archive,
  sessionId: string,
): Promise<Record<string, number>> {
  const map: Record<string, number> = {}
  const runs = await archive.query({ subject: sessionId, limit: TOOL_DURATION_RUNS })
  for (const r of runs) {
    for (const e of await readAll(archive, r.runId)) {
      if (e.t === 'tool_finished') map[e.callId] = e.durationMs
    }
  }
  return map
}
