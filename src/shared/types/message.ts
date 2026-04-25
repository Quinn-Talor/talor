export type ContentBlock =
  | TextBlock
  | ImageBlock
  | FileBlock
  | ToolUseBlock
  | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  image: string        // base64 data URL
  mimeType: string
}

export interface FileBlock {
  type: 'file'
  filename: string
  mimeType: string
  path: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  output: string       // truncated to MAX_TOOL_RESULT_BYTES
  isError: boolean
}

export const MAX_TOOL_RESULT_BYTES = 8 * 1024   // 8KB — keep context manageable for multi-step tasks
export const HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] as const
export type HighRiskTool = typeof HIGH_RISK_TOOLS[number]

export interface ToolConfirmRequest {
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string           // 'bash' | 'write' | 'edit'
  inputSummary: string       // UI display summary (≤ 500 chars)
  inputFull: unknown         // full input for actual execution
}

export type ToolConfirmDecision = 'approved' | 'rejected'

export interface ToolConfirmResponse {
  toolCallId: string
  decision: ToolConfirmDecision
}
