import type { ToolResultBlock } from '../../shared/types/message'
import { MAX_TOOL_RESULT_BYTES } from '../../shared/types/message'

interface ToolResultLike {
  toolCallId: string
  toolName: string
  output: unknown
}

export function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_TOOL_RESULT_BYTES) return output
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_TOOL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[截断：原始输出 ${bytes} 字节]`
}

function extractOutputText(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object' && 'value' in output) {
    const v = (output as { value: unknown }).value
    return typeof v === 'string' ? v : JSON.stringify(v)
  }
  return String(output)
}

function isErrorOutput(output: unknown): boolean {
  if (typeof output === 'object' && output !== null && 'type' in output) {
    const t = (output as { type: unknown }).type
    return t === 'error-text' || t === 'error-json'
  }
  return false
}

export type ChatErrorCode =
  | 'LLM_CONNECTION_FAILED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'FILE_NOT_FOUND'
  | 'NETWORK_OFFLINE'
  | 'PROVIDER_NO_VISION'

export function classifyLlmError(error: unknown): ChatErrorCode {
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return 'LLM_TIMEOUT'
  }
  const msg = error instanceof Error ? error.message : String(error)
  if (msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) {
    return 'LLM_CONNECTION_FAILED'
  }
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
    return 'RATE_LIMITED'
  }
  if (msg.includes('401') || msg.includes('403') || msg.includes('API key')) {
    return 'AUTH_FAILED'
  }
  if (msg === 'FILE_TOO_LARGE') return 'FILE_TOO_LARGE'
  if (msg === 'UNSUPPORTED_FILE_TYPE') return 'UNSUPPORTED_FILE_TYPE'
  if (msg === 'FILE_NOT_FOUND') return 'FILE_NOT_FOUND'
  return 'LLM_ERROR'
}

const STREAM_TIMEOUT_MS = 120_000

export function buildStreamSignal(abortSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([abortSignal, AbortSignal.timeout(STREAM_TIMEOUT_MS)])
}

export function toolResultPartsToBlocks(parts: ToolResultLike[]): ToolResultBlock[] {
  return parts.map(tr => ({
    type: 'tool_result' as const,
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    output: truncateOutput(extractOutputText(tr.output)),
    isError: isErrorOutput(tr.output),
  }))
}
