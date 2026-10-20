// src/renderer/components/trace/TraceTree.tsx — 渲染层: observation 树
// (节点可折叠;GENERATION 行带 in → out token;点击行展开 input / output / metadata;
// GENERATION 输入先列构成表(消息 / 工具定义的字节占比),点开再看内容;隐藏 DEBUG 时其可见后代仍保留)

import { useMemo, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'
import type { ObservationLevel, ObservationRecord } from '@shared/types/trace'
import { formatTokens } from '../../lib/format-tokens'
import {
  buildObservationTree,
  displayName,
  formatBytes,
  generationTokens,
  parsePromptIndex,
  prettyPayload,
  promptComposition,
  toolDefinitionSizes,
  visibleTree,
  type DisplayNode,
  type PromptIndex,
  type PromptPart,
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

const PRE_CLASS =
  'max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface p-1.5 text-[11px]'

function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

/**
 * GENERATION 输入构成:先列构成表(每部分的字节与占比条,工具定义常是大头),
 * 点某行才拉对应 blob 展开 —— 消息展开为原文,工具定义展开为按单个工具字节排序的明细。
 */
function PromptComposition({ traceId, index }: { traceId: string; index: PromptIndex }) {
  const parts = useMemo(() => promptComposition(index), [index])
  const [openRows, setOpenRows] = useState<ReadonlySet<number>>(new Set())
  const [contents, setContents] = useState<Record<string, string>>({})
  const [toolSizes, setToolSizes] = useState<Array<{ name: string; bytes: number }> | null>(null)

  const toggle = (i: number, p: PromptPart) => {
    setOpenRows((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
    if (p.kind === 'tools') {
      if (toolSizes !== null) return
      void talorAPI.trace.getBlob(traceId, p.hash).then((r) => {
        setToolSizes(r.status === 'success' ? toolDefinitionSizes(r.content) : [])
      })
    } else if (contents[p.hash] === undefined) {
      void talorAPI.trace.getBlob(traceId, p.hash).then((r) => {
        const body = r.status === 'success' ? prettyPayload(r.content) : r.error_code
        setContents((c) => ({ ...c, [p.hash]: body }))
      })
    }
  }

  const total = parts.reduce((sum, p) => sum + p.bytes, 0)
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase text-mute">input · {formatBytes(total)}</div>
      <ul className="space-y-0.5">
        {parts.map((p, i) => {
          const isOpen = openRows.has(i)
          return (
            <li key={`${p.kind}-${p.hash}-${i}`}>
              <button
                type="button"
                onClick={() => toggle(i, p)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-2 rounded text-left text-[11px] hover:bg-surface"
              >
                <span className="w-[10px] shrink-0 text-[10px] text-mute">
                  {isOpen ? '▾' : '▸'}
                </span>
                <span className="w-[72px] shrink-0 truncate text-mute">{p.label}</span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-surface">
                  <span
                    className={`block h-full rounded ${p.kind === 'tools' ? 'bg-warn' : 'bg-line-2'}`}
                    style={{ width: `${Math.max(1, Math.round(p.share * 100))}%` }}
                  />
                </span>
                <span className="w-[56px] shrink-0 text-right tabular-nums text-mute">
                  {formatBytes(p.bytes)}
                </span>
                <span className="w-[32px] shrink-0 text-right tabular-nums text-mute">
                  {percent(p.share)}
                </span>
              </button>
              {isOpen && p.kind === 'message' && (
                <pre className={PRE_CLASS}>{contents[p.hash] ?? '…'}</pre>
              )}
              {isOpen && p.kind === 'tools' && (
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
            </li>
          )
        })}
      </ul>
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
        <PromptComposition traceId={traceId} index={index} />
      ) : (
        section('input', prettyPayload(o.input))
      )}
      {section('output', prettyPayload(o.output))}
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
  const tokens = generationTokens(o)
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
          {tokens && (
            <span className="shrink-0 tabular-nums text-[11px] text-mute">
              {formatTokens(tokens.input)} → {formatTokens(tokens.output)}
            </span>
          )}
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
