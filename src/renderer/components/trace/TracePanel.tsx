// src/renderer/components/trace/TracePanel.tsx — 渲染层: 一轮 trace 的检视面板(Chat 页右侧停靠)
//
// 头部:结束原因 / 总耗时 / GENERATION 用量;工具栏:Show debug 开关 + 👍👎 反馈(user_feedback 评分);
// 主体:observation 树。数据经 talorAPI.trace 拉取,失败时显示错误码。

import { useEffect, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'
import { useUIStore } from '../../store/uiStore'
import { formatTokens } from '../../lib/format-tokens'
import type { TraceGetResult } from '@shared/types/trace'
import { TraceTree } from './TraceTree'
import { usageTotals } from './trace-tree'

export interface TracePanelProps {
  traceId: string
  onClose: () => void
}

type LoadedTrace = Extract<TraceGetResult, { status: 'success' }>

function totalDuration(timestamp: string, endTime: string | null): string {
  if (endTime === null) return 'running'
  const ms = Date.parse(endTime) - Date.parse(timestamp)
  return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—'
}

export function TracePanel({ traceId, onClose }: TracePanelProps) {
  const [data, setData] = useState<LoadedTrace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const showDebug = useUIStore((s) => s.showTraceDebug)
  const toggleShowDebug = useUIStore((s) => s.toggleShowTraceDebug)
  // 评分成功后 +1 触发重新拉取
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    void talorAPI.trace.get(traceId).then((r) => {
      if (!alive) return
      if (r.status === 'success') {
        setData(r)
        setError(null)
      } else {
        setData(null)
        setError(r.error_code)
      }
    })
    return () => {
      alive = false
    }
  }, [traceId, reloadKey])

  const sendFeedback = async (value: 0 | 1) => {
    const r = await talorAPI.trace.createScore({
      trace_id: traceId,
      name: 'user_feedback',
      data_type: 'BOOLEAN',
      value,
      source: 'ANNOTATION',
    })
    if (r.status === 'success') {
      setScoreError(null)
      setReloadKey((k) => k + 1)
    } else {
      setScoreError(r.error_code)
    }
  }

  const usage = data ? usageTotals(data.observations) : null
  const exitReason = data?.trace.metadata.exit_reason

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm font-semibold text-text">Trace</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="rounded px-2 py-0.5 text-mute hover:bg-surface"
        >
          ✕
        </button>
      </div>

      {error && <div className="px-3 py-4 text-[12px] text-err">{error}</div>}
      {!error && !data && <div className="px-3 py-4 text-[12px] text-mute">Loading…</div>}
      {data && usage && (
        <>
          <div className="space-y-1 border-b border-line px-3 py-2 text-[11px] text-mute">
            <div className="flex flex-wrap gap-x-3">
              <span>exit: {typeof exitReason === 'string' ? exitReason : '—'}</span>
              <span>duration: {totalDuration(data.trace.timestamp, data.trace.end_time)}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 tabular-nums">
              <span>in {formatTokens(usage.input)}</span>
              <span>out {formatTokens(usage.output)}</span>
              <span>reasoning {formatTokens(usage.output_reasoning_tokens)}</span>
              <span>
                cache {formatTokens(usage.cache_read_input_tokens)} /{' '}
                {formatTokens(usage.cache_creation_input_tokens)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px]">
            <label className="flex items-center gap-1 text-mute">
              <input type="checkbox" checked={showDebug} onChange={toggleShowDebug} />
              Show debug
            </label>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => void sendFeedback(1)}
                className="rounded px-1.5 py-0.5 hover:bg-surface"
                aria-label="有帮助"
              >
                👍
              </button>
              <button
                type="button"
                onClick={() => void sendFeedback(0)}
                className="rounded px-1.5 py-0.5 hover:bg-surface"
                aria-label="没帮助"
              >
                👎
              </button>
            </span>
            {scoreError && <span className="text-err">{scoreError}</span>}
          </div>

          {data.scores.length > 0 && (
            <div className="border-b border-line px-3 py-1.5 text-[11px] text-mute">
              {data.scores.map((s) => (
                <span key={s.id} className="mr-3 tabular-nums">
                  {s.name} = {s.string_value ?? s.value}
                </span>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <TraceTree traceId={traceId} observations={data.observations} showDebug={showDebug} />
          </div>
        </>
      )}
    </aside>
  )
}
