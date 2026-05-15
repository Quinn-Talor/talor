// src/renderer/pages/Chat/Sidebar.tsx
//
// 渲染层: 工作区侧栏 — A2 样式（spec §6）。
// 顶部 search-filled chip + black solid + button；列表浅色；底部"设置"
// 作为 sidebar flex column 的独立子元素（跟 sb-list 同级，flex:1 推到底）。
//
// 允许依赖: components/* / hooks/* / store/*
// 禁止依赖: ipc/* / main/*

import { SessionItem, agentGradient, getDateGroup } from '../../components/SessionItem'
import type { ChatSession } from '../../types/chat'
import type { AgentCardData } from '../../components/AgentCard'

export interface SidebarProps {
  sessions: ChatSession[]
  agents: AgentCardData[]
  currentSessionId: string | null
  renamingSessionId: string | null
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onDeleteSession: (id: string) => void
  onStartRename: (id: string) => void
  onCommitRename: (id: string, title: string) => void
  onCancelRename: () => void
  onOpenSettings: () => void
}

export function Sidebar(props: SidebarProps) {
  const agentMap = new Map(props.agents.map((a) => [a.id, a]))
  const today: ChatSession[] = []
  const yesterday: ChatSession[] = []
  const earlier: ChatSession[] = []
  for (const s of props.sessions) {
    const g = getDateGroup(s.updated_at)
    if (g === 'today') today.push(s)
    else if (g === 'yesterday') yesterday.push(s)
    else earlier.push(s)
  }

  const renderSession = (s: ChatSession) => (
    <SessionItem
      key={s.id}
      session={s}
      isActive={s.id === props.currentSessionId}
      agentName={s.agent_id ? agentMap.get(s.agent_id)?.name : undefined}
      agentGradient={agentGradient(s.agent_id)}
      isRenaming={s.id === props.renamingSessionId}
      onStartRename={() => props.onStartRename(s.id)}
      onCommitRename={(t) => props.onCommitRename(s.id, t)}
      onCancelRename={props.onCancelRename}
      onClick={() => props.onSelectSession(s.id)}
      onDelete={() => props.onDeleteSession(s.id)}
    />
  )

  return (
    <aside className="w-[240px] bg-surface border-r border-line flex flex-col shrink-0 select-none">
      {/* macOS traffic lights drag region */}
      <div
        className="h-[30px] shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* A2: search filled chip + black solid + button */}
      <div
        className="mx-[14px] mb-[6px] flex gap-2 items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div
          role="button"
          tabIndex={0}
          className="flex-1 h-[30px] px-[10px] bg-line-2 rounded-[7px] flex items-center gap-[7px] cursor-text transition-colors hover:bg-line"
          title="搜索（暂未启用）"
        >
          <SearchIcon />
          <span className="flex-1 text-[12.5px] text-mute">搜索</span>
        </div>
        <button
          className="w-[30px] h-[30px] rounded-[7px] bg-text text-canvas flex items-center justify-center cursor-pointer hover:bg-[#000] transition-colors"
          title="新建会话 ⌘N"
          onClick={props.onCreateSession}
        >
          <PlusIcon />
        </button>
      </div>

      {/* Session list — only sessions, no settings here */}
      <div className="flex-1 overflow-y-auto pt-1 pb-2">
        {today.length === 0 && yesterday.length === 0 && earlier.length === 0 && (
          <div className="text-center text-[12px] mt-8 text-subtle">暂无会话</div>
        )}
        {today.length > 0 && (
          <>
            <div className="px-[16px] pt-[10px] pb-1 text-[10px] text-mute uppercase tracking-[0.06em] font-semibold">
              今天
            </div>
            {today.map(renderSession)}
          </>
        )}
        {yesterday.length > 0 && (
          <>
            <div className="px-[16px] pt-[10px] pb-1 text-[10px] text-mute uppercase tracking-[0.06em] font-semibold">
              昨天
            </div>
            {yesterday.map(renderSession)}
          </>
        )}
        {earlier.length > 0 && (
          <>
            <div className="px-[16px] pt-[10px] pb-1 text-[10px] text-mute uppercase tracking-[0.06em] font-semibold">
              更早
            </div>
            {earlier.map(renderSession)}
          </>
        )}
      </div>

      {/* Settings — sibling of sb-list (NOT inside it). Spec §6.3:
          flex:1 on the list above pushes this to the very bottom.
          No border-top — visual is "last list item", structure is sibling. */}
      <button
        className="flex items-center gap-[9px] px-2 py-[7px] mx-2 mb-2 rounded-md cursor-pointer text-mute hover:bg-line-2 hover:text-text transition-colors text-[12.5px] text-left w-[calc(100%-16px)]"
        onClick={props.onOpenSettings}
      >
        <GearIcon />
        <span className="flex-1">设置</span>
        <span className="font-mono text-[10px] text-subtle">⌘,</span>
      </button>
    </aside>
  )
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="var(--mute)"
      strokeWidth="1.8"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
