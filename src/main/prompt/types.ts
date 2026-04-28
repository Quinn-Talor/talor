import type { CoreMessage } from 'ai'
import type { Provider } from '../store/config-store'
import type { Agent } from '../agent/agent'
import type { ToolMetadata } from '../tools/types'

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
  agent?: Agent
}

export interface PluginResult {
  messages: CoreMessage[]
  tools: ToolMetadata[]
  tokenEstimate: number
}

export interface ProviderContextConfig {
  provider: Provider
  context_limit: number
  recent_ratio: number
  summary_ratio: number
}

/** @deprecated Use ToolMetadata from tools/types instead */
export type ToolSchema = ToolMetadata
