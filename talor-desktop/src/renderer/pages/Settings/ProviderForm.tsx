import { useState, useEffect, useCallback } from 'react'
import type { Provider, ProviderType, ProviderInput } from '../../types/config'
import { validateProviderForm } from '../../lib/validation'

interface ProviderFormProps {
  provider?: Provider
  existingNames: string[]
  onSubmit: (data: ProviderInput) => void
  onCancel: () => void
  onTest: (config: { type: ProviderType; base_url: string; api_key?: string }) => void
  testStatus: 'idle' | 'testing' | 'success' | 'failure'
  testResult?: { message?: string; models_count?: number; latency_ms?: number }
}

const PROVIDER_TYPE_OPTIONS: { value: ProviderType; label: string; defaultUrl?: string }[] = [
  { value: 'ollama', label: 'Ollama', defaultUrl: 'http://localhost:11434' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google AI' }
]

export function ProviderForm({
  provider,
  existingNames,
  onSubmit,
  onCancel,
  onTest,
  testStatus,
  testResult
}: ProviderFormProps) {
  const [type, setType] = useState<ProviderType>(provider?.type ?? 'ollama')
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '')
  const [apiKey, setApiKey] = useState(provider?.api_key ?? '')
  const [enabled, setEnabled] = useState(provider?.enabled ?? true)
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!provider && type === 'ollama' && !baseUrl) {
      setBaseUrl('http://localhost:11434')
    }
  }, [type, provider, baseUrl])

  const handleTypeChange = (newType: ProviderType) => {
    setType(newType)
    if (newType === 'ollama' && !baseUrl) {
      setBaseUrl('http://localhost:11434')
    }
  }

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const errs = validateProviderForm(name, type, baseUrl, apiKey, existingNames, provider?.id)
      if (errs.length > 0) {
        setErrors(Object.fromEntries(errs.map((err) => [err.field, err.message])))
        return
      }
      setErrors({})
      onSubmit({
        type,
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        enabled,
        is_default: provider?.is_default ?? false,
        models: provider?.models ?? []
      })
    },
    [name, type, baseUrl, apiKey, enabled, existingNames, provider, onSubmit]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    },
    [onCancel]
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-base font-semibold text-gray-900 mb-4">
        {provider ? '编辑 Provider' : '新增 Provider'}
      </h3>

      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">类型</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as ProviderType)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {PROVIDER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的 OpenAI"
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              errors.name ? 'border-red-400' : 'border-gray-200'
            }`}
          />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Base URL</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={
              type === 'ollama'
                ? 'http://localhost:11434'
                : type === 'openai'
                  ? 'https://api.openai.com/v1'
                  : ''
            }
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              errors.base_url ? 'border-red-400' : 'border-gray-200'
            }`}
          />
          {errors.base_url && <p className="mt-1 text-xs text-red-500">{errors.base_url}</p>}
        </div>

        {(type === 'openai' || type === 'anthropic' || type === 'google') && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
                errors.api_key ? 'border-red-400' : 'border-gray-200'
              }`}
            />
            {errors.api_key && <p className="mt-1 text-xs text-red-500">{errors.api_key}</p>}
          </div>
        )}

        {type === 'ollama' && (
          <p className="text-xs text-gray-400 -mt-2">API Key（可选）</p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (baseUrl) {
                onTest({ type, base_url: baseUrl, api_key: apiKey || undefined })
              }
            }}
            disabled={!baseUrl || testStatus === 'testing'}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              !baseUrl || testStatus === 'testing'
                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                : 'border-primary-300 text-primary-600 hover:bg-primary-50'
            }`}
          >
            {testStatus === 'testing' ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                测试中
              </span>
            ) : (
              '测试连接'
            )}
          </button>

          {testStatus === 'success' && testResult && (
            <span className="text-xs text-green-600">
              ✓ 成功 {testResult.latency_ms}ms
              {testResult.models_count !== undefined && testResult.models_count > 0
                ? ` · ${testResult.models_count} 个模型`
                : ''}
            </span>
          )}
          {testStatus === 'failure' && testResult && (
            <span className="text-xs text-red-500 max-w-xs truncate">{testResult.message}</span>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="enabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <label htmlFor="enabled" className="text-sm text-gray-600">启用</label>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors"
          >
            保存
          </button>
        </div>
      </form>
    </div>
  )
}
