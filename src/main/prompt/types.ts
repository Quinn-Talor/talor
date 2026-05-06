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
  /**
   * 累积可见策略（方案 C）状态。仅 ToolSelectionPlugin 消费。
   *
   * mcpExpandThisStep:
   *   仅在"刚调用过 search_tool"的下一步置 true，让模型一次性看到全部 MCP
   *   工具的 schema，能正确选择并构造调用。一步后回落到 false。
   *
   * usedMcpToolNames:
   *   累积已被实际调用过的 MCP 工具名。在 mcpExpandThisStep=false 的步骤里，
   *   ToolSelectionPlugin 只暴露这些已用过的工具，省 token；新工具需再调
   *   search_tool 触发一次扩展。
   */
  mcpExpandThisStep?: boolean
  usedMcpToolNames?: string[]
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
