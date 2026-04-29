import type { CoreMessage } from 'ai'
import type { Provider } from '../store/config-store'
import type { Agent } from '../agent/agent'
import type { ToolMetadata } from '../tools/types'
import type { SkillActivationTracker } from '../skills/registry'
import type { ExecutionEventBus } from '../chat/events'

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
  /** Per-session skill activation tracker — present when a skill-capable agent is active. */
  skillTracker?: SkillActivationTracker
  /** Per-execution event bus for state-change notifications (e.g., memory.compressed). */
  events?: ExecutionEventBus
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
