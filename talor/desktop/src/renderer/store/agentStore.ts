import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Agent } from '../types'

interface AgentState {
  agents: Agent[]
  currentAgentId: string | null
  setCurrentAgent: (id: string | null) => void
}

const platformAgents: Agent[] = [
  {
    id: 'build',
    name: 'Build',
    kind: 'platform',
    description: '通用执行员 - 执行具体任务',
    capabilities: ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'ls']
  },
  {
    id: 'plan',
    name: 'Plan',
    kind: 'platform',
    description: '任务规划员 - 分解复杂任务',
    capabilities: ['analysis', 'planning']
  },
  {
    id: 'explore',
    name: 'Explore',
    kind: 'platform',
    description: '信息探索员 - 搜索和分析代码',
    capabilities: ['search', 'analysis']
  }
]

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
      agents: platformAgents,
      currentAgentId: 'build',
      setCurrentAgent: (id) => set({ currentAgentId: id })
    }),
    {
      name: 'talor-agents'
    }
  )
)
