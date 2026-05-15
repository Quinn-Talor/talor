// src/renderer/components/tool-calls/ToolRow.tsx
//
// 渲染层: 通用工具调用单行 — spec §10.1。
// [stat icon] [tool name] [target truncate] [duration]。可选 expandable + children body。

import { useState, type ReactNode } from 'react'

export type ToolStatus = 'running' | 'done' | 'error' | 'denied'

interface ToolRowProps {
  status: ToolStatus
  name: string
  target: string
  durationMs?: number
  expandable?: boolean
  children?: ReactNode
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ToolRow({ status, name, target, durationMs, expandable, children }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const dur = formatDuration(durationMs)
  return (
    <>
      <button
        type="button"
        className="tool-row"
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
      >
        <span className={`tool-stat stat-${status}`}>
          {status === 'running' && <span className="spinner" />}
          {status === 'done' && <CheckIcon />}
          {status === 'error' && <CrossIcon />}
          {status === 'denied' && <span>—</span>}
        </span>
        <span className="tool-name">{name}</span>
        <span className="tool-target">{target}</span>
        {dur && <span className="tool-dur">{dur}</span>}
        {expandable && <span className="tool-chev">{expanded ? '▾' : '▸'}</span>}
      </button>
      {expanded && children && <div className="tool-body">{children}</div>}
    </>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
