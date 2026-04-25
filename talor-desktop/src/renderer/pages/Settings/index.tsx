import { useEffect, useState, useCallback } from 'react'
import { useConfigStore } from '../../store/configStore'
import { ProviderList } from './ProviderList'
import { ProviderForm } from './ProviderForm'
import { EmptyState } from '../../components/EmptyState'
import type { ProviderInput } from '../../types/config'
import { MCPServerList } from './MCPServerList'
import { MCPServerForm } from './MCPServerForm'
import type { MCPServer, MCPServerInput } from '../../../preload/index'
import { talorAPI } from '../../api/talorAPI'

export function SettingsPage() {
  const {
    providers,
    loading,
    formMode,
    editingProviderId,
    testStatus,
    fetchProviders,
    createProvider,
    updateProvider,
    deleteProvider,
    setDefault,
    testConnection,
    openCreateForm,
    openEditForm,
    closeForm
  } = useConfigStore()

  // Tabs State
  const [activeTab, setActiveTab] = useState<'provider' | 'mcp'>('provider')

  // MCP State
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpFormMode, setMcpFormMode] = useState<'closed' | 'creating' | 'editing'>('closed')
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null)
  const [mcpServerStatus, setMcpServerStatus] = useState<Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>>([])

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const fetchMcpServers = useCallback(async () => {
    setMcpLoading(true)
    try {
      const [servers, status] = await Promise.all([
        talorAPI.mcp.list(),
        talorAPI.mcp.getServerStatus()
      ])
      setMcpServers(servers)
      setMcpServerStatus(status)
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error)
    } finally {
      setMcpLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'mcp') {
      fetchMcpServers()
    }
  }, [activeTab, fetchMcpServers])

  const editingProvider = editingProviderId
    ? providers.find((p) => p.id === editingProviderId)
    : undefined

  const existingNames = providers.map((p) => p.name)

  const handleSubmit = async (data: ProviderInput) => {
    if (formMode === 'creating') {
      await createProvider(data)
    } else if (formMode === 'editing' && editingProviderId) {
      await updateProvider(editingProviderId, data)
    }
  }

  const handleTest = async (config: Parameters<typeof testConnection>[1]) => {
    const id = formMode === 'creating' ? '__new__' : (editingProviderId ?? '__new__')
    await testConnection(id, config)
  }

  const currentTest = formMode === 'creating'
    ? testStatus['__new__'] ?? { status: 'idle' as const }
    : editingProviderId
      ? testStatus[editingProviderId] ?? { status: 'idle' as const }
      : { status: 'idle' as const }

  // MCP Handlers
  const handleMcpSubmit = async (data: MCPServerInput) => {
    try {
      if (mcpFormMode === 'creating') {
        await talorAPI.mcp.create(data)
      } else if (mcpFormMode === 'editing' && mcpEditingId) {
        await talorAPI.mcp.update(mcpEditingId, data)
      }
      await fetchMcpServers()
      setMcpFormMode('closed')
      setMcpEditingId(null)
    } catch (error) {
      console.error('Failed to save MCP server:', error)
      alert('Failed to save MCP server')
    }
  }

  const handleMcpDelete = async (id: string) => {
    try {
      await talorAPI.mcp.delete(id)
      await fetchMcpServers()
    } catch (error) {
      console.error('Failed to delete MCP server:', error)
      alert('Failed to delete MCP server')
    }
  }

  const handleMcpToggleStatus = async (id: string, enabled: boolean) => {
    try {
      await talorAPI.mcp.setEnabled(id, enabled)
      await fetchMcpServers()
    } catch (error) {
      console.error('Failed to toggle MCP server:', error)
      alert('Failed to toggle MCP server status')
    }
  }

  const handleMcpTest = async (id: string) => {
    const server = mcpServers.find(s => s.id === id)
    if (!server) return
    
    try {
      const input: MCPServerInput = {
        name: server.name,
        type: server.type,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
        auth: server.auth,
        enabled: server.enabled
      }
      const result = await talorAPI.mcp.testConnection(input)
      if (result.status === 'success') {
        alert(`测试成功！可用工具数: ${result.tools_count || 0}`)
      } else {
        alert(`测试失败: ${result.message || result.error_code}`)
      }
    } catch (error) {
      console.error('Failed to test MCP server:', error)
      alert('测试 MCP server 连接失败')
    }
  }

  const openMcpCreate = () => {
    setMcpFormMode('creating')
    setMcpEditingId(null)
  }

  const openMcpEdit = (id: string) => {
    setMcpFormMode('editing')
    setMcpEditingId(id)
  }

  const closeMcpForm = () => {
    setMcpFormMode('closed')
    setMcpEditingId(null)
  }

  const mcpEditingServer = mcpEditingId
    ? mcpServers.find((s) => s.id === mcpEditingId)
    : undefined

  const existingMcpNames = mcpServers.map((s) => s.name)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          <button
            className={`pb-3 text-base font-medium border-b-2 transition-colors ${
              activeTab === 'provider'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('provider')}
          >
            Provider 配置
          </button>
          <button
            className={`pb-3 text-base font-medium border-b-2 transition-colors ${
              activeTab === 'mcp'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('mcp')}
          >
            MCP Server
          </button>
        </div>
        
        <div className="pb-3">
          {activeTab === 'provider' && formMode === 'closed' && (
            <button
              onClick={openCreateForm}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增 Provider
            </button>
          )}
          {activeTab === 'mcp' && mcpFormMode === 'closed' && (
            <button
              onClick={openMcpCreate}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-1.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增 MCP Server
            </button>
          )}
        </div>
      </div>

      {activeTab === 'provider' && (
        <div className="max-w-2xl mx-auto">
          {(formMode === 'creating' || formMode === 'editing') && (
            <div className="mb-6">
              <ProviderForm
                provider={editingProvider}
                existingNames={existingNames}
                onSubmit={handleSubmit}
                onCancel={closeForm}
                onTest={handleTest}
                testStatus={currentTest.status}
                testResult={currentTest.result}
              />
            </div>
          )}

          {providers.length === 0 && formMode === 'closed' ? (
            <EmptyState
              message="暂无 Provider，请点击上方按钮添加"
              action={{
                label: '新增 Provider',
                onClick: openCreateForm
              }}
            />
          ) : (
            <div className={formMode !== 'closed' ? 'hidden' : ''}>
              <ProviderList
                providers={providers}
                testStatus={testStatus}
                onEdit={openEditForm}
                onDelete={deleteProvider}
                onSetDefault={setDefault}
                onTest={testConnection}
              />
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin w-6 h-6 text-primary-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
        </div>
      )}

      {activeTab === 'mcp' && (
        <div className="mx-auto">
          {(mcpFormMode === 'creating' || mcpFormMode === 'editing') && (
            <div className="mb-6 max-w-2xl mx-auto">
              <MCPServerForm
                server={mcpEditingServer}
                existingNames={existingMcpNames}
                onSubmit={handleMcpSubmit}
                onCancel={closeMcpForm}
              />
            </div>
          )}

          {mcpServers.length === 0 && mcpFormMode === 'closed' ? (
            <div className="max-w-2xl mx-auto">
              <EmptyState
                message="暂无 MCP Server，请点击上方按钮添加"
                action={{
                  label: '新增 MCP Server',
                  onClick: openMcpCreate
                }}
              />
            </div>
          ) : (
            <div className={mcpFormMode !== 'closed' ? 'hidden' : ''}>
              <MCPServerList
                servers={mcpServers}
                serverStatus={mcpServerStatus}
                onEdit={openMcpEdit}
                onDelete={handleMcpDelete}
                onToggleStatus={handleMcpToggleStatus}
                onTest={handleMcpTest}
              />
            </div>
          )}

          {mcpLoading && (
            <div className="flex items-center justify-center py-8">
              <svg className="animate-spin w-6 h-6 text-primary-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
