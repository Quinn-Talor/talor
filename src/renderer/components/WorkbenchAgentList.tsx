// WorkbenchAgentList — list of agents created from this workbench session.
// Spec §B.9.2:
//   已生成 Agents (2)
//    • love-letter-writer v1.0.0 (基于 8 条) [打开] [✕ 移除]

import type { GeneratedAgentEntry } from '../hooks/useCrystallizeWorkbench'

interface WorkbenchAgentListProps {
  agents: GeneratedAgentEntry[]
  onRemove: (id: string) => void
  onPreview: (id: string) => void
  onStart: (id: string) => void
}

export function WorkbenchAgentList({
  agents,
  onRemove,
  onPreview,
  onStart,
}: WorkbenchAgentListProps) {
  if (agents.length === 0) {
    return (
      <div
        className="px-4 py-3 text-[12px] text-center"
        style={{ background: '#faf5ff', color: '#94a3b8', borderTop: '1px solid #e9d5ff' }}
      >
        尚未保存任何 agent。审阅 Crystallizer 输出的草稿后保存即可。
      </div>
    )
  }
  return (
    <div
      className="px-4 py-3"
      style={{ background: '#faf5ff', borderTop: '1px solid #e9d5ff' }}
      data-testid="workbench-agent-list"
    >
      <div className="text-[11px] font-semibold mb-2" style={{ color: '#7c3aed' }}>
        已生成 Agents ({agents.length})
      </div>
      <ul className="space-y-1.5">
        {agents.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-[12px]"
            style={{ border: '1px solid #e9d5ff' }}
          >
            <span className="text-base">🔮</span>
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium" style={{ color: '#1e293b' }}>
                {a.name}
              </div>
              <div className="text-[10px]" style={{ color: '#94a3b8' }}>
                {a.id} · 生成于 {formatTime(a.created_at)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onPreview(a.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-purple-100"
              style={{ color: '#7c3aed' }}
              aria-label={`Preview ${a.id}`}
            >
              👁 预览
            </button>
            <button
              type="button"
              onClick={() => onStart(a.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium hover:bg-purple-100"
              style={{ color: '#7c3aed' }}
              aria-label={`Start ${a.id}`}
              data-testid={`workbench-start-${a.id}`}
            >
              ▶ 开始
            </button>
            <button
              type="button"
              onClick={() => onRemove(a.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] hover:bg-red-50"
              style={{ color: '#dc2626' }}
              aria-label={`Remove ${a.id} from workbench`}
            >
              ✕ 移除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}
