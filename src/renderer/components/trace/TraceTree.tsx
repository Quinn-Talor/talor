// src/renderer/components/trace/TraceTree.tsx — 渲染层: observation 树
// (节点可折叠;点击行展开 input / output / metadata;GENERATION 输入按消息与工具定义拆出字节占比;
// 隐藏 DEBUG 时其可见后代仍保留)

import { useEffect, useMemo, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'
import type { ObservationLevel, ObservationRecord } from '@shared/types/trace'
import {
  buildObservationTree,
  displayName,
  formatBytes,
  parsePromptIndex,
  promptComposition,
  toolDefinitionSizes,
  visibleTree,
  type DisplayNode,
  type PromptIndex,
} from './trace-tree'

export interface TraceTreeProps {
  traceId: string
  observations: ObservationRecord[]
  showDebug: boolean
}

const LEVEL_CLASS: Record<ObservationLevel, string> = {
  ERROR: 'text-err',
  WARNING: 'text-warn',
  DEBUG: 'text-subtle',
  DEFAULT: 'text-body',
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function pretty(raw: string | null): string {
  if (raw === null) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    // 非 JSON 文本原样展示
    return raw
  }
}

const PRE_CLASS =
  'max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-1.5 text-[11px]'

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

/**
 * GENERATION 输入构成:每条消息(字节 / 占比 + 内容)与工具定义(点开才拉 blob,
 * 按单个工具定义字节从大到小列出 —— 工具定义常是模型输入的大头)。
 */
function PromptMessages({ traceId, index }: { traceId: string; index: PromptIndex }) {
  const parts = useMemo(() => promptComposition(index), [index])
  const [contents, setContents] = useState<Record<string, string>>({})
  const [showTools, setShowTools] = useState(false)
  const [toolSizes, setToolSizes] = useState<Array<{ name: string; bytes: number }> | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all(
      index.messages.map(async (m) => {
        const r = await talorAPI.trace.getBlob(traceId, m.hash)
        return [m.hash, r.status === 'success' ? pretty(r.content) : r.error_code] as const
      }),
    ).then((pairs) => {
      if (alive) setContents(Object.fromEntries(pairs))
    })
    return () => {
      alive = false
    }
  }, [traceId, index])

  const toggleTools = () => {
    setShowTools((v) => !v)
    if (toolSizes === null && index.tools) {
      void talorAPI.trace.getBlob(traceId, index.tools.hash).then((r) => {
        setToolSizes(r.status === 'success' ? toolDefinitionSizes(r.content) : [])
      })
    }
  }

  const total = parts.reduce((sum, p) => sum + p.bytes, 0)
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase text-mute">input · {formatBytes(total)}</div>
      {parts.map((p, i) =>
        p.kind === 'message' ? (
          <div key={`${p.hash}-${i}`}>
            <div className="text-[10px] text-mute">
              <span className="uppercase">{p.label}</span> · {formatBytes(p.bytes)} ·{' '}
              {percent(p.share)}
            </div>
            <pre className={PRE_CLASS}>{contents[p.hash] ?? '…'}</pre>
          </div>
        ) : (
          <div key={`tools-${p.hash}`}>
            <button
              type="button"
              onClick={toggleTools}
              aria-expanded={showTools}
              className="text-[10px] text-mute hover:text-text"
            >
              {showTools ? '▾' : '▸'} <span className="uppercase">{p.label}</span> ·{' '}
              {formatBytes(p.bytes)} · {percent(p.share)}
            </button>
            {showTools && (
              <div className={PRE_CLASS}>
                {toolSizes === null && '…'}
                {toolSizes?.length === 0 && '(工具定义无法解析)'}
                {toolSizes?.map((t) => (
                  <div key={t.name} className="flex justify-between gap-2 tabular-nums">
                    <span className="truncate">{t.name}</span>
                    <span className="shrink-0 text-mute">{formatBytes(t.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  )
}

function Detail({ traceId, o }: { traceId: string; o: ObservationRecord }) {
  const index = useMemo(() => (o.type === 'GENERATION' ? parsePromptIndex(o.input) : null), [o])
  const section = (label: string, body: string) =>
    body ? (
      <div>
        <div className="text-[10px] uppercase text-mute">{label}</div>
        <pre className={PRE_CLASS}>{body}</pre>
      </div>
    ) : null
  return (
    <div className="space-y-2 border-l border-line py-2 pl-3 pr-2">
      {o.status_message && <div className="text-[11px] text-err">{o.status_message}</div>}
      {o.provided_model_name && (
        <div className="text-[11px] text-mute">model: {o.provided_model_name}</div>
      )}
      {index ? (
        <PromptMessages traceId={traceId} index={index} />
      ) : (
        section('input', pretty(o.input))
      )}
      {section('output', pretty(o.output))}
      {o.usage_details && section('usage', JSON.stringify(o.usage_details, null, 2))}
      {Object.keys(o.metadata).length > 0 &&
        section('metadata', JSON.stringify(o.metadata, null, 2))}
    </div>
  )
}

// 行:[折叠箭头] 名称 · 类型 · 耗时。子列表左侧竖线对齐父行箭头中心(pl-2 + 箭头半宽 = 15px),
// 每层缩进 16px;详情区对齐名称起点(pl-2 + 箭头 14px + gap 4px = 26px)。
function Node({ node, traceId }: { node: DisplayNode; traceId: string }) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const o = node.observation
  const hasChildren = node.children.length > 0
  return (
    <li>
      <div
        className={`flex items-center gap-1 pl-2 pr-2 hover:bg-surface ${node.dimmed ? 'opacity-60' : ''}`}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? '展开' : '折叠'}
            aria-expanded={!collapsed}
            className="w-[14px] shrink-0 text-[10px] text-mute"
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[12px]"
        >
          <span className={`min-w-0 flex-1 truncate ${LEVEL_CLASS[o.level]}`}>
            {displayName(o)}
          </span>
          <span className="shrink-0 rounded border border-line px-1 text-[10px] text-mute">
            {o.type}
          </span>
          <span className="w-[44px] shrink-0 text-right tabular-nums text-[11px] text-mute">
            {formatDuration(node.durationMs)}
          </span>
        </button>
      </div>
      {open && (
        <div className="ml-[26px]">
          <Detail traceId={traceId} o={o} />
        </div>
      )}
      {hasChildren && !collapsed && (
        <ul className="ml-[15px] border-l border-line">
          {node.children.map((c) => (
            <Node key={c.observation.id} node={c} traceId={traceId} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TraceTree({ traceId, observations, showDebug }: TraceTreeProps) {
  const roots = useMemo(() => buildObservationTree(observations), [observations])
  const visible = useMemo(() => visibleTree(roots, showDebug), [roots, showDebug])
  return (
    <ul className="py-1">
      {visible.map((n) => (
        <Node key={n.observation.id} node={n} traceId={traceId} />
      ))}
    </ul>
  )
}
