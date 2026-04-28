import { useState } from 'react'

export interface AgentCardData {
  id: string
  name: string
  description: string
  version: string
  status: 'disabled' | 'ready' | 'dependency_missing' | 'running'
  avatar?: string
}

interface AgentCardProps {
  agent: AgentCardData
  onStartChat: (agentId: string) => void
  onEnable: (agentId: string) => void
  onDelete: (agentId: string) => void
  onExport?: (agentId: string) => void
}

const statusStyles: Record<string, { bg: string; badge: string; badgeText: string }> = {
  ready: { bg: 'bg-white', badge: 'bg-green-100 text-green-700', badgeText: '就绪' },
  disabled: { bg: 'bg-gray-50 opacity-60', badge: 'bg-gray-100 text-gray-500', badgeText: '未启用' },
  dependency_missing: { bg: 'bg-amber-50', badge: 'bg-amber-100 text-amber-700', badgeText: '缺少依赖' },
  running: { bg: 'bg-blue-50', badge: 'bg-blue-100 text-blue-700', badgeText: '对话中' },
}

function AvatarIcon({ name }: { name: string }) {
  const char = name.charAt(0)
  return (
    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center text-white font-bold text-lg shrink-0">
      {char}
    </div>
  )
}

export function AgentCard({ agent, onStartChat, onEnable, onDelete, onExport }: AgentCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const style = statusStyles[agent.status] ?? statusStyles.disabled

  return (
    <div className={`${style.bg} rounded-xl border border-gray-200 p-4 flex flex-col gap-3 relative hover:shadow-md transition-shadow`}>
      <div className="flex items-start gap-3">
        <AvatarIcon name={agent.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800 truncate">{agent.name}</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${style.badge}`}>{style.badgeText}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{agent.description}</p>
          <span className="text-[10px] text-gray-400 mt-1">v{agent.version}</span>
        </div>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-1 rounded hover:bg-gray-100 text-gray-400"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="8" cy="3" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="8" cy="13" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-4 top-12 z-10 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[120px]">
            {onExport && (
              <button
                onClick={() => { setMenuOpen(false); onExport(agent.id) }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >
                导出
              </button>
            )}
            <button
              onClick={() => { setMenuOpen(false); onDelete(agent.id) }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              删除
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-auto">
        {agent.status === 'ready' && (
          <button
            onClick={() => onStartChat(agent.id)}
            className="flex-1 text-xs py-1.5 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
          >
            启动对话
          </button>
        )}
        {agent.status === 'disabled' && (
          <button
            onClick={() => onEnable(agent.id)}
            className="flex-1 text-xs py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
          >
            启用
          </button>
        )}
        {agent.status === 'dependency_missing' && (
          <button
            onClick={() => onEnable(agent.id)}
            className="flex-1 text-xs py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
          >
            安装依赖
          </button>
        )}
        {agent.status === 'running' && (
          <span className="flex-1 text-xs py-1.5 text-center text-blue-600 animate-pulse">
            对话中...
          </span>
        )}
      </div>
    </div>
  )
}

export function NewAgentCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border-2 border-dashed border-gray-300 p-4 flex flex-col items-center justify-center gap-2 hover:border-primary-400 hover:bg-primary-50/30 transition-colors min-h-[140px]"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span className="text-xs text-gray-500">新建 Agent</span>
    </button>
  )
}
