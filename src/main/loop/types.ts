// src/main/loop/types.ts
import type { LanguageModel } from 'ai'
import type { dynamicTool } from 'ai'
import type { PromptPipeline } from '../prompt/PromptPipeline'
import type { Provider } from '../store/config-store'
import type { ProviderContextConfig } from '../prompt/types'

export interface ReactLoopCallbacks {
  onTextDelta: (delta: string) => void
  onToolCall: (toolCallId: string, toolName: string, input: unknown) => void
  onToolResult: (toolCallId: string, toolName: string, output: unknown) => void
}

export interface ReactLoopOptions {
  model: LanguageModel
  tools: Record<string, ReturnType<typeof dynamicTool>> | undefined
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
  skillRegistry?: import('../skills/registry').SkillRegistry
}
