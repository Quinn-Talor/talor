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
    providers, loading, formMode, editingProviderId, testStatus,
    fetchProviders, createProvider, updateProvider, deleteProvider,
    setDefault, testConnection, openCreateForm, openEditForm, closeForm,
  } = useConfigStore()

  const [activeTab, setActiveTab] = useState<Tab>('provider')
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpFormMode, setMcpFormMode] = useState<'closed' | 'creating' | 'editing'>('closed')
  const [mcpEditingId, setMcpEditingId] = useState<string | null>(null)
  const [mcpServerStatus, setMcpServerStatus] = useState<Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>>([])
  const [agentImportTrigger, setAgentImportTrigger] = useState(0)
  const [accountAddTrigger, setAccountAddTrigger] = useState(0)

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
    catch (error) { console.error('Failed to toggle MCP server:', error) }
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
      alert('测试 MCP server 连接失败')
    }
  }

  const mcpEditingServer = mcpEditingId ? mcpServers.find(s => s.id === mcpEditingId) : undefined
  const existingMcpNames = mcpServers.map(s => s.name)

  return (
    <div className="flex flex-col h-full" style={{ background: '#f4f6f8' }}>

      {/* Header */}
      <div className="shrink-0 bg-white" style={{ borderBottom: '1px solid #e8eaed' }}>
        <div className="max-w-4xl mx-auto px-8" style={{ height: 52, display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[13px] text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            返回
          </button>
          <span style={{ color: '#d1d5db', fontSize: 14 }}>/</span>
          <span className="text-[14px] font-medium text-gray-700">设置</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 bg-white" style={{ borderBottom: '1px solid #e8eaed' }}>
        <div className="max-w-4xl mx-auto px-8 flex items-center">
          <div className="flex items-center gap-1 flex-1">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-3 text-[13px] font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab === 'provider' && formMode === 'closed' && (
            <AddBtn onClick={openCreateForm} />
          )}
          {activeTab === 'mcp' && mcpFormMode === 'closed' && (
            <AddBtn onClick={() => { setMcpFormMode('creating'); setMcpEditingId(null) }} />
          )}
          {activeTab === 'agent' && (
            <AddBtn onClick={() => setAgentImportTrigger(t => t + 1)} label="导入" />
          )}
          {activeTab === 'account' && (
            <AddBtn onClick={() => setAccountAddTrigger(t => t + 1)} />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-8">
        <div className="max-w-4xl mx-auto px-8">

          {/* Common */}
          {activeTab === 'common' && (
            <div>
              <div className="bg-white rounded-xl overflow-hidden" style={{ border: '1px solid #e8eaed' }}>
                <SettingRow label="快捷键" value="⌘N 新建 · ⌘, 设置 · Esc 停止生成" />
                <SettingRow label="版本" value="Talor Desktop — Phase 1" last />
              </div>
            </div>
          )}

          {/* Provider */}
          {activeTab === 'provider' && (
            <div className="space-y-4">
              {(formMode === 'creating' || formMode === 'editing') && (
                <div className="bg-white rounded-xl p-5" style={{ border: '1px solid #e8eaed' }}>
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
              {formMode === 'closed' && (
                providers.length === 0
                  ? <EmptyState message="暂无 Provider" action={{ label: '新增 Provider', onClick: openCreateForm }} />
                  : <ProviderList providers={providers} testStatus={testStatus} onEdit={openEditForm} onDelete={deleteProvider} onSetDefault={setDefault} onTest={testConnection} />
              )}
              {loading && <Spinner />}
            </div>
          )}

          {/* MCP */}
          {activeTab === 'mcp' && (
            <div className="space-y-4">
              {(mcpFormMode === 'creating' || mcpFormMode === 'editing') && (
                <div className="bg-white rounded-xl p-5" style={{ border: '1px solid #e8eaed' }}>
                  <MCPServerForm server={mcpEditingServer} existingNames={existingMcpNames} onSubmit={handleMcpSubmit} onCancel={() => { setMcpFormMode('closed'); setMcpEditingId(null) }} />
                </div>
              )}
              {mcpFormMode === 'closed' && (
                mcpServers.length === 0
                  ? <EmptyState message="暂无 MCP Server" action={{ label: '新增 MCP Server', onClick: () => { setMcpFormMode('creating'); setMcpEditingId(null) } }} />
                  : <MCPServerList servers={mcpServers} serverStatus={mcpServerStatus} onEdit={(id) => { setMcpFormMode('editing'); setMcpEditingId(id) }} onDelete={handleMcpDelete} onToggleStatus={handleMcpToggleStatus} onTest={handleMcpTest} />
              )}
              {mcpLoading && <Spinner />}
            </div>
          )}

          {/* Agent */}
          {activeTab === 'agent' && (
            <AgentsPage onNavigateChat={(sessionId) => { setCurrentSession(sessionId); onBack() }} importTrigger={agentImportTrigger} />
          )}

          {/* Account */}
          {activeTab === 'account' && (
            <AccountsSettings addTrigger={accountAddTrigger} />
          )}

        </div>
      </div>
    </div>
  )
}

function AddBtn({ onClick, label = '新增' }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-[12px] font-medium text-blue-600 hover:text-blue-700 transition-colors px-2.5 py-1.5 rounded-lg hover:bg-blue-50"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      {label}
    </button>
  )
}

function SettingRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-5 py-3.5 ${!last ? 'border-b border-gray-100' : ''}`}>
      <span className="text-[13px] font-medium text-gray-700">{label}</span>
      <span className="text-[13px] text-gray-400">{value}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center py-6">
      <svg className="animate-spin w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  )
}
