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
  onPreview?: (agentId: string) => void
  onExport?: (agentId: string) => void
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ready: { label: '就绪', cls: 'bg-green-50 text-green-600' },
  disabled: { label: '未启用', cls: 'bg-gray-100 text-gray-400' },
  dependency_missing: { label: '缺少依赖', cls: 'bg-amber-50 text-amber-600' },
  running: { label: '对话中', cls: 'bg-blue-50 text-blue-500' },
}

export function AgentCard({
  agent,
  onStartChat,
  onEnable,
  onDelete,
  onPreview,
  onExport,
}: AgentCardProps) {
  const badge = STATUS_BADGE[agent.status] ?? STATUS_BADGE.disabled

  return (
    <div
      className="bg-white rounded-xl flex flex-col relative"
      style={{ border: '1px solid #e8eaed' }}
    >
      {/* Body */}
      <div className="p-4 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white text-[15px] font-bold"
          style={{ background: 'linear-gradient(135deg, #6366f1bb, #4f46e5)' }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-semibold text-gray-800 truncate">{agent.name}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${badge.cls}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2">{agent.description}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">v{agent.version}</p>
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center border-t px-3 py-2 gap-1"
        style={{ borderColor: '#f1f3f4' }}
      >
        {agent.status === 'ready' && (
          <button
            onClick={() => onStartChat(agent.id)}
            className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          >
            启动对话
          </button>
        )}
        {agent.status === 'disabled' && (
          <button
            onClick={() => onEnable(agent.id)}
            className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          >
            启用
          </button>
        )}
        {agent.status === 'dependency_missing' && (
          <button
            onClick={() => onEnable(agent.id)}
            className="text-[11px] px-2 py-1 rounded-md text-amber-600 hover:bg-amber-50 transition-colors"
          >
            安装依赖
          </button>
        )}
        {agent.status === 'running' && (
          <span className="text-[11px] px-2 py-1 text-blue-500 animate-pulse">对话中...</span>
        )}
        {onPreview && (
          <button
            onClick={() => onPreview(agent.id)}
            className="text-[11px] px-2 py-1 rounded-md text-purple-600 hover:bg-purple-50 transition-colors"
          >
            预览
          </button>
        )}
        {onExport && (
          <button
            onClick={() => onExport(agent.id)}
            className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 transition-colors"
          >
            导出
          </button>
        )}
        <button
          onClick={() => onDelete(agent.id)}
          className="text-[11px] px-2 py-1 rounded-md text-red-500 hover:bg-red-50 transition-colors"
        >
          删除
        </button>
      </div>
    </div>
  )
}

export function NewAgentCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
      style={{ minHeight: 110 }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="text-gray-300"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span className="text-[11px] text-gray-400">新建 Agent</span>
    </button>
  )
}
