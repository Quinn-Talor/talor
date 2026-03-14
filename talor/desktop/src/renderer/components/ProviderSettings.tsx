import { useProviderStore } from '../store/providerStore'

export function ProviderSettings() {
  const { providers, activeProviderId, setActiveProvider, updateProvider } = useProviderStore()

  return (
    <div className="p-4">
      <h2 className="text-xl font-bold mb-4">Provider Settings</h2>
      <div className="space-y-3">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className={`p-4 border rounded-lg ${
              activeProviderId === provider.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{provider.name}</div>
                <div className="text-sm text-gray-500">{provider.type}</div>
              </div>
              <div className="flex items-center gap-2">
                {activeProviderId === provider.id && (
                  <span className="text-xs bg-blue-500 text-white px-2 py-1 rounded">Active</span>
                )}
                <button
                  onClick={() => setActiveProvider(provider.id)}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  {activeProviderId === provider.id ? 'Selected' : 'Select'}
                </button>
              </div>
            </div>
            {provider.type !== 'ollama' && (
              <div className="mt-3 space-y-2">
                <input
                  type="password"
                  placeholder="API Key"
                  value={provider.apiKey || ''}
                  onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                  className="w-full px-3 py-2 border rounded text-sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
