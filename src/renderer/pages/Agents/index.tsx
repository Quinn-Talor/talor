import { useState, useEffect, useCallback, useRef } from 'react'
import { talorAPI } from '../../api/talorAPI'
import { AgentCard, NewAgentCard } from '../../components/AgentCard'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AgentEditPage } from './AgentEditPage'
import { AgentDetailPage } from './AgentDetailPage'
import type { AgentCardData } from '../../components/AgentCard'

interface AgentsPageProps {
  onNavigateChat: (sessionId: string) => void
  importTrigger?: number
}

export function AgentsPage({ onNavigateChat, importTrigger }: AgentsPageProps) {
  const [agents, setAgents] = useState<AgentCardData[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // 详情页(原 Modal): 非 null 时替换列表显示
  const [detailAgentId, setDetailAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Schema 1.0 编辑页:editTarget=undefined 关闭,null 新建,string 编辑
  const [editTarget, setEditTarget] = useState<string | null | undefined>(undefined)

  const loadAgents = useCallback(async () => {
    try {
      const list = (await talorAPI.agents.list()) as AgentCardData[]
      setAgents(list)
    } catch (err) {
      console.error('Failed to load agents:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const prevImportTrigger = useRef(importTrigger)
  useEffect(() => {
    if (importTrigger !== undefined && importTrigger !== prevImportTrigger.current) {
      prevImportTrigger.current = importTrigger
      handleImport()
    }
  }, [importTrigger])

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
      await loadAgents()
    } catch (err) {
      console.error('Failed to import agent:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <svg className="animate-spin w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    )
  }

  // 详情页:替换列表 (内嵌工作区,非弹窗)
  if (detailAgentId) {
    return (
      <AgentDetailPage
        agentId={detailAgentId}
        onBack={() => setDetailAgentId(null)}
        onStart={async (id) => {
          try {
            const { session_id } = await talorAPI.agents.createSession(id)
            setDetailAgentId(null)
            onNavigateChat(session_id)
          } catch (err) {
            console.error('Failed to start agent session:', err)
          }
        }}
        onEdit={(id) => {
          setDetailAgentId(null)
          setEditTarget(id)
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {agents.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-sm mb-1">还没有 Agent</p>
          <p className="text-xs">从对话中沉淀一个 Agent，或导入已有的 Agent 包</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onStartChat={handleStartChat}
              onEnable={handleEnable}
              onDelete={setDeleteTarget}
              onPreview={setDetailAgentId}
            />
          ))}
          <NewAgentCard onClick={() => setEditTarget(null)} />
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除 Agent"
          message="确定要删除该 Agent 吗？此操作不可撤销。"
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {editTarget !== undefined && (
        <AgentEditPage
          agentId={editTarget ?? undefined}
          onClose={async () => {
            setEditTarget(undefined)
            await loadAgents()
          }}
        />
      )}
    </div>
  )
}
