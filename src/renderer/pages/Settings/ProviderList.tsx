import { useState } from 'react'
import type { Provider, ConnectionTestResult, TestStatus } from '../../types/config'
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
  ollama: 'Ollama', openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google'
}

const TYPE_COLOR: Record<Provider['type'], string> = {
  ollama: '#f97316', openai: '#22c55e', anthropic: '#f59e0b', google: '#3b82f6'
}

export function ProviderList({ providers, testStatus, onEdit, onDelete, onSetDefault, onTest }: ProviderListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const providerToDelete = deleteId ? providers.find(p => p.id === deleteId) : null
  if (providers.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {providers.map(provider => {
          const ts = testStatus[provider.id] ?? { status: 'idle' }
          const color = TYPE_COLOR[provider.type]
          const isTesting = ts.status === 'testing'

          return (
            <div key={provider.id} className={`bg-white rounded-xl flex flex-col ${!provider.enabled ? 'opacity-50' : ''}`} style={{ border: '1px solid #e8eaed' }}>
              {/* Body */}
              <div className="p-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-white text-[15px] font-bold"
                  style={{ background: `linear-gradient(135deg, ${color}bb, ${color})` }}>
                  {provider.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-semibold text-gray-800 truncate">{provider.name}</span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md" style={{ background: `${color}18`, color }}>
                      {TYPE_LABELS[provider.type]}
                    </span>
                    {provider.is_default && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-500">默认</span>
                    )}
                    {!provider.enabled && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-400">已禁用</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{provider.base_url}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{provider.models?.length ?? 0} 个模型</p>
                  {ts.status === 'success' && ts.result && (
                    <p className="text-[11px] text-green-600 mt-0.5">{ts.result.latency_ms}ms{ts.result.models_count ? ` · ${ts.result.models_count} 模型` : ''}</p>
                  )}
                  {ts.status === 'failure' && ts.result && (
                    <p className="text-[11px] text-red-500 mt-0.5 truncate">{ts.result.message}</p>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center border-t px-3 py-2 gap-1" style={{ borderColor: '#f1f3f4' }}>
                <ActionBtn
                  onClick={() => onTest(provider.id, { type: provider.type, base_url: provider.base_url, api_key: provider.api_key })}
                  disabled={!provider.enabled || isTesting}
                >
                  {isTesting ? '测试中…' : '测试'}
                </ActionBtn>
                {!provider.is_default && (
                  <ActionBtn onClick={() => onSetDefault(provider.id)} disabled={!provider.enabled}>设为默认</ActionBtn>
                )}
                <ActionBtn onClick={() => onEdit(provider.id)}>编辑</ActionBtn>
                <ActionBtn onClick={() => setDeleteId(provider.id)} danger>删除</ActionBtn>
              </div>
            </div>
          )
        })}
      </div>

      {deleteId && providerToDelete && (
        <ConfirmDialog
          title="确认删除" message={`确认删除 "${providerToDelete.name}"？此操作不可撤销。`}
          confirmLabel="删除" cancelLabel="取消"
          onConfirm={() => { onDelete(deleteId); setDeleteId(null) }}
          onCancel={() => setDeleteId(null)} danger
        />
      )}
    </>
  )
}

function ActionBtn({ onClick, disabled, danger, children }: { onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-500 hover:bg-gray-100'
      }`}>
      {children}
    </button>
  )
}
