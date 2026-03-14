import { describe, it, expect, beforeEach } from 'vitest'
import { useProviderStore } from '@/renderer/store/providerStore'

describe('ProviderStore', () => {
  beforeEach(() => {
    useProviderStore.setState({
      providers: [
        { id: 'ollama', name: 'Ollama', type: 'ollama' as const, baseUrl: 'http://localhost:11434', models: [], isConfigured: true },
        { id: 'openai', name: 'OpenAI', type: 'openai' as const, baseUrl: 'https://api.openai.com/v1', models: [], isConfigured: false }
      ],
      activeProviderId: 'ollama'
    })
  })

  it('should have default providers', () => {
    const { providers } = useProviderStore.getState()
    expect(providers.length).toBeGreaterThan(0)
  })

  it('should set active provider', () => {
    const { providers, setActiveProvider } = useProviderStore.getState()
    setActiveProvider(providers[1].id)
    expect(useProviderStore.getState().activeProviderId).toBe(providers[1].id)
  })

  it('should update provider', () => {
    const { updateProvider } = useProviderStore.getState()
    updateProvider('ollama', { apiKey: 'test-key' })
    const provider = useProviderStore.getState().providers.find(p => p.id === 'ollama')
    expect(provider?.apiKey).toBe('test-key')
  })
})
