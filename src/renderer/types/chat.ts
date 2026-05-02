// Phase 2 types — source: FEATURE-talor-phase2.md §F.2, REQUIREMENTS.md §1.3

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface TextPart {
  type: 'text'
  content: string
}

export interface ImagePart {
  type: 'image'
  mime_type: string
  data: string
  filename?: string
}

export interface FilePart {
  type: 'file'
  mime_type: string
  filename: string
  size_bytes: number
  path: string
}

export type MessagePart = TextPart | ImagePart | FilePart

export interface ChatMessage {
  id: string
  session_id: string
  role: MessageRole
  content: string
  created_at: string
}

export interface ChatSession {
  id: string
  title: string
  provider_id: string
  model_id?: string
  workspace?: string
  agent_id?: string
  created_at: string
  updated_at: string
}

export interface ChatToolCallEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  input: Record<string, unknown>
}

export interface ChatToolResultEvent {
  session_id: string
  message_id: string
  tool_call_id: string
  tool_name: string
  result: unknown
}

export type StreamState = 'idle' | 'streaming' | 'done' | 'error' | 'aborted'

export interface Attachment {
  path: string
  mime_type: string
  filename: string
  size_bytes: number
}

export type ChatErrorCode =
  | 'LLM_CONNECTION_FAILED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'PROVIDER_NO_VISION'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_OFFLINE'

export interface ChatSendParams {
  session_id: string
  content: string
  attachments?: Attachment[]
}

export interface ChatSendResult {
  message_id: string
}

export interface ChatStreamEvent {
  session_id: string
  message_id: string
  delta: string
  done: boolean
  error_code?: ChatErrorCode
  error_message?: string
}

export interface SessionRenameParams {
  session_id: string
  title: string
}

export interface SessionRow {
  id: string
  title: string
  provider_id: string
  model_id: string | null
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string
  created_at: string
}

export function isTextPart(p: MessagePart): p is TextPart {
  return p.type === 'text'
}

export function isImagePart(p: MessagePart): p is ImagePart {
  return p.type === 'image'
}

export function isFilePart(p: MessagePart): p is FilePart {
  return p.type === 'file'
}

export function decodeMessageContent(content: string): MessagePart[] {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'string') return [{ type: 'text', content: parsed }]
    if (!Array.isArray(parsed)) return [{ type: 'text', content }]
    // Normalize ContentBlock format (.text) to legacy MessagePart format (.content)
    return parsed
      .map((b: Record<string, unknown>) => {
        if (b.type === 'text' && 'text' in b && !('content' in b)) {
          return { type: 'text', content: String(b.text ?? '') } as TextPart
        }
        if (b.type === 'image' && 'image' in b) {
          return {
            type: 'image',
            mime_type: String(b.mimeType ?? ''),
            data: String(b.image ?? ''),
            filename: b.filename as string | undefined,
          } as ImagePart
        }
        if (b.type === 'file' && 'filename' in b) {
          return {
            type: 'file',
            mime_type: String(b.mimeType ?? ''),
            filename: String(b.filename ?? ''),
            size_bytes: 0,
            path: String(b.path ?? ''),
          } as FilePart
        }
        // tool_use and tool_result blocks — skip for bubble rendering
        return null
      })
      .filter((p): p is MessagePart => p !== null)
  } catch {
    return [{ type: 'text', content }]
  }
}

export function encodeMessageContent(parts: MessagePart[]): string {
  return JSON.stringify(parts)
}

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
]

export const SUPPORTED_ATTACHMENT_TYPES = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES]
