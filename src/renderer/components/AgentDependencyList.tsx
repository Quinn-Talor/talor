// src/renderer/components/AgentDependencyList.tsx — Agent 依赖列表组件
//
// 渲染 profile.dependencies.subagents 列表，标记每个 subagent 的可用状态：
//   - ready:               绿色 "已就绪"
//   - disabled:            黄色 "已禁用"
//   - dependency_missing:  红色 "依赖缺失"
//   - not_found:           红色 "未安装"
//
// 用于 agent 详情页 / crystallizer 草稿审阅页。

import type { SubagentDependency, AgentStatus } from '@shared/types/agent'

export interface AgentDependencyListProps {
  /** profile.dependencies.subagents 列表 */
  subagents: SubagentDependency[]
  /** id → { name, status } 查询；缺失时显示 'not_found' */
  resolveAgent?: (id: string) => { name: string; status: AgentStatus } | null
  /** 点击行触发；用于跳转到对应 agent 详情页 */
  onClickAgent?: (id: string) => void
}

const STATUS_LABEL: Record<AgentStatus | 'not_found', { text: string; className: string }> = {
  ready: { text: '已就绪', className: 'bg-green-100 text-green-800' },
  disabled: { text: '已禁用', className: 'bg-yellow-100 text-yellow-800' },
  dependency_missing: { text: '依赖缺失', className: 'bg-red-100 text-red-800' },
  running: { text: '运行中', className: 'bg-blue-100 text-blue-800' },
  not_found: { text: '未安装', className: 'bg-red-100 text-red-800' },
}

export function AgentDependencyList({
  subagents,
  resolveAgent,
  onClickAgent,
}: AgentDependencyListProps) {
  if (subagents.length === 0) {
    return <div className="text-sm text-gray-500 italic">此 Agent 没有声明 subagent 依赖。</div>
  }

  return (
    <ul className="space-y-2">
      {subagents.map((dep) => {
        const resolved = resolveAgent?.(dep.id)
        const status: AgentStatus | 'not_found' = resolved ? resolved.status : 'not_found'
        const label = STATUS_LABEL[status]
        const name = resolved?.name ?? dep.id

        return (
          <li
            key={dep.id}
            className={[
              'flex items-center justify-between p-3 rounded-md border',
              onClickAgent ? 'cursor-pointer hover:bg-gray-50' : '',
              status === 'not_found' || status === 'dependency_missing'
                ? 'border-red-200'
                : 'border-gray-200',
            ].join(' ')}
            onClick={() => onClickAgent?.(dep.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" title={dep.id}>
                  {dep.required ? '⚠️' : 'ℹ️'} {name}
                </span>
                <span className="text-xs text-gray-400">{dep.id}</span>
              </div>
              {dep.purpose && (
                <div className="mt-1 text-xs text-gray-500 truncate" title={dep.purpose}>
                  {dep.purpose}
                </div>
              )}
            </div>
            <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${label.className}`}>
              {label.text}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
