import { useState, useEffect, useCallback } from 'react'
import { talorAPI } from '../../api/talorAPI'
import { AgentCard, NewAgentCard } from '../../components/AgentCard'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import type { AgentCardData } from '../../components/AgentCard'

interface AgentsPageProps {
  onNavigateChat: (sessionId: string) => void
}

export function AgentsPage({ onNavigateChat }: AgentsPageProps) {
  const [agents, setAgents] = useState<AgentCardData[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadAgents = useCallback(async () => {
    try {
      const list = await talorAPI.agents.list() as AgentCardData[]
      setAgents(list)
    } catch (err) {
      console.error('Failed to load agents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAgents() }, [loadAgents])

  const handleStartChat = async (agentId: string) => {
    try {
      const { session_id } = await talorAPI.agents.createSession(agentId)
      onNavigateChat(session_id)
    } catch (err) {
      console.error('Failed to create agent session:', err)
    }
  }

  const handleEnable = async (agentId: string) => {
    try {
      await talorAPI.agents.enable(agentId)
      await loadAgents()
    } catch (err) {
      console.error('Failed to enable agent:', err)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await talorAPI.agents.delete(deleteTarget)
      setDeleteTarget(null)
      await loadAgents()
    } catch (err) {
      console.error('Failed to delete agent:', err)
    }
  }

  const handleImport = async () => {
    try {
      const paths = await talorAPI.file.openDialog({
        title: '导入 Agent',
        filters: [{ name: 'Agent Package', extensions: ['zip'] }],
        properties: ['openFile'],
      })
      if (!paths || paths.length === 0) return
      // TODO: Phase 3 import IPC integration
      await loadAgents()
    } catch (err) {
      console.error('Failed to import agent:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-sm text-gray-400">加载中...</span>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-800">Agent</h2>
          <button
            onClick={handleImport}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
          >
            导入
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onStartChat={handleStartChat}
              onEnable={handleEnable}
              onDelete={setDeleteTarget}
            />
          ))}
          <NewAgentCard onClick={() => { /* TODO: crystallize flow */ }} />
        </div>

        {agents.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-gray-400 mb-2">还没有 Agent</p>
            <p className="text-xs text-gray-400">从对话中沉淀一个 Agent，或导入已有的 Agent 包</p>
          </div>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="删除 Agent"
          message="确定要删除该 Agent 吗？此操作不可撤销。已有的对话记录不会受影响。"
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
