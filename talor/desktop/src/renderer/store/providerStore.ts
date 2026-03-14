import { create } from 'zustand'
import type { Provider } from '../types'

const defaultProviders: Provider[] = [
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    models: [],
    isConfigured: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    isConfigured: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
    isConfigured: false
  },
  {
    id: 'google',
    name: 'Google',
    type: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    isConfigured: false
  }
]

interface ProviderState {
  providers: Provider[]
  activeProviderId: string | null
  isLoading: boolean
  loadProviders: () => Promise<void>
  setActiveProvider: (id: string) => void
  updateProvider: (id: string, updates: Partial<Provider>) => Promise<void>
  saveProvider: (provider: Provider) => Promise<void>
}

export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: defaultProviders,
  activeProviderId: 'ollama',
  isLoading: false,

  loadProviders: async () => {
    set({ isLoading: true })
    try {
      const providers = await window.api.provider.getAll()
      if (providers.length > 0) {
        set({ providers, isLoading: false })
      } else {
        for (const p of defaultProviders) {
          await window.api.provider.upsert(p)
        }
        set({ providers: defaultProviders, isLoading: false })
      }
    } catch (error) {
      console.error('Failed to load providers:', error)
      set({ providers: defaultProviders, isLoading: false })
    }
  },

  setActiveProvider: (id) => set({ activeProviderId: id }),

  updateProvider: async (id, updates) => {
    const { providers } = get()
    const provider = providers.find(p => p.id === id)
    if (!provider) return

    const updated = { ...provider, ...updates }
    await window.api.provider.upsert(updated)
    set((state) => ({
      providers: state.providers.map(p => p.id === id ? updated : p)
    }))
  },

  saveProvider: async (provider) => {
    await window.api.provider.upsert(provider)
    set((state) => {
      const exists = state.providers.find(p => p.id === provider.id)
      if (exists) {
        return {
          providers: state.providers.map(p => p.id === provider.id ? provider : p)
        }
      }
      return {
        providers: [...state.providers, provider]
      }
    })
  }
}))
