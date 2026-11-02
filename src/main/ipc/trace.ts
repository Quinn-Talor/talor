// src/main/ipc/trace.ts —— 入口层：turn trace IPC handlers
// 解析参数 → 调 repo → 格式化为 { status: 'success' | 'failure' } 结果；异常一律转结构化错误码，不向前端抛。
// 引擎路径的轮次在运行档案里（C3）：先查旧表，取不到或需要合并时读运行档案；档案文件不存在时不打开
// （不建 runs.db、不启动引擎）。引擎轮次不支持评分（scores 外键指向旧 traces 表）。
// 允许依赖：repos/*、observe/trace-recorder（只读 environment）、runtime/run-trace、shared/*    禁止依赖：loop/*

import { ipcMain } from 'electron'
import log from 'electron-log'
import { z } from 'zod'
import { traceRepo } from '../repos/trace-repo'
import { messageRepo } from '../repos/session-repo'
import { traceRecorder } from '../observe/trace-recorder'
import {
  engineTraceArchive,
  runToolDurations,
  runTraceDetail,
  runTraceSummaries,
} from '../runtime/run-trace'
import type { Archive } from 'agent-engine'
import {
  SCORE_DATA_TYPES,
  SCORE_SOURCES,
  toToolDurationMap,
  type ScoreCreateInput,
  type ScoreCreateResult,
  type ToolDurationsResult,
  type TraceBlobResult,
  type TraceErrorCode,
  type TraceGetResult,
  type TraceIpcFailure,
  type TraceListResult,
  type TraceSummary,
} from '@shared/types/trace'

const DEFAULT_LIST_LIMIT = 50

export const ScoreCreateInputSchema = z
  .object({
    trace_id: z.string().min(1),
    observation_id: z.string().min(1).optional(),
    name: z.string().min(1).max(100),
    data_type: z.enum(SCORE_DATA_TYPES),
    value: z.number().optional(),
    string_value: z.string().optional(),
    source: z.enum(SCORE_SOURCES),
    comment: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.data_type === 'NUMERIC' && (v.value === undefined || !Number.isFinite(v.value))) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'NUMERIC score needs a finite value',
      })
    }
    if (v.data_type === 'BOOLEAN' && v.value !== 0 && v.value !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'BOOLEAN score value must be 0 or 1',
      })
    }
    if (
      (v.data_type === 'CATEGORICAL' || v.data_type === 'TEXT') &&
      (v.string_value === undefined || v.string_value.length === 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['string_value'],
        message: `${v.data_type} score needs a non-empty string_value`,
      })
    }
  })

function failure(code: TraceErrorCode, err: unknown): TraceIpcFailure {
  return {
    status: 'failure',
    error_code: code,
    message: err instanceof Error ? err.message : String(err),
  }
}

/** 引擎运行档案；没有档案文件或打开失败时 undefined。 */
function archiveFor(channel: string): Archive | undefined {
  try {
    return engineTraceArchive()
  } catch (err) {
    log.warn(`[trace:${channel}] engine archive read failed:`, err)
    return undefined
  }
}

export function registerTraceHandlers(): void {
  ipcMain.handle(
    'trace:list',
    async (_event, params: { session_id: string; limit?: number }): Promise<TraceListResult> => {
      try {
        const limit = params.limit ?? DEFAULT_LIST_LIMIT
        const legacy = traceRepo.list(params.session_id, limit)
        const archive = archiveFor('list')
        let engine: TraceSummary[] = []
        if (archive) {
          try {
            engine = await runTraceSummaries(archive, params.session_id, limit)
          } catch (err) {
            log.warn('[trace:list] engine archive read failed:', err)
          }
        }
        if (engine.length === 0) return { status: 'success', traces: legacy }
        const traces = [...legacy, ...engine]
          .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
          .slice(0, limit)
        return { status: 'success', traces }
      } catch (err) {
        log.warn('[trace:list] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  ipcMain.handle(
    'trace:get',
    async (_event, params: { trace_id: string }): Promise<TraceGetResult> => {
      try {
        const trace = traceRepo.getById(params.trace_id)
        if (trace === null) {
          const archive = archiveFor('get')
          if (!archive) return failure('TRACE_NOT_FOUND', params.trace_id)
          const detail = await runTraceDetail(archive, params.trace_id)
          return detail ?? failure('TRACE_NOT_FOUND', params.trace_id)
        }
        return {
          status: 'success',
          trace,
          observations: traceRepo.listObservations(trace.id),
          scores: traceRepo.listScores(trace.id),
          messages: messageRepo.listByTrace(trace.id),
        }
      } catch (err) {
        log.warn('[trace:get] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  ipcMain.handle(
    'trace:blob:get',
    async (_event, params: { trace_id: string; hash: string }): Promise<TraceBlobResult> => {
      try {
        const content = traceRepo.getBlob(params.trace_id, params.hash)
        if (content !== null) return { status: 'success', content }
        const archive = archiveFor('blob:get')
        if (archive) {
          try {
            const blob = await archive.getBlob(params.hash)
            return {
              status: 'success',
              content: typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8'),
            }
          } catch {
            /* 档案里也没有 */
          }
        }
        return failure('TRACE_NOT_FOUND', `${params.trace_id}/${params.hash}`)
      } catch (err) {
        log.warn('[trace:blob:get] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  ipcMain.handle('trace:score:create', (_event, params: ScoreCreateInput): ScoreCreateResult => {
    const parsed = ScoreCreateInputSchema.safeParse(params)
    if (!parsed.success) return failure('TRACE_SCORE_INVALID', parsed.error.message)
    const input = parsed.data
    const stringScore = input.data_type === 'CATEGORICAL' || input.data_type === 'TEXT'
    try {
      // 引擎轮次不在旧 traces 表里，不支持评分
      if (traceRepo.getById(input.trace_id) === null) {
        return failure('TRACE_NOT_FOUND', input.trace_id)
      }
      const score = traceRepo.createScore({
        trace_id: input.trace_id,
        observation_id: input.observation_id ?? null,
        name: input.name,
        value: stringScore ? 0 : (input.value ?? 0),
        string_value: input.string_value ?? null,
        data_type: input.data_type,
        source: input.source,
        comment: input.comment ?? null,
        environment: traceRecorder.getEnvironment(),
      })
      return { status: 'success', score }
    } catch (err) {
      log.warn('[trace:score:create] failed:', err)
      return failure('TRACE_WRITE_FAILED', err)
    }
  })

  ipcMain.handle(
    'trace:tool-durations',
    async (_event, params: { session_id: string }): Promise<ToolDurationsResult> => {
      try {
        const legacy = toToolDurationMap(traceRepo.listToolDurations(params.session_id))
        const archive = archiveFor('tool-durations')
        let engine: Record<string, number> = {}
        if (archive) {
          try {
            engine = await runToolDurations(archive, params.session_id)
          } catch (err) {
            log.warn('[trace:tool-durations] engine archive read failed:', err)
          }
        }
        return { status: 'success', durations: { ...legacy, ...engine } }
      } catch (err) {
        log.warn('[trace:tool-durations] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  log.info('[TraceHandlers] Registered')
}
