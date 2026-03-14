export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'success' | 'error'
}

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
  messages: Message[]
  createdAt: number
  updatedAt: number
}
