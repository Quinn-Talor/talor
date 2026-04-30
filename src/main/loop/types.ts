// src/main/loop/types.ts
import type { LanguageModel } from 'ai'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'
import type { SkillActivationTracker } from '../skills/registry'
import type { ExecutionEventBus } from '../chat/events'

export interface ReactLoopCallbacks {
  onTextDelta: (delta: string) => void
  onToolCall: (toolCallId: string, toolName: string, input: unknown) => void
  onToolResult: (toolCallId: string, toolName: string, output: unknown) => void
}

export interface ReactLoopOptions {
  model: LanguageModel
  sessionId: string
  messageId: string
  userContent: string
  mappedAttachments: Array<{ name: string; mediaType: string; base64?: string; content?: undefined }>
  abortSignal: AbortSignal
  pipeline: PromptPipeline
  provider: Provider
  providerConfig: ProviderContextConfig
  workspace: string
  callbacks: ReactLoopCallbacks
  maxSteps?: number
  agent: import('../agent/agent').Agent
  confirmTool: import('../ipc/tool-confirm').ToolConfirmPort
  /** Workspace-external access consent (PR #4). Optional for backward compat. */
  requestPermission?: import('../tools/types').PermissionPort
  /** Per-session skill activation tracker shared between skill-tool and AgentPromptPlugin. */
  skillTracker: SkillActivationTracker
  /** Per-execution event bus for internal state-change notifications. */
  events: ExecutionEventBus
}
