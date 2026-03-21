import { useEffect } from 'react'
import { useConfigStore } from '../../store/configStore'
import { ProviderList } from './ProviderList'
import { ProviderForm } from './ProviderForm'
import { EmptyState } from '../../components/EmptyState'
import type { ProviderInput } from '../../types/config'

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

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

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

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Provider 配置</h2>
        {formMode === 'closed' && (
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
      </div>

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
        <ProviderList
          providers={providers}
          testStatus={testStatus}
          onEdit={openEditForm}
          onDelete={deleteProvider}
          onSetDefault={setDefault}
          onTest={testConnection}
        />
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
  )
}
