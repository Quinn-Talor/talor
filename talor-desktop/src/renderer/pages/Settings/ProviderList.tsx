import { useState } from 'react'
import type { Provider, ConnectionTestResult, TestStatus } from '../../types/config'
import { ConnectionTest } from '../../components/ConnectionTest'
import { ConfirmDialog } from '../../components/ConfirmDialog'

interface ProviderListProps {
  providers: Provider[]
  testStatus: Record<string, { status: TestStatus; result?: ConnectionTestResult }>
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
  onTest: (id: string, config: { type: Provider['type']; base_url: string; api_key?: string }) => void
}

const TYPE_LABELS: Record<Provider['type'], string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI'
}

const TYPE_COLORS: Record<Provider['type'], string> = {
  ollama: 'bg-orange-100 text-orange-700',
  openai: 'bg-green-100 text-green-700',
  anthropic: 'bg-amber-100 text-amber-700',
  google: 'bg-blue-100 text-blue-700'
}

export function ProviderList({
  providers,
  testStatus,
  onEdit,
  onDelete,
  onSetDefault,
  onTest
}: ProviderListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const providerToDelete = deleteId ? providers.find((p) => p.id === deleteId) : null

  if (providers.length === 0) return null

  return (
    <>
      <div className="space-y-3">
        {providers.map((provider) => {
          const ts = testStatus[provider.id] ?? { status: 'idle' }
          return (
            <div
              key={provider.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-medium text-gray-900 truncate">{provider.name}</h4>
                    <span
                      className={`px-1.5 py-0.5 text-xs font-medium rounded ${TYPE_COLORS[provider.type]}`}
                    >
                      {TYPE_LABELS[provider.type]}
                    </span>
                    {provider.is_default && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-primary-100 text-primary-600">
                        默认
                      </span>
                    )}
                    {!provider.enabled && (
                      <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-400">
                        已禁用
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate mb-2">{provider.base_url}</p>
                  <div className="flex items-center gap-3">
                    <ConnectionTest
                      status={ts.status}
                      result={ts.result}
                      onTest={() =>
                        onTest(provider.id, {
                          type: provider.type,
                          base_url: provider.base_url,
                          api_key: provider.api_key
                        })
                      }
                      disabled={!provider.enabled}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {!provider.is_default && (
                    <button
                      onClick={() => onSetDefault(provider.id)}
                      disabled={!provider.enabled}
                      className="px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded transition-colors disabled:text-gray-300 disabled:cursor-not-allowed"
                      title="设为默认"
                    >
                      设为默认
                    </button>
                  )}
                  <button
                    onClick={() => onEdit(provider.id)}
                    className="px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 rounded transition-colors"
                    title="编辑"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => setDeleteId(provider.id)}
                    className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="删除"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {deleteId && providerToDelete && (
        <ConfirmDialog
          title="确认删除"
          message={`确认删除 "${providerToDelete.name}"？此操作不可撤销。`}
          confirmLabel="删除"
          cancelLabel="取消"
          onConfirm={() => {
            onDelete(deleteId)
            setDeleteId(null)
          }}
          onCancel={() => setDeleteId(null)}
          danger
        />
      )}
    </>
  )
}
