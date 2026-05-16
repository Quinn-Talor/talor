import { useState, useEffect, useRef } from 'react'
import type { ChatSession } from '../types/chat'

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d === 1) return '昨天'
  if (d < 7) return `${d}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

interface SessionItemProps {
  session: ChatSession
  isActive: boolean
  agentName?: string
  /** Gradient pair for the agent avatar — derived from agentGradient() */
  agentGradient?: { from: string; to: string }
  isRenaming?: boolean
  onStartRename?: () => void
  onCommitRename?: (title: string) => void
  onCancelRename?: () => void
  onClick: () => void
  onDelete: () => void
}

const DEFAULT_GRADIENT = { from: '#3b82f6', to: '#6366f1' }

export function SessionItem({
  session,
  isActive,
  agentName,
  agentGradient = DEFAULT_GRADIENT,
  isRenaming = false,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onClick,
  onDelete,
}: SessionItemProps) {
  const title = session.title || '新会话'
  const initial = title.charAt(0)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const committedRef = useRef(false)

  useEffect(() => {
    if (isRenaming) {
      setDraft(title)
      committedRef.current = false
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [isRenaming, title])

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 mx-2 rounded-md cursor-pointer transition-colors ${
        isActive ? 'bg-canvas shadow-[0_0_0_1px_var(--line)]' : 'hover:bg-line-2'
      }`}
      onClick={onClick}
    >
      {/* Avatar — 20×20 gradient by agent */}
      <div
        className="shrink-0 flex items-center justify-center text-[10px] font-bold rounded-[5px] text-white"
        style={{
          width: 20,
          height: 20,
          background: `linear-gradient(135deg, ${agentGradient.from}, ${agentGradient.to})`,
        }}
      >
        {initial}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                committedRef.current = true
                onCommitRename?.(draft)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                committedRef.current = true
                onCancelRename?.()
              }
            }}
            onBlur={() => {
              if (committedRef.current) return
              committedRef.current = true
              onCommitRename?.(draft)
            }}
            className="w-full text-[12.5px] font-medium leading-tight outline-none rounded px-1 -mx-1 bg-canvas text-text border border-line"
          />
        ) : (
          <div
            className="text-[12.5px] font-medium truncate leading-tight text-text"
            onDoubleClick={(e) => {
              e.stopPropagation()
              onStartRename?.()
            }}
          >
            {title}
          </div>
        )}
        <div className="text-[10.5px] truncate mt-0.5 text-subtle">
          {agentName ?? 'Talor'} · {relativeTime(session.updated_at)}
        </div>
      </div>

      {/* Delete button — hover-only */}
      {!isRenaming && (
        <button
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-subtle hover:text-err transition-all shrink-0"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      )}
    </div>
  )
}

export function getDateGroup(dateStr: string): 'today' | 'yesterday' | 'earlier' {
  const now = new Date()
  const d = new Date(dateStr)
  if (d.toDateString() === now.toDateString()) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday'
  return 'earlier'
}

/** 5 deterministic gradient pairs for agent avatars.
 *  Spec §6.2 — agents map to gradients by hash, not random per session. */
const AGENT_GRADIENTS: Array<{ from: string; to: string }> = [
  { from: '#10b981', to: '#059669' }, // emerald — secretary / customer
  { from: '#3b82f6', to: '#6366f1' }, // blue→indigo — research / analysis
  { from: '#f59e0b', to: '#d97706' }, // amber→orange — writing
  { from: '#8b5cf6', to: '#a855f7' }, // purple — scheduling
  { from: '#ec4899', to: '#db2777' }, // pink — data
]

export function agentGradient(agentId: string | undefined): { from: string; to: string } {
  if (!agentId) return DEFAULT_GRADIENT
  let hash = 0
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  return AGENT_GRADIENTS[hash % AGENT_GRADIENTS.length]
}

/**
 * @deprecated Use `agentGradient` for new code. This single-hex helper is kept for
 * legacy callers (TopBar, draft modals). Phase 12 will purge remaining usages.
 */
export function agentColor(agentId: string | undefined): string {
  return agentGradient(agentId).from
}
