// src/main/repos/trace-repo.ts —— 基础设施: Turn trace 读写 repo
//
// 写:traceRecorder 每次 flush 整批 upsert(trace + 脏 observation + 新 blob,同一事务)。
// 读:trace IPC 的列表/详情/blob/工具耗时、不变量校验。消息表归 messageRepo,本 repo 不查。
//
// 允许依赖: ../db, electron-log, uuid, @shared/types/trace
// 禁止依赖: ipc/*、业务层

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { getDb } from '../db/index'
import {
  isObservationLevel,
  isObservationType,
  isScoreDataType,
  isScoreSource,
  type ObservationRecord,
  type ScoreDataType,
  type ScoreRecord,
  type ScoreSource,
  type TraceBlobRecord,
  type TraceRecord,
  type TraceSummary,
} from '@shared/types/trace'

export interface ScoreCreateParams {
  trace_id: string
  observation_id: string | null
  name: string
  value: number
  string_value: string | null
  data_type: ScoreDataType
  source: ScoreSource
  comment: string | null
  environment: string
}

interface TraceRow {
  id: string
  timestamp: string
  name: string
  session_id: string
  user_id: string | null
  release: string | null
  version: string | null
  tags: string
  metadata: string
  input: string | null
  output: string | null
  environment: string
  end_time: string | null
  created_at: string
  updated_at: string
}

interface TraceSummaryRow extends TraceRow {
  input_preview: string | null
  output_preview: string | null
  exit_reason: string | null
  observation_count: number
  generation_count: number
  tool_count: number
  error_count: number
  usage_input: number
  usage_output: number
  usage_cache_read: number
  usage_cache_creation: number
  usage_reasoning: number
}

interface ObservationRow {
  id: string
  trace_id: string
  parent_observation_id: string | null
  type: string
  name: string
  start_time: string
  end_time: string | null
  completion_start_time: string | null
  level: string
  status_message: string | null
  provided_model_name: string | null
  model_parameters: string | null
  input: string | null
  output: string | null
  metadata: string
  usage_details: string | null
  cost_details: string | null
  prompt_name: string | null
  prompt_version: number | null
  version: string | null
  environment: string
}

interface ScoreRow {
  id: string
  trace_id: string | null
  observation_id: string | null
  session_id: string | null
  name: string
  value: number
  string_value: string | null
  data_type: string
  source: string
  comment: string | null
  timestamp: string
  environment: string
}

const MAX_LIST_LIMIT = 500
const PREVIEW_CHARS = 200

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (err) {
    log.warn('[TraceRepo] invalid JSON column:', err)
    return null
  }
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null
  const v = parseJson(raw)
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function parseNumberMap(raw: string | null): Record<string, number> | null {
  const obj = parseObject(raw)
  if (obj === null) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

function parseStringArray(raw: string): string[] {
  const v = parseJson(raw)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function rowToTrace(row: TraceRow): TraceRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    name: row.name,
    session_id: row.session_id,
    user_id: row.user_id,
    release: row.release,
    version: row.version,
    tags: parseStringArray(row.tags),
    metadata: parseObject(row.metadata) ?? {},
    input: row.input,
    output: row.output,
    environment: row.environment,
    end_time: row.end_time,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function rowToObservation(row: ObservationRow): ObservationRecord {
  return {
    id: row.id,
    trace_id: row.trace_id,
    parent_observation_id: row.parent_observation_id,
    type: isObservationType(row.type) ? row.type : 'SPAN',
    name: row.name,
    start_time: row.start_time,
    end_time: row.end_time,
    completion_start_time: row.completion_start_time,
    level: isObservationLevel(row.level) ? row.level : 'DEFAULT',
    status_message: row.status_message,
    provided_model_name: row.provided_model_name,
    model_parameters: parseObject(row.model_parameters),
    input: row.input,
    output: row.output,
    metadata: parseObject(row.metadata) ?? {},
    usage_details: parseNumberMap(row.usage_details),
    cost_details: parseNumberMap(row.cost_details),
    prompt_name: row.prompt_name,
    prompt_version: row.prompt_version,
    version: row.version,
    environment: row.environment,
  }
}

function rowToScore(row: ScoreRow): ScoreRecord {
  return {
    id: row.id,
    trace_id: row.trace_id,
    observation_id: row.observation_id,
    session_id: row.session_id,
    name: row.name,
    value: row.value,
    string_value: row.string_value,
    data_type: isScoreDataType(row.data_type) ? row.data_type : 'TEXT',
    source: isScoreSource(row.source) ? row.source : 'API',
    comment: row.comment,
    timestamp: row.timestamp,
    environment: row.environment,
  }
}

const UPSERT_TRACE = `
  INSERT INTO traces (id, timestamp, name, session_id, user_id, release, version, tags, metadata,
                      input, output, environment, end_time, created_at, updated_at)
  VALUES (@id, @timestamp, @name, @session_id, @user_id, @release, @version, @tags, @metadata,
          @input, @output, @environment, @end_time, @created_at, @updated_at)
  ON CONFLICT(id) DO UPDATE SET
    timestamp = excluded.timestamp, name = excluded.name, session_id = excluded.session_id,
    user_id = excluded.user_id, release = excluded.release, version = excluded.version,
    tags = excluded.tags, metadata = excluded.metadata, input = excluded.input,
    output = excluded.output, environment = excluded.environment, end_time = excluded.end_time,
    updated_at = excluded.updated_at
`

const UPSERT_OBSERVATION = `
  INSERT INTO observations (id, trace_id, parent_observation_id, type, name, start_time, end_time,
                            completion_start_time, level, status_message, provided_model_name,
                            model_parameters, input, output, metadata, usage_details, cost_details,
                            prompt_name, prompt_version, version, environment)
  VALUES (@id, @trace_id, @parent_observation_id, @type, @name, @start_time, @end_time,
          @completion_start_time, @level, @status_message, @provided_model_name,
          @model_parameters, @input, @output, @metadata, @usage_details, @cost_details,
          @prompt_name, @prompt_version, @version, @environment)
  ON CONFLICT(id) DO UPDATE SET
    parent_observation_id = excluded.parent_observation_id, type = excluded.type,
    name = excluded.name, end_time = excluded.end_time,
    completion_start_time = excluded.completion_start_time, level = excluded.level,
    status_message = excluded.status_message, provided_model_name = excluded.provided_model_name,
    model_parameters = excluded.model_parameters, input = excluded.input, output = excluded.output,
    metadata = excluded.metadata, usage_details = excluded.usage_details,
    cost_details = excluded.cost_details, prompt_name = excluded.prompt_name,
    prompt_version = excluded.prompt_version, version = excluded.version,
    environment = excluded.environment
`

const LIST_TRACES = `
  SELECT t.*,
         substr(t.input, 1, ${PREVIEW_CHARS}) AS input_preview,
         substr(t.output, 1, ${PREVIEW_CHARS}) AS output_preview,
         json_extract(t.metadata, '$.exit_reason') AS exit_reason,
         COUNT(o.id) AS observation_count,
         COALESCE(SUM(CASE WHEN o.type = 'GENERATION' THEN 1 ELSE 0 END), 0) AS generation_count,
         COALESCE(SUM(CASE WHEN o.type = 'TOOL' THEN 1 ELSE 0 END), 0) AS tool_count,
         COALESCE(SUM(CASE WHEN o.level = 'ERROR' THEN 1 ELSE 0 END), 0) AS error_count,
         COALESCE(SUM(COALESCE(json_extract(o.usage_details, '$.input'), 0)), 0) AS usage_input,
         COALESCE(SUM(COALESCE(json_extract(o.usage_details, '$.output'), 0)), 0) AS usage_output,
         COALESCE(SUM(COALESCE(json_extract(o.usage_details, '$.cache_read_input_tokens'), 0)), 0)
           AS usage_cache_read,
         COALESCE(SUM(COALESCE(json_extract(o.usage_details, '$.cache_creation_input_tokens'), 0)), 0)
           AS usage_cache_creation,
         COALESCE(SUM(COALESCE(json_extract(o.usage_details, '$.output_reasoning_tokens'), 0)), 0)
           AS usage_reasoning
    FROM traces t
    LEFT JOIN observations o ON o.trace_id = t.id
   WHERE t.session_id = ?
   GROUP BY t.id
   ORDER BY t.timestamp DESC
   LIMIT ?
`

export const traceRepo = {
  upsertBatch(
    trace: TraceRecord,
    observations: ObservationRecord[],
    blobs: TraceBlobRecord[],
  ): void {
    const db = getDb()
    const upsertTrace = db.prepare(UPSERT_TRACE)
    const upsertObservation = db.prepare(UPSERT_OBSERVATION)
    const insertBlob = db.prepare(
      'INSERT OR IGNORE INTO trace_blobs (trace_id, hash, bytes, content) VALUES (?, ?, ?, ?)',
    )
    const tx = db.transaction(() => {
      upsertTrace.run({
        ...trace,
        tags: JSON.stringify(trace.tags),
        metadata: JSON.stringify(trace.metadata),
      })
      for (const o of observations) {
        upsertObservation.run({
          ...o,
          model_parameters: o.model_parameters === null ? null : JSON.stringify(o.model_parameters),
          metadata: JSON.stringify(o.metadata),
          usage_details: o.usage_details === null ? null : JSON.stringify(o.usage_details),
          cost_details: o.cost_details === null ? null : JSON.stringify(o.cost_details),
        })
      }
      for (const b of blobs) {
        insertBlob.run(b.trace_id, b.hash, b.bytes, b.content)
      }
    })
    tx()
    log.info(
      `[TraceRepo] Upserted trace: ${trace.id} observations=${observations.length} blobs=${blobs.length}`,
    )
  },

  list(sessionId: string, limit: number): TraceSummary[] {
    const n = Math.min(MAX_LIST_LIMIT, Math.max(1, Math.trunc(limit) || 1))
    const rows = getDb().prepare(LIST_TRACES).all(sessionId, n) as TraceSummaryRow[]
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      end_time: r.end_time,
      name: r.name,
      input_preview: r.input_preview,
      output_preview: r.output_preview,
      exit_reason: typeof r.exit_reason === 'string' ? r.exit_reason : null,
      observation_count: r.observation_count,
      generation_count: r.generation_count,
      tool_count: r.tool_count,
      error_count: r.error_count,
      usage: {
        input: r.usage_input,
        output: r.usage_output,
        cache_read_input_tokens: r.usage_cache_read,
        cache_creation_input_tokens: r.usage_cache_creation,
        output_reasoning_tokens: r.usage_reasoning,
      },
    }))
  },

  getById(traceId: string): TraceRecord | null {
    const row = getDb().prepare('SELECT * FROM traces WHERE id = ?').get(traceId) as
      | TraceRow
      | undefined
    return row ? rowToTrace(row) : null
  },

  listObservations(traceId: string): ObservationRecord[] {
    const rows = getDb()
      .prepare('SELECT * FROM observations WHERE trace_id = ? ORDER BY start_time ASC, rowid ASC')
      .all(traceId) as ObservationRow[]
    return rows.map(rowToObservation)
  },

  listScores(traceId: string): ScoreRecord[] {
    const rows = getDb()
      .prepare('SELECT * FROM scores WHERE trace_id = ? ORDER BY timestamp ASC, rowid ASC')
      .all(traceId) as ScoreRow[]
    return rows.map(rowToScore)
  },

  createScore(params: ScoreCreateParams): ScoreRecord {
    const row: ScoreRecord = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      session_id: null,
      ...params,
    }
    getDb()
      .prepare(
        `INSERT INTO scores (id, trace_id, observation_id, session_id, name, value, string_value,
                             data_type, source, comment, timestamp, environment)
         VALUES (@id, @trace_id, @observation_id, @session_id, @name, @value, @string_value,
                 @data_type, @source, @comment, @timestamp, @environment)`,
      )
      .run(row)
    log.info(`[TraceRepo] Created score: ${row.id} name=${row.name}`)
    return row
  },

  getBlob(traceId: string, hash: string): string | null {
    const row = getDb()
      .prepare('SELECT content FROM trace_blobs WHERE trace_id = ? AND hash = ?')
      .get(traceId, hash) as { content: string } | undefined
    return row ? row.content : null
  },

  listToolDurations(sessionId: string): Array<{ tool_call_id: string; duration_ms: number }> {
    return getDb()
      .prepare(
        `SELECT json_extract(o.metadata, '$.tool_call_id') AS tool_call_id,
                CAST(ROUND((julianday(o.end_time) - julianday(o.start_time)) * 86400000) AS INTEGER)
                  AS duration_ms
           FROM observations o
           JOIN traces t ON t.id = o.trace_id
          WHERE t.session_id = ?
            AND o.type = 'TOOL'
            AND o.end_time IS NOT NULL
            AND json_extract(o.metadata, '$.tool_call_id') IS NOT NULL
          ORDER BY o.start_time ASC, o.rowid ASC`,
      )
      .all(sessionId) as Array<{ tool_call_id: string; duration_ms: number }>
  },
}
