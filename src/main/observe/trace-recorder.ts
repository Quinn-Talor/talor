// src/main/observe/trace-recorder.ts —— 业务层: Turn trace 采集器
//
// 内存中按 trace 缓冲 observation,只在三处整批写库:step 结束、trace 结束、before-quit。
// 写入前脱敏(当前 provider key 原值 + sk-/Bearer 模式)并按 maxPayloadBytes 截断;
// GENERATION 的输入消息按 sha256 在 trace 内去重成 blob。
// 全部公开方法 fail-open:观测失败只记 warn,不改变业务结果(BR-002)。
// endTrace 时仍未结束的 observation(如中止时还在执行的工具)统一以 WARNING 收尾。
//
// observation 命名:固定名用 `<子系统>.<动作>`(react.step / react.persist / prompt.build /
// hint.injected),动态名用 `<类别>:<实例>`(agent:<id> / guard:<name> / llm:<用途>)。
//
// 允许依赖: ./trace-context, ./value-utils, ../repos/trace-repo, @shared/types/trace, uuid, node:crypto, electron-log
// 禁止依赖: ipc/*、electron

import { createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { traceRepo } from '../repos/trace-repo'
import { currentParent, withParent, type ObservationRef, type TraceScope } from './trace-context'
import { errorMessage, isRecord } from './value-utils'
import type {
  ObservationLevel,
  ObservationRecord,
  ObservationType,
  TraceBlobRecord,
  TraceConfig,
  TraceRecord,
} from '@shared/types/trace'

export interface StartTraceInput {
  id: string
  sessionId: string
  name: string
  input: string
  rootName: string
  config: TraceConfig
}

export interface EndTraceInput {
  output?: string | null
  level?: ObservationLevel
  statusMessage?: string
  metadata?: Record<string, unknown>
}

export interface StartObservationInput {
  type: ObservationType
  name: string
  /** 显式父节点;缺省时取当前 trace scope 的 parent。 */
  parent?: ObservationRef
  input?: unknown
  metadata?: Record<string, unknown>
  model?: string
  modelParameters?: Record<string, unknown>
  /** 模型输入消息;按内容去重存 blob,observation.input 只存 { role, hash, bytes } 列表。 */
  promptMessages?: unknown[]
}

export interface EndObservationInput {
  output?: unknown
  level?: ObservationLevel
  statusMessage?: string
  metadata?: Record<string, unknown>
  usageDetails?: Record<string, number>
  completionStartTime?: string
}

export interface ObservationHandle {
  readonly ref: ObservationRef | null
  update(patch: { name?: string; metadata?: Record<string, unknown> }): void
  end(result?: EndObservationInput): void
}

export const NOOP_OBSERVATION: ObservationHandle = Object.freeze({
  ref: null,
  update: () => {},
  end: () => {},
})

type Environment = 'development' | 'production'

interface TraceBuffer {
  trace: TraceRecord
  rootId: string
  observations: Map<string, ObservationRecord>
  ended: Set<string>
  dirty: Set<string>
  blobs: Map<string, TraceBlobRecord>
  writtenBlobs: Set<string>
  secrets: string[]
  config: TraceConfig
  flushFailures: number
  warned: Set<string>
}

const UNFINISHED_AT_TRACE_END = 'UNFINISHED_AT_TRACE_END'
const SK_PATTERN = /sk-[A-Za-z0-9_-]{20,}/g
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g
const MIN_SECRET_LENGTH = 8
const HASH_CHARS = 16
const MAX_LATE_WARNED = 1000

const buffers = new Map<string, TraceBuffer>()
/** 已为"trace 结束后才到达的 observation"告过警的 traceId(缓冲已删,单独记)。 */
const lateWarned = new Set<string>()
let env: { environment: Environment; release: string } = {
  environment: 'development',
  release: '0.0.0',
}

function nowIso(): string {
  return new Date().toISOString()
}

function warnOnce(buf: TraceBuffer | undefined, key: string, ...args: unknown[]): void {
  if (buf) {
    if (buf.warned.has(key)) return
    buf.warned.add(key)
  }
  log.warn(`[TraceRecorder] ${key} failed:`, ...args)
}

/** 包住一次公开调用;异常只记 warn(每 trace 每方法一次)并返回 fallback。 */
function guarded<T>(buf: TraceBuffer | undefined, key: string, fallback: T, fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    warnOnce(buf, key, err)
    return fallback
  }
}

function redact(s: string, secrets: string[]): string {
  let out = s
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join('[REDACTED]')
  }
  return out.replace(SK_PATTERN, '[REDACTED]').replace(BEARER_PATTERN, 'Bearer [REDACTED]')
}

/** 按 UTF-8 字节截断,不切断多字节字符。 */
function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = Buffer.from(s, 'utf8')
  if (bytes.length <= maxBytes) return s
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}

function toJson(buf: TraceBuffer, value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch (err) {
    warnOnce(buf, 'serialize', err)
    return String(value)
  }
}

/** 字符串原样保留,其余值转 JSON。 */
function stringify(buf: TraceBuffer, value: unknown): string {
  return typeof value === 'string' ? value : toJson(buf, value)
}

/** 序列化 + 脱敏 + 截断;截断时把字段名与原字节数记入 meta。undefined → null。 */
function serialize(
  buf: TraceBuffer,
  value: unknown,
  field: string,
  meta: Record<string, unknown>,
): string | null {
  if (value === undefined) return null
  const s = redact(stringify(buf, value), buf.secrets)
  const bytes = Buffer.byteLength(s, 'utf8')
  if (bytes <= buf.config.maxPayloadBytes) return s
  const fields = Array.isArray(meta.truncated_fields) ? meta.truncated_fields : []
  meta.truncated_fields = [...fields, field]
  const original = isRecord(meta.original_bytes) ? meta.original_bytes : {}
  meta.original_bytes = { ...original, [field]: bytes }
  return truncateUtf8(s, buf.config.maxPayloadBytes)
}

/** 模型输入消息 → blob(按内容 sha256 去重);返回 observation.input 的索引 JSON。 */
function serializePrompt(buf: TraceBuffer, messages: unknown[]): string {
  const index = messages.map((m) => {
    const role = isRecord(m) && typeof m.role === 'string' ? m.role : 'unknown'
    const content = toJson(buf, isRecord(m) && 'content' in m ? m.content : m)
    const hash = createHash('sha256').update(content).digest('hex').slice(0, HASH_CHARS)
    const bytes = Buffer.byteLength(content, 'utf8')
    if (!buf.blobs.has(hash)) {
      buf.blobs.set(hash, {
        trace_id: buf.trace.id,
        hash,
        bytes,
        content: truncateUtf8(redact(content, buf.secrets), buf.config.maxPayloadBytes),
      })
    }
    return { role, hash, bytes }
  })
  return JSON.stringify({ messages: index })
}

function createObservation(
  buf: TraceBuffer,
  input: StartObservationInput,
  parentId: string | null,
): ObservationRecord {
  const metadata: Record<string, unknown> = { ...(input.metadata ?? {}) }
  const record: ObservationRecord = {
    id: uuidv4(),
    trace_id: buf.trace.id,
    parent_observation_id: parentId,
    type: input.type,
    name: input.name,
    start_time: nowIso(),
    end_time: null,
    completion_start_time: null,
    level: 'DEFAULT',
    status_message: null,
    provided_model_name: input.model ?? null,
    model_parameters: input.modelParameters ?? null,
    input:
      input.promptMessages !== undefined
        ? serializePrompt(buf, input.promptMessages)
        : serialize(buf, input.input, 'input', metadata),
    output: null,
    metadata,
    usage_details: null,
    cost_details: null,
    prompt_name: null,
    prompt_version: null,
    version: null,
    environment: buf.trace.environment,
  }
  buf.observations.set(record.id, record)
  buf.dirty.add(record.id)
  return record
}

function endObservation(buf: TraceBuffer, id: string, result: EndObservationInput = {}): void {
  const o = buf.observations.get(id)
  if (!o || buf.ended.has(id)) return
  buf.ended.add(id)
  const metadata: Record<string, unknown> = { ...o.metadata, ...(result.metadata ?? {}) }
  o.end_time = nowIso()
  o.level = result.level ?? o.level
  o.status_message = result.statusMessage ?? null
  if (result.output !== undefined) o.output = serialize(buf, result.output, 'output', metadata)
  o.metadata = metadata
  if (result.usageDetails !== undefined) o.usage_details = result.usageDetails
  if (result.completionStartTime !== undefined) o.completion_start_time = result.completionStartTime
  buf.dirty.add(id)
}

function makeHandle(buf: TraceBuffer, id: string): ObservationHandle {
  return {
    ref: { traceId: buf.trace.id, observationId: id },
    update(patch) {
      guarded(buf, 'update', undefined, () => {
        const o = buf.observations.get(id)
        if (!o || buf.ended.has(id)) return
        if (patch.name !== undefined) o.name = patch.name
        if (patch.metadata !== undefined) o.metadata = { ...o.metadata, ...patch.metadata }
        buf.dirty.add(id)
      })
    },
    end(result) {
      guarded(buf, 'end', undefined, () => endObservation(buf, id, result))
    },
  }
}

function lookupBuffer(traceId: string): TraceBuffer | undefined {
  const buf = buffers.get(traceId)
  if (!buf && !lateWarned.has(traceId)) {
    if (lateWarned.size >= MAX_LATE_WARNED) lateWarned.clear()
    lateWarned.add(traceId)
    log.warn('[TraceRecorder] observation after trace end dropped:', traceId)
  }
  return buf
}

function flushBuffer(buf: TraceBuffer): void {
  const dirtyObs: ObservationRecord[] = []
  for (const id of buf.dirty) {
    const o = buf.observations.get(id)
    if (o) dirtyObs.push({ ...o })
  }
  const newBlobs: TraceBlobRecord[] = []
  for (const [hash, b] of buf.blobs) {
    if (!buf.writtenBlobs.has(hash)) newBlobs.push(b)
  }
  try {
    traceRepo.upsertBatch({ ...buf.trace }, dirtyObs, newBlobs)
    buf.dirty.clear()
    for (const b of newBlobs) buf.writtenBlobs.add(b.hash)
  } catch (err) {
    buf.flushFailures++
    if (buf.flushFailures === 1) log.warn('[TraceRecorder] flush failed:', buf.trace.id, err)
  }
}

export const traceRecorder = {
  configureEnvironment(next: { environment: Environment; release: string }): void {
    env = { ...next }
  },

  getEnvironment(): Environment {
    return env.environment
  },

  startTrace(input: StartTraceInput): TraceScope | null {
    return guarded(undefined, 'startTrace', null, () => {
      if (!input.config.enabled) return null
      const now = nowIso()
      const buf: TraceBuffer = {
        trace: {
          id: input.id,
          timestamp: now,
          name: input.name,
          session_id: input.sessionId,
          user_id: null,
          release: env.release,
          version: null,
          tags: [],
          metadata: {},
          input: null,
          output: null,
          environment: env.environment,
          end_time: null,
          created_at: now,
          updated_at: now,
        },
        rootId: '',
        observations: new Map(),
        ended: new Set(),
        dirty: new Set(),
        blobs: new Map(),
        writtenBlobs: new Set(),
        secrets: [],
        config: { ...input.config },
        flushFailures: 0,
        warned: new Set(),
      }
      buf.trace.input = serialize(buf, input.input, 'input', buf.trace.metadata)
      const root = createObservation(
        buf,
        { type: 'AGENT', name: input.rootName, input: input.input },
        null,
      )
      buf.rootId = root.id
      buffers.set(input.id, buf)
      return { traceId: input.id, parent: { traceId: input.id, observationId: root.id } }
    })
  },

  updateRoot(traceId: string, patch: { name?: string; metadata?: Record<string, unknown> }): void {
    const buf = buffers.get(traceId)
    if (!buf) return
    guarded(buf, 'updateRoot', undefined, () => {
      if (patch.metadata !== undefined) {
        buf.trace.metadata = { ...buf.trace.metadata, ...patch.metadata }
      }
      makeHandle(buf, buf.rootId).update(patch)
    })
  },

  addSecret(traceId: string, secret: string): void {
    const buf = buffers.get(traceId)
    if (buf && secret.length > 0) buf.secrets.push(secret)
  },

  endTrace(traceId: string, result: EndTraceInput): void {
    const buf = buffers.get(traceId)
    if (!buf) return
    guarded(buf, 'endTrace', undefined, () => {
      const now = nowIso()
      buf.trace.end_time = now
      buf.trace.updated_at = now
      const metadata = { ...buf.trace.metadata, ...(result.metadata ?? {}) }
      buf.trace.output =
        result.output === undefined || result.output === null
          ? null
          : serialize(buf, result.output, 'output', metadata)
      buf.trace.metadata = metadata
      // trace 结束后 handle 写的是已脱离的缓冲;此刻仍未结束的子节点在这里收尾,否则永远停在"未结束"
      for (const id of buf.observations.keys()) {
        if (id !== buf.rootId && !buf.ended.has(id)) {
          endObservation(buf, id, { level: 'WARNING', statusMessage: UNFINISHED_AT_TRACE_END })
        }
      }
      endObservation(buf, buf.rootId, {
        level: result.level ?? 'DEFAULT',
        statusMessage: result.statusMessage,
        output: result.output ?? undefined,
      })
      flushBuffer(buf)
      if (buf.flushFailures > 1) {
        log.warn(`[TraceRecorder] trace ${traceId}: ${buf.flushFailures} flush failures`)
      }
    })
    buffers.delete(traceId)
  },

  startObservation(input: StartObservationInput): ObservationHandle {
    return guarded(undefined, 'startObservation', NOOP_OBSERVATION, () => {
      const parentRef = input.parent ?? currentParent()
      if (parentRef === null) return NOOP_OBSERVATION
      const buf = lookupBuffer(parentRef.traceId)
      if (!buf) return NOOP_OBSERVATION
      const record = createObservation(buf, input, parentRef.observationId)
      return makeHandle(buf, record.id)
    })
  },

  async withObservation<T>(
    input: StartObservationInput,
    fn: (h: ObservationHandle) => Promise<T>,
  ): Promise<T> {
    const h = traceRecorder.startObservation(input)
    try {
      const result = await withParent(h.ref, () => fn(h))
      h.end()
      return result
    } catch (e) {
      h.end({ level: 'ERROR', statusMessage: errorMessage(e) })
      throw e
    }
  },

  event(input: {
    name: string
    input?: unknown
    level?: ObservationLevel
    metadata?: Record<string, unknown>
  }): void {
    guarded(undefined, 'event', undefined, () => {
      const parentRef = currentParent()
      if (parentRef === null) return
      const buf = lookupBuffer(parentRef.traceId)
      if (!buf) return
      const record = createObservation(
        buf,
        { type: 'EVENT', name: input.name, input: input.input, metadata: input.metadata },
        parentRef.observationId,
      )
      record.level = input.level ?? 'DEFAULT'
      record.end_time = record.start_time
      buf.ended.add(record.id)
    })
  },

  flush(traceId: string): void {
    const buf = buffers.get(traceId)
    if (!buf) return
    guarded(buf, 'flush', undefined, () => flushBuffer(buf))
  },

  flushAll(): void {
    for (const buf of buffers.values()) {
      guarded(buf, 'flush', undefined, () => flushBuffer(buf))
    }
  },
}
