export type ContentBlock = TextBlock | ImageBlock | FileBlock | ToolUseBlock | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  image: string // base64 data URL
  mimeType: string
}

export interface FileBlock {
  type: 'file'
  filename: string
  mimeType: string
  path: string
  /** 文本类文档（text/*、json、csv、md）预读的 UTF-8 内容，供 prompt 直接消费。 */
  textContent?: string
  /** PDF 等二进制文档的 base64（不含 data URL 前缀），供 file-capable provider 消费。 */
  base64Data?: string
  /** 原始文件字节数，用于告知模型内容是否被截断。 */
  sizeBytes?: number
}

/** 文本附件就地注入 prompt 的字节上限（超过会截断并标注）。 */
export const MAX_INLINE_ATTACHMENT_BYTES = 128 * 1024

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
  output: string // truncated to MAX_TOOL_RESULT_BYTES
  isError: boolean
}

export const MAX_TOOL_RESULT_BYTES = 8 * 1024 // 8KB — keep context manageable for multi-step tasks
export const HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] as const
export type HighRiskTool = (typeof HIGH_RISK_TOOLS)[number]

export interface ToolConfirmRequest {
  sessionId: string
  messageId?: string // 已有 builtin 路径必填; RiskGate 新路径可省
  toolCallId: string
  toolName: string // 'bash' | 'write' | 'edit' | mcp tool name
  inputSummary?: string // 已有路径用 (legacy)
  inputFull?: unknown // 已有路径用 (legacy)

  /** v3.6 RiskGate 新增字段 — LLM 通过 pending_confirm block 提供的语义信息 */
  summary?: string // 一句话操作描述(来自 pending_confirm.summary)
  preview?: string // 详细预览(SQL 文本等)
  allowRemember?: boolean // 是否允许"Remember for session" checkbox
  patternKey?: string // approval memory key (仅 allowRemember=true 时有意义)
  riskLevel?: 'high' | 'destructive' // 默认 'high'; destructive 不允许 remember
}

export type ToolConfirmDecision = 'approved' | 'rejected'

export interface ToolConfirmResponse {
  toolCallId: string
  decision: ToolConfirmDecision
  /** v3.6: 用户勾选了"Remember for session" (仅 allowRemember=true 时有意义) */
  remember?: boolean
}
