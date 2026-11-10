// src/main/ipc/trace.ts —— 入口层：turn trace IPC handlers
// 解析参数 → 读引擎运行档案（runtime/run-trace）→ 格式化为 { status: 'success' | 'failure' } 结果；
// 异常一律转结构化错误码，不向前端抛。档案文件不存在时不打开（不建 runs.db、不启动引擎）。
// 允许依赖：runtime/run-trace、shared/*    禁止依赖：repos/*、db/*

import { ipcMain } from 'electron'
import log from 'electron-log'
import {
  engineTraceArchive,
  runToolDurations,
  runTraceDetail,
  runTraceSummaries,
} from '../runtime/run-trace'
import type { Archive } from 'agent-engine'
import type {
  ToolDurationsResult,
  TraceBlobResult,
  TraceErrorCode,
  TraceGetResult,
  TraceIpcFailure,
  TraceListResult,
} from '@shared/types/trace'

const DEFAULT_LIST_LIMIT = 50

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
        const archive = archiveFor('list')
        if (!archive) return { status: 'success', traces: [] }
        const traces = await runTraceSummaries(
          archive,
          params.session_id,
          params.limit ?? DEFAULT_LIST_LIMIT,
        )
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
        const archive = archiveFor('get')
        if (!archive) return failure('TRACE_NOT_FOUND', params.trace_id)
        const detail = await runTraceDetail(archive, params.trace_id)
        return detail ?? failure('TRACE_NOT_FOUND', params.trace_id)
      } catch (err) {
        log.warn('[trace:get] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  ipcMain.handle(
    'trace:blob:get',
    async (_event, params: { trace_id: string; hash: string }): Promise<TraceBlobResult> => {
      const archive = archiveFor('blob:get')
      if (archive) {
        try {
          const blob = await archive.getBlob(params.hash)
          return {
            status: 'success',
            content: typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8'),
          }
        } catch {
          /* 档案里没有 */
        }
      }
      return failure('TRACE_NOT_FOUND', `${params.trace_id}/${params.hash}`)
    },
  )

  ipcMain.handle(
    'trace:tool-durations',
    async (_event, params: { session_id: string }): Promise<ToolDurationsResult> => {
      try {
        const archive = archiveFor('tool-durations')
        if (!archive) return { status: 'success', durations: {} }
        return { status: 'success', durations: await runToolDurations(archive, params.session_id) }
      } catch (err) {
        log.warn('[trace:tool-durations] failed:', err)
        return failure('TRACE_READ_FAILED', err)
      }
    },
  )

  log.info('[TraceHandlers] Registered')
}
