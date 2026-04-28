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
  agentColor?: string
  onClick: () => void
  onDelete: () => void
}

export function SessionItem({ session, isActive, agentName, agentColor = '#60a5fa', onClick, onDelete }: SessionItemProps) {
  const title = session.title || '新会话'
  const initial = title.charAt(0)

  const avatarBg = isActive
    ? `rgba(${hexToRgb(agentColor)},0.30)`
    : `rgba(${hexToRgb(agentColor)},0.15)`

  return (
    <div
      className={`group relative flex items-center gap-0 px-[10px] py-0 cursor-pointer`}
      onClick={onClick}
      style={{ height: 56 }}
    >
      <div
        className="absolute inset-x-[4px] inset-y-[2px] rounded-[10px] transition-colors"
        style={{ background: isActive ? 'rgba(59,130,246,0.12)' : 'transparent' }}
      />
      <div className="relative flex items-center w-full gap-0" style={{ paddingLeft: 4, paddingRight: 4 }}>
        {/* Avatar */}
        <div
          className="shrink-0 flex items-center justify-center text-[11px] font-bold rounded-[7px]"
          style={{ width: 28, height: 28, background: avatarBg, color: agentColor }}
        >
          {initial}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0 ml-[8px]">
          <div
            className="text-[12px] font-medium truncate leading-tight"
            style={{ color: isActive ? '#ffffff' : 'rgba(255,255,255,0.7)' }}
          >
            {title}
          </div>
          <div
            className="text-[10px] truncate mt-0.5"
            style={{ color: isActive ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.25)' }}
          >
            {agentName ?? 'Talor'} · {relativeTime(session.updated_at)}
          </div>
        </div>

        {/* Delete button */}
        <button
          className="relative opacity-0 group-hover:opacity-100 p-1 rounded text-white/25 hover:text-red-400 transition-all shrink-0"
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r},${g},${b}`
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

const AGENT_COLORS = ['#8b5cf6', '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#ec4899']
export function agentColor(agentId: string | undefined): string {
  if (!agentId) return '#60a5fa'
  let hash = 0
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  return AGENT_COLORS[hash % AGENT_COLORS.length]
}
