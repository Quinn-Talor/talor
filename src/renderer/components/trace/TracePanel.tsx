// src/renderer/components/trace/TracePanel.tsx — 渲染层: trace 检视面板(Chat 页右侧停靠)
//
// 两个视图:
//   详情 —— 头部:结束原因 / 总耗时 / GENERATION 用量;工具栏:Show debug 开关 + 👍👎 反馈
//          (user_feedback 评分);主体:observation 树
//   列表 —— 本会话每轮 trace:时间、输入预览、结束原因、模型 / 工具 / 错误数、用量、耗时,点击进入详情
// 数据经 talorAPI.trace 拉取,失败时显示错误码。

import { useEffect, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'
import { useUIStore } from '../../store/uiStore'
import { formatTokens } from '../../lib/format-tokens'
import type { TraceGetResult, TraceSummary } from '@shared/types/trace'
import { TraceTree } from './TraceTree'
import { formatTraceDuration, usageInOut, usageTotals } from './trace-tree'

export interface TracePanelProps {
  sessionId: string
  traceId: string
  onClose: () => void
}

type LoadedTrace = Extract<TraceGetResult, { status: 'success' }>

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour12: false }) : '—'
}

function TraceList({
  sessionId,
  activeId,
  onSelect,
}: {
  sessionId: string
  activeId: string
  onSelect: (traceId: string) => void
}) {
  const [traces, setTraces] = useState<TraceSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void talorAPI.trace.list(sessionId).then((r) => {
      if (!alive) return
      if (r.status === 'success') {
        setTraces(r.traces)
        setError(null)
      } else {
        setTraces(null)
        setError(r.error_code)
      }
    })
    return () => {
      alive = false
    }
  }, [sessionId])

  if (error) return <div className="px-3 py-4 text-[12px] text-err">{error}</div>
  if (!traces) return <div className="px-3 py-4 text-[12px] text-mute">Loading…</div>
  if (traces.length === 0) {
    return <div className="px-3 py-4 text-[12px] text-mute">No traces in this session yet.</div>
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto py-1">
      {traces.map((t) => {
        const { input, output } = usageInOut(t.usage)
        return (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={t.id === activeId}
              className={`w-full space-y-0.5 border-b border-line px-3 py-1.5 text-left hover:bg-surface ${t.id === activeId ? 'bg-surface' : ''}`}
            >
              <div className="flex items-center gap-2 text-[11px] tabular-nums text-mute">
                <span>{timeOf(t.timestamp)}</span>
                <span className="truncate">{t.exit_reason ?? '—'}</span>
                <span className="ml-auto shrink-0">
                  {formatTraceDuration(t.timestamp, t.end_time)}
                </span>
              </div>
              <div className="truncate text-[12px] text-text">
                {t.input_preview || '(no text input)'}
              </div>
              <div className="flex flex-wrap gap-x-3 text-[11px] tabular-nums text-mute">
                <span>llm {t.generation_count}</span>
                <span>tools {t.tool_count}</span>
                <span className={t.error_count > 0 ? 'text-err' : ''}>errors {t.error_count}</span>
                <span>
                  in {formatTokens(input)} · out {formatTokens(output)}
                </span>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function TracePanel({ sessionId, traceId, onClose }: TracePanelProps) {
  const [activeId, setActiveId] = useState(traceId)
  const [view, setView] = useState<'detail' | 'list'>('detail')
  const [data, setData] = useState<LoadedTrace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scoreError, setScoreError] = useState<string | null>(null)
  const showDebug = useUIStore((s) => s.showTraceDebug)
  const toggleShowDebug = useUIStore((s) => s.toggleShowTraceDebug)
  // 评分成功后 +1 触发重新拉取
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    void talorAPI.trace.get(activeId).then((r) => {
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
  }, [activeId, reloadKey])

  const sendFeedback = async (value: 0 | 1) => {
    const r = await talorAPI.trace.createScore({
      trace_id: activeId,
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

  const selectTrace = (id: string) => {
    setActiveId(id)
    setView('detail')
  }

  // 切换 trace 后、新数据到达前不展示上一条的内容
  const current = data && data.trace.id === activeId ? data : null
  const usage = current ? usageTotals(current.observations) : null
  const io = usage ? usageInOut(usage) : null
  const exitReason = current?.trace.metadata.exit_reason

  return (
    <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-sm font-semibold text-text">Trace</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView((v) => (v === 'list' ? 'detail' : 'list'))}
            className="rounded px-1.5 py-0.5 text-[11px] text-mute hover:bg-surface"
          >
            {view === 'list' ? '‹ Back' : 'All turns'}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded px-2 py-0.5 text-mute hover:bg-surface"
          >
            ✕
          </button>
        </span>
      </div>

      {view === 'list' && (
        <TraceList sessionId={sessionId} activeId={activeId} onSelect={selectTrace} />
      )}
      {view === 'detail' && error && <div className="px-3 py-4 text-[12px] text-err">{error}</div>}
      {view === 'detail' && !error && !current && (
        <div className="px-3 py-4 text-[12px] text-mute">Loading…</div>
      )}
      {view === 'detail' && current && usage && io && (
        <>
          <div className="space-y-1 border-b border-line px-3 py-2 text-[11px] text-mute">
            <div className="flex flex-wrap gap-x-3">
              <span>exit: {typeof exitReason === 'string' ? exitReason : '—'}</span>
              <span>
                duration: {formatTraceDuration(current.trace.timestamp, current.trace.end_time)}
              </span>
            </div>
            {/* 与列表行同口径:in 含缓存读写,out 含推理;括号内给拆分 */}
            <div className="flex flex-wrap gap-x-3 tabular-nums">
              <span>
                in {formatTokens(io.input)} (cache read{' '}
                {formatTokens(usage.cache_read_input_tokens)} · write{' '}
                {formatTokens(usage.cache_creation_input_tokens)})
              </span>
              <span>
                out {formatTokens(io.output)} (reasoning{' '}
                {formatTokens(usage.output_reasoning_tokens)})
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

          {current.scores.length > 0 && (
            <div className="border-b border-line px-3 py-1.5 text-[11px] text-mute">
              {current.scores.map((s) => (
                <span key={s.id} className="mr-3 tabular-nums">
                  {s.name} = {s.string_value ?? s.value}
                </span>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <TraceTree
              traceId={activeId}
              observations={current.observations}
              showDebug={showDebug}
            />
          </div>
        </>
      )}
    </aside>
  )
}
