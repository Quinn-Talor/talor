import type { CoreMessage } from 'ai'
import type { Provider } from '../store/config-store'
import type { AgentManifest } from '@shared/types/agent'
import type { SkillRegistry } from '../skills/registry'

export interface PromptPlugin {
  name: string
  build(ctx: PipelineContext): Promise<PluginResult>
}

export interface PipelineContext {
  sessionId: string
  currentMessage: {
    text: string
    attachments?: Array<{
      name: string
      mediaType?: string
      base64?: string
      content?: string
    }>
  }
  provider: Provider
  providerConfig: ProviderContextConfig
  workspacePath: string | undefined
  agent?: AgentManifest
  skillRegistry?: SkillRegistry
}

export interface PluginResult {
  messages: CoreMessage[]
  tools: ToolSchema[]
  tokenEstimate: number
}

export interface ProviderContextConfig {
  provider: Provider
  context_limit: number
  recent_ratio: number
  summary_ratio: number
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
}
