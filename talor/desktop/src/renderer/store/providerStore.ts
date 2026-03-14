import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Provider } from '../types'

interface ProviderState {
  providers: Provider[]
  activeProviderId: string | null
  setActiveProvider: (id: string) => void
  updateProvider: (id: string, updates: Partial<Provider>) => void
}

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

export const useProviderStore = create<ProviderState>()(
  persist(
    (set) => ({
      providers: defaultProviders,
      activeProviderId: 'ollama',
      setActiveProvider: (id) => set({ activeProviderId: id }),
      updateProvider: (id, updates) => set((state) => ({
        providers: state.providers.map((p) => 
          p.id === id ? { ...p, ...updates } : p
        )
      }))
    }),
    {
      name: 'talor-providers'
    }
  )
)
