export interface Agent {
  id: string
  name: string
  kind: 'platform' | 'worker'
  description?: string
  capabilities?: string[]
}

export interface Provider {
  id: string
  name: string
  type: 'ollama' | 'openai' | 'anthropic' | 'google'
  baseUrl?: string
  apiKey?: string
  models: string[]
  isConfigured: boolean
}

export interface Session {
  id: string
  title: string
  agentId: string | null
  createdAt: number
  updatedAt: number
}
