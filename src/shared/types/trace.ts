// src/shared/types/trace.ts — 跨进程共享:Turn trace 记录(对齐 Langfuse 对象模型)
//
// 主进程(db/、repos/、observe/、ipc/)和渲染进程(components/trace、pages)共用。
// 字段名与 Langfuse 导出字段一致:Trace / Observation / Score;trace_blobs 存去重后的模型输入。

import type { ChatMessage } from './ipc'

export const OBSERVATION_TYPES = [
  'SPAN',
  'GENERATION',
  'EVENT',
  'AGENT',
  'TOOL',
  'CHAIN',
  'RETRIEVER',
  'EVALUATOR',
  'EMBEDDING',
  'GUARDRAIL',
] as const
export type ObservationType = (typeof OBSERVATION_TYPES)[number]

export const OBSERVATION_LEVELS = ['DEBUG', 'DEFAULT', 'WARNING', 'ERROR'] as const
export type ObservationLevel = (typeof OBSERVATION_LEVELS)[number]

export const SCORE_DATA_TYPES = ['NUMERIC', 'BOOLEAN', 'CATEGORICAL', 'TEXT'] as const
export type ScoreDataType = (typeof SCORE_DATA_TYPES)[number]

export const SCORE_SOURCES = ['API', 'ANNOTATION', 'EVAL'] as const
export type ScoreSource = (typeof SCORE_SOURCES)[number]

export function isObservationType(v: unknown): v is ObservationType {
  return typeof v === 'string' && (OBSERVATION_TYPES as readonly string[]).includes(v)
}

export function isObservationLevel(v: unknown): v is ObservationLevel {
  return typeof v === 'string' && (OBSERVATION_LEVELS as readonly string[]).includes(v)
}

export function isScoreDataType(v: unknown): v is ScoreDataType {
  return typeof v === 'string' && (SCORE_DATA_TYPES as readonly string[]).includes(v)
}

export function isScoreSource(v: unknown): v is ScoreSource {
  return typeof v === 'string' && (SCORE_SOURCES as readonly string[]).includes(v)
}

/** 一轮对话(一次 sendChat)的追踪记录;id = 该轮 messageId。 */
export interface TraceRecord {
  id: string
  timestamp: string
  name: string
  session_id: string
  user_id: string | null
  release: string | null
  version: string | null
  tags: string[]
  metadata: Record<string, unknown>
  input: string | null
  output: string | null
  environment: string
  end_time: string | null
  created_at: string
  updated_at: string
}

/** trace 内的一个工作单元;type 决定语义(GENERATION = 一次模型调用尝试)。 */
export interface ObservationRecord {
  id: string
  trace_id: string
  parent_observation_id: string | null
  type: ObservationType
  name: string
  start_time: string
  end_time: string | null
  completion_start_time: string | null
  level: ObservationLevel
  status_message: string | null
  provided_model_name: string | null
  model_parameters: Record<string, unknown> | null
  input: string | null
  output: string | null
  metadata: Record<string, unknown>
  usage_details: Record<string, number> | null
  cost_details: Record<string, number> | null
  prompt_name: string | null
  prompt_version: number | null
  version: string | null
  environment: string
}

export interface ScoreRecord {
  id: string
  trace_id: string | null
  observation_id: string | null
  session_id: string | null
  name: string
  value: number
  string_value: string | null
  data_type: ScoreDataType
  source: ScoreSource
  comment: string | null
  timestamp: string
  environment: string
}

/** GENERATION 输入消息按 sha256 去重后的内容;主键 (trace_id, hash)。 */
export interface TraceBlobRecord {
  trace_id: string
  hash: string
  bytes: number
  content: string
}

/** trace 采集配置(~/.talor/config.json 的 trace 命名空间)。 */
export interface TraceConfig {
  /** 总开关;false 时不建 trace scope,全部埋点为 no-op。 */
  enabled: boolean
  /** 保留天数,启动时清理更早的 trace;0 表示不清理。 */
  retentionDays: number
  /** 单字段(input / output / blob)字节上限,超出截断。 */
  maxPayloadBytes: number
}

export const DEFAULT_TRACE_CONFIG: Readonly<TraceConfig> = Object.freeze({
  enabled: true,
  retentionDays: 30,
  maxPayloadBytes: 1_048_576,
})

const MIN_PAYLOAD_BYTES = 1024

/** 校验并补全配置:非法或缺失字段回落默认值;总是返回新对象。 */
export function resolveTraceConfig(raw: unknown): TraceConfig {
  if (raw === null || typeof raw !== 'object') return { ...DEFAULT_TRACE_CONFIG }
  const r = raw as Record<string, unknown>
  const retentionDays = r.retentionDays
  const maxPayloadBytes = r.maxPayloadBytes
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_TRACE_CONFIG.enabled,
    retentionDays:
      typeof retentionDays === 'number' && Number.isInteger(retentionDays) && retentionDays >= 0
        ? retentionDays
        : DEFAULT_TRACE_CONFIG.retentionDays,
    maxPayloadBytes:
      typeof maxPayloadBytes === 'number' &&
      Number.isInteger(maxPayloadBytes) &&
      maxPayloadBytes >= MIN_PAYLOAD_BYTES
        ? maxPayloadBytes
        : DEFAULT_TRACE_CONFIG.maxPayloadBytes,
  }
}

/** trace 列表行:trace 本身 + observation 聚合计数 + GENERATION 用量五桶之和。 */
export interface TraceSummary {
  id: string
  timestamp: string
  end_time: string | null
  name: string
  input_preview: string | null
  output_preview: string | null
  exit_reason: string | null
  observation_count: number
  generation_count: number
  tool_count: number
  error_count: number
  usage: {
    input: number
    output: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
    output_reasoning_tokens: number
  }
}

// ── trace IPC 契约(入参出参 snake_case;结果形状与既有 IPC 一致:status success | failure)──

export type TraceErrorCode =
  | 'TRACE_READ_FAILED'
  | 'TRACE_NOT_FOUND'
  | 'TRACE_SCORE_INVALID'
  | 'TRACE_WRITE_FAILED'

export interface TraceIpcFailure {
  status: 'failure'
  error_code: TraceErrorCode
  message: string
}

export type TraceListResult = { status: 'success'; traces: TraceSummary[] } | TraceIpcFailure

export type TraceGetResult =
  | {
      status: 'success'
      trace: TraceRecord
      observations: ObservationRecord[]
      scores: ScoreRecord[]
      /** 本轮全部消息(含委托子 session 的消息) */
      messages: ChatMessage[]
    }
  | TraceIpcFailure

export type TraceBlobResult = { status: 'success'; content: string } | TraceIpcFailure

export interface ScoreCreateInput {
  trace_id: string
  observation_id?: string
  name: string
  data_type: ScoreDataType
  value?: number
  string_value?: string
  source: ScoreSource
  comment?: string
}

export type ScoreCreateResult = { status: 'success'; score: ScoreRecord } | TraceIpcFailure

export type ToolDurationsResult =
  | { status: 'success'; durations: Record<string, number> }
  | TraceIpcFailure

/** tool_call_id → 耗时(ms);丢弃空 id 与负数 / 非有限耗时,同键后者覆盖前者。 */
export function toToolDurationMap(
  rows: Array<{ tool_call_id: string; duration_ms: number }>,
): Record<string, number> {
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (
      typeof r.tool_call_id === 'string' &&
      r.tool_call_id.length > 0 &&
      Number.isFinite(r.duration_ms) &&
      r.duration_ms >= 0
    ) {
      map[r.tool_call_id] = r.duration_ms
    }
  }
  return map
}
