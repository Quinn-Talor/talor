import { useEffect, useState, useCallback } from 'react'
import { useConfigStore } from '../../store/configStore'
import { useChatStore } from '../../store/chatStore'
import { ProviderList } from './ProviderList'
import { ProviderForm } from './ProviderForm'
import { EmptyState } from '../../components/EmptyState'
import type { ProviderInput } from '../../types/config'
import { MCPServerList } from './MCPServerList'
import { MCPServerForm } from './MCPServerForm'
import { AccountsSettings } from './Accounts'
import type { MCPServer, MCPServerInput } from '../../../preload/index'
import { talorAPI } from '../../api/talorAPI'
import { AgentsPage } from '../Agents'

type Tab = 'common' | 'provider' | 'mcp' | 'agent' | 'account'

const TABS: { id: Tab; label: string }[] = [
  { id: 'common', label: 'Common' },
  { id: 'provider', label: 'Provider' },
  { id: 'mcp', label: 'MCP' },
  { id: 'agent', label: 'Agent' },
  { id: 'account', label: 'Account' },
]

interface SettingsPageProps {
  onBack: () => void
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const { setCurrentSession } = useChatStore()
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
    closeForm,
  } = useConfigStore()

  const [activeTab, setActiveTab] = useState<Tab>('provider')

  // MCP State
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpFormMode, setMcpFormMode] = useState<'closed' | 'creating' | 'editing'>('closed')
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null)
  const [mcpServerStatus, setMcpServerStatus] = useState<Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>>([])

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const fetchMcpServers = useCallback(async () => {
    setMcpLoading(true)
    try {
      const [servers, status] = await Promise.all([talorAPI.mcp.list(), talorAPI.mcp.getServerStatus()])
      setMcpServers(servers)
      setMcpServerStatus(status)
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error)
    } finally {
      setMcpLoading(false)
    }
  }, [])

  useEffect(() => { if (activeTab === 'mcp') fetchMcpServers() }, [activeTab, fetchMcpServers])

  const editingProvider = editingProviderId ? providers.find(p => p.id === editingProviderId) : undefined
  const existingNames = providers.map(p => p.name)

  const handleSubmit = async (data: ProviderInput) => {
    if (formMode === 'creating') await createProvider(data)
    else if (formMode === 'editing' && editingProviderId) await updateProvider(editingProviderId, data)
  }

  const handleTest = async (config: Parameters<typeof testConnection>[1]) => {
    const id = formMode === 'creating' ? '__new__' : (editingProviderId ?? '__new__')
    await testConnection(id, config)
  }

  const currentTest = formMode === 'creating'
    ? testStatus['__new__'] ?? { status: 'idle' as const }
    : editingProviderId ? testStatus[editingProviderId] ?? { status: 'idle' as const } : { status: 'idle' as const }

  // MCP Handlers
  const handleMcpSubmit = async (data: MCPServerInput) => {
    try {
      if (mcpFormMode === 'creating') await talorAPI.mcp.create(data)
      else if (mcpFormMode === 'editing' && mcpEditingId) await talorAPI.mcp.update(mcpEditingId, data)
      await fetchMcpServers()
      setMcpFormMode('closed')
      setMcpEditingId(null)
    } catch (error) {
      console.error('Failed to save MCP server:', error)
      alert('Failed to save MCP server')
    }
  }

  const handleMcpDelete = async (id: string) => {
    try { await talorAPI.mcp.delete(id); await fetchMcpServers() }
    catch (error) { console.error('Failed to delete MCP server:', error); alert('Failed to delete MCP server') }
  }

  const handleMcpToggleStatus = async (id: string, enabled: boolean) => {
    try { await talorAPI.mcp.setEnabled(id, enabled); await fetchMcpServers() }
    catch (error) { console.error('Failed to toggle MCP server:', error); alert('Failed to toggle MCP server status') }
  }

  const handleMcpTest = async (id: string) => {
    const server = mcpServers.find(s => s.id === id)
    if (!server) return
    try {
      const input: MCPServerInput = { name: server.name, type: server.type, command: server.command, args: server.args, env: server.env, url: server.url, auth: server.auth, enabled: server.enabled }
      const result = await talorAPI.mcp.testConnection(input)
      if (result.status === 'success') alert(`测试成功！可用工具数: ${result.tools_count || 0}`)
      else alert(`测试失败: ${result.message || result.error_code}`)
    } catch (error) {
      console.error('Failed to test MCP server:', error)
      alert('测试 MCP server 连接失败')
    }
  }

  const mcpEditingServer = mcpEditingId ? mcpServers.find(s => s.id === mcpEditingId) : undefined
  const existingMcpNames = mcpServers.map(s => s.name)

  return (
    <div className="flex flex-col h-full" style={{ background: 'linear-gradient(to bottom, #f8fafc, #f1f5f9)' }}>
      {/* Header row: back + title */}
      <div className="flex items-center gap-4 px-5 shrink-0" style={{ background: '#ffffff', borderBottom: '0.5px solid #e2e8f0', height: 52 }}>
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-1.5 rounded-[8px] text-[12px] transition-colors hover:bg-gray-50"
          style={{ height: 32, paddingLeft: 12, paddingRight: 12, background: '#ffffff', border: '0.5px solid #e2e8f0', color: '#64748b' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回
        </button>
        <h1 className="text-[20px] font-bold" style={{ color: '#0f172a' }}>设置</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-5 bg-white border-b border-gray-200 shrink-0" style={{ borderColor: '#e2e8f0' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}

        <div className="ml-auto pb-1">
          {activeTab === 'provider' && formMode === 'closed' && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增
            </button>
          )}
          {activeTab === 'mcp' && mcpFormMode === 'closed' && (
            <button
              onClick={() => { setMcpFormMode('creating'); setMcpEditingId(null) }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              新增
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Common tab */}
        {activeTab === 'common' && (
          <div className="max-w-2xl mx-auto p-6">
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="text-sm font-medium text-gray-800">快捷键</div>
                  <div className="text-xs text-gray-500 mt-0.5">⌘N 新建 · ⌘, 设置 · Esc 停止生成</div>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="text-sm font-medium text-gray-800">版本</div>
                  <div className="text-xs text-gray-500 mt-0.5">Talor Desktop — Phase 1</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Provider tab */}
        {activeTab === 'provider' && (
          <div className="max-w-2xl mx-auto p-6">
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
              <EmptyState message="暂无 Provider，请点击右上角按钮添加" action={{ label: '新增 Provider', onClick: openCreateForm }} />
            ) : (
              <div className={formMode !== 'closed' ? 'hidden' : ''}>
                <ProviderList providers={providers} testStatus={testStatus} onEdit={openEditForm} onDelete={deleteProvider} onSetDefault={setDefault} onTest={testConnection} />
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center py-8">
                <svg className="animate-spin w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* MCP tab */}
        {activeTab === 'mcp' && (
          <div className="p-6">
            {(mcpFormMode === 'creating' || mcpFormMode === 'editing') && (
              <div className="mb-6 max-w-2xl mx-auto">
                <MCPServerForm server={mcpEditingServer} existingNames={existingMcpNames} onSubmit={handleMcpSubmit} onCancel={() => { setMcpFormMode('closed'); setMcpEditingId(null) }} />
              </div>
            )}
            {mcpServers.length === 0 && mcpFormMode === 'closed' ? (
              <div className="max-w-2xl mx-auto">
                <EmptyState message="暂无 MCP Server" action={{ label: '新增 MCP Server', onClick: () => { setMcpFormMode('creating'); setMcpEditingId(null) } }} />
              </div>
            ) : (
              <div className={mcpFormMode !== 'closed' ? 'hidden' : ''}>
                <MCPServerList servers={mcpServers} serverStatus={mcpServerStatus} onEdit={(id) => { setMcpFormMode('editing'); setMcpEditingId(id) }} onDelete={handleMcpDelete} onToggleStatus={handleMcpToggleStatus} onTest={handleMcpTest} />
              </div>
            )}
            {mcpLoading && (
              <div className="flex items-center justify-center py-8">
                <svg className="animate-spin w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Agent tab */}
        {activeTab === 'agent' && (
          <AgentsPage onNavigateChat={(sessionId) => { setCurrentSession(sessionId); onBack() }} />
        )}

        {/* Account tab */}
        {activeTab === 'account' && (
          <div className="max-w-2xl mx-auto p-6">
            <AccountsSettings />
          </div>
        )}
      </div>
    </div>
  )
}
