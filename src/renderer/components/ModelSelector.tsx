import { useEffect, useState } from 'react'
import { talorAPI } from '../api/talorAPI'
import type { Provider } from '../types/config'
import type { ModelInfo } from '@shared/types/models'
import { ModelCard } from './ModelCard'

interface ModelSelectorProps {
  onSelect: (providerId: string, modelId: string) => void
  onCancel: () => void
}

export function ModelSelector({ onSelect, onCancel }: ModelSelectorProps) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [loadingProviders, setLoadingProviders] = useState(true)
  const [loadingModels, setLoadingModels] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadProviders = async () => {
      try {
        setLoadingProviders(true)
        setError(null)
        const data = await talorAPI.providers.list()
        setProviders(data)
        const defaultProvider = data.find((p) => p.is_default) || data[0]
        if (defaultProvider) {
          setSelectedProviderId(defaultProvider.id)
        }
      } catch (e) {
        setError('无法加载模型提供商，请检查设置')
        console.error('Failed to load providers', e)
      } finally {
        setLoadingProviders(false)
      }
    }
    loadProviders()
  }, [])

  useEffect(() => {
    if (!selectedProviderId) {
      setModels([])
      setSelectedModelId('')
      return
    }

    const loadModels = async () => {
      try {
        setLoadingModels(true)
        setError(null)
        const response = await talorAPI.providers.getModels(selectedProviderId)
        setModels(response.models)
        if (response.models.length > 0) {
          setSelectedModelId(response.models[0].id)
        } else {
          setSelectedModelId('')
        }
      } catch (e) {
        setError('无法加载模型列表，请检查 Provider 连接')
        setModels([])
        setSelectedModelId('')
        console.error('Failed to load models', e)
      } finally {
        setLoadingModels(false)
      }
    }
    loadModels()
  }, [selectedProviderId])

  const handleConfirm = () => {
    if (selectedProviderId && selectedModelId) {
      onSelect(selectedProviderId, selectedModelId)
    }
  }

  const canConfirm = selectedProviderId && selectedModelId && !loadingModels && !loadingProviders

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">新建会话</h2>
          <p className="text-sm text-gray-500 mt-1">选择模型开始对话</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">模型提供商</label>
            {loadingProviders ? (
              <div className="text-sm text-gray-400 py-2">加载中...</div>
            ) : providers.length === 0 ? (
              <div className="text-sm text-gray-500 py-2">
                暂无提供商，请先在
                <span className="text-primary-600 font-medium">「设置」</span>
                中添加模型提供商
              </div>
            ) : (
              <select
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.is_default ? ' (默认)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedProviderId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">选择模型</label>
              {loadingModels ? (
                <div className="text-sm text-gray-400 py-2">正在检测模型...</div>
              ) : models.length === 0 ? (
                <div className="text-sm text-gray-500 py-2 bg-gray-50 rounded-lg p-3">
                  该提供商暂无可用模型。请先在设置中检测模型列表，或确认 Provider 连接正常。
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {models.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      isSelected={model.id === selectedModelId}
                      onSelect={setSelectedModelId}
                      compact={true}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 disabled:bg-gray-300 disabled:text-gray-400 rounded-lg transition-colors"
          >
            开始对话
          </button>
        </div>
      </div>
    </div>
  )
}
