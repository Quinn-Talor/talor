import { create } from 'zustand'
import { talorAPI } from '../api/talorAPI'
import type { Provider, ProviderInput, ConnectionTestResult, FormMode } from '../types/config'

interface ConfigStore {
  providers: Provider[]
  loading: boolean
  error: string | null
  formMode: FormMode
  editingProviderId: string | null
  testStatus: Record<string, { status: 'idle' | 'testing' | 'success' | 'failure'; result?: ConnectionTestResult }>

  fetchProviders: () => Promise<void>
  createProvider: (provider: ProviderInput) => Promise<void>
  updateProvider: (id: string, updates: ProviderInput) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  setDefault: (id: string) => Promise<void>
  testConnection: (
    id: string,
    config: { type: Provider['type']; base_url: string; api_key?: string }
  ) => Promise<void>

  openCreateForm: () => void
  openEditForm: (id: string) => void
  closeForm: () => void

  clearError: () => void
}

export const useConfigStore = create<ConfigStore>((set) => ({
  providers: [],
  loading: false,
  error: null,
  formMode: 'closed',
  editingProviderId: null,
  testStatus: {},

  fetchProviders: async () => {
    set({ loading: true, error: null })
    try {
      const providers = await talorAPI.providers.list()
      set({ providers, loading: false })
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  createProvider: async (input) => {
    set({ loading: true, error: null })
    try {
      const newProvider = await talorAPI.providers.create(input)
      set((state) => ({
        providers: [newProvider, ...state.providers],
        loading: false,
        formMode: 'closed',
        editingProviderId: null
      }))
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  updateProvider: async (id, updates) => {
    set({ loading: true, error: null })
    try {
      const updated = await talorAPI.providers.update(id, updates)
      set((state) => ({
        providers: state.providers.map((p) => (p.id === id ? updated : p)),
        loading: false,
        formMode: 'closed',
        editingProviderId: null
      }))
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  deleteProvider: async (id) => {
    set({ loading: true, error: null })
    try {
      await talorAPI.providers.delete(id)
      set((state) => ({
        providers: state.providers.filter((p) => p.id !== id),
        loading: false
      }))
    } catch (err) {
      set({ error: String(err), loading: false })
    }
  },

  setDefault: async (id) => {
    try {
      await talorAPI.providers.setDefault(id)
      set((state) => ({
        providers: state.providers.map((p) => ({
          ...p,
          is_default: p.id === id
        }))
      }))
    } catch (err) {
      set({ error: String(err) })
    }
  },

  testConnection: async (id, config) => {
    set((state) => ({
      testStatus: {
        ...state.testStatus,
        [id]: { status: 'testing' }
      }
    }))
    try {
      const result = await talorAPI.providers.testConnection(config)
      set((state) => ({
        testStatus: {
          ...state.testStatus,
          [id]: { status: result.status === 'success' ? 'success' : 'failure', result }
        }
      }))
    } catch (err) {
      set((state) => ({
        testStatus: {
          ...state.testStatus,
          [id]: {
            status: 'failure',
            result: {
              status: 'failure',
              latency_ms: undefined,
              models_count: undefined,
              error_code: 'UNKNOWN',
              message: String(err)
            }
          }
        }
      }))
    }
  },

  openCreateForm: () => set({ formMode: 'creating', editingProviderId: null }),
  openEditForm: (id) => set({ formMode: 'editing', editingProviderId: id }),
  closeForm: () => set({ formMode: 'closed', editingProviderId: null }),
  clearError: () => set({ error: null })
}))
