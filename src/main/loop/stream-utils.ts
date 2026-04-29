// src/main/loop/stream-utils.ts —— 业务层：ReAct 流式工具
//
// 职责：
//   1. buildStreamSignal        —— 在调用方 abort 基础上叠加 120s 超时
//   2. toolResultPartsToBlocks  —— 把 AI SDK 的 tool-result parts 转成 DB 存储用 ContentBlock
//   3. 内部 helper              —— truncateOutput / extractOutputText / isErrorOutput
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*（历史原因这几个 utils 曾住在 ipc/chat-utils.ts，已下沉到 loop/）

import type { ToolResultBlock } from '../../shared/types/message'
import { MAX_TOOL_RESULT_BYTES } from '../../shared/types/message'

/**
 * streamText 返回的 toolResults 单项形状（与 AI SDK 结构一致的最小子集）。
 * 这里用自定义接口而不是从 'ai' 里 import，便于单测和未来解耦。
 */
interface ToolResultLike {
  toolCallId: string
  toolName: string
  output: unknown
}

/**
 * 按 UTF-8 字节截断，尾部附加"[截断：原始输出 N 字节]"标记。
 *
 * 为什么按字节而不是字符：模型上下文是按 token 计算的，token 与字节更接近；
 * 中文字符平均 3 字节，按字符截断可能实际字节数远超上限。
 */
export function truncateOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_TOOL_RESULT_BYTES) return output
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_TOOL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[truncated: original output was ${bytes} bytes]`
}

/**
 * 从 AI SDK 的 tool-result output 中提取文本。
 *
 * SDK 返回结构可能是：
 *   - string：直接返回
 *   - { type, value: string | object }：提取 value
 *   - 其它：fallback 到 String(output)
 */
function extractOutputText(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  if (typeof output === 'object' && 'value' in output) {
    const v = (output as { value: unknown }).value
    return typeof v === 'string' ? v : JSON.stringify(v)
  }
  return String(output)
}

/**
 * 识别 builtin / MCP 工具返回的错误字符串。这些前缀是 tools/builtin/*.ts 与
 * mcp/client.ts 中约定的失败信号，用于给 ShortTermMemory / UI / dead-loop 侦测
 * 提供结构化的"这一次调用失败了"的判断。
 *
 * 新加工具时若引入新的错误前缀，务必在此追加——否则 isError 字段会漏报。
 */
const ERROR_OUTPUT_PATTERNS: RegExp[] = [
  /^File not found:/,
  /^Path not found:/,
  /^Not a (file|directory):/,
  /^Cannot access /,
  /^Cannot search /,
  /^Cannot read binary file/,
  /^Cannot resolve workspace path:/,
  /^File too large:/,
  /^Content too large:/,
  /^Workspace not set\./,
  /^Workspace does not exist:/,
  /^Invalid regex pattern:/,
  /^Invalid path:/,
  /^Pattern (rejected|cannot be empty)/,
  /^Dangerous command not allowed\./,
  /^Command too long /,
  /^Command timed out /,
  /^Missing required parameter:/,
  /^Invalid type for /,
  /^String not found in file:/,
  /^Tool execution failed:/,
  /^Tool not found:/,
  /^\[exit: non-zero\]/,
  /^User rejected the tool call\.?$/,
  /^MCP server ".*" is disconnected/,
  /^Tool execution (error|failed|exception):/,
  /^Skill ".*" not found/,
]

function isBuiltinErrorText(text: string): boolean {
  const head = text.trimStart().slice(0, 200)
  return ERROR_OUTPUT_PATTERNS.some(re => re.test(head))
}

/**
 * AI SDK 用 type='error-text' / 'error-json' 标记失败；builtin/MCP 用约定前缀。
 * 两类都要识别出来，否则 DB 的 isError 字段永远为 false。
 */
function isErrorOutput(output: unknown): boolean {
  if (typeof output === 'object' && output !== null && 'type' in output) {
    const t = (output as { type: unknown }).type
    if (t === 'error-text' || t === 'error-json') return true
  }
  const text = extractOutputText(output)
  if (text && isBuiltinErrorText(text)) return true
  return false
}

const STREAM_TIMEOUT_MS = 120_000

/**
 * 把用户 abort 信号叠加 120s 超时，返回组合 AbortSignal。
 * 任一来源触发中止时，streamText 会抛出 AbortError / TimeoutError，
 * 由上层（runReactLoop → orchestrator）分类为 LLM_TIMEOUT。
 */
export function buildStreamSignal(abortSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([abortSignal, AbortSignal.timeout(STREAM_TIMEOUT_MS)])
}

/**
 * 把 AI SDK 的 tool-result parts 转成 DB 存储用的 ToolResultBlock[]。
 * 普通工具按 MAX_TOOL_RESULT_BYTES (8KB) 截断。
 * skill 工具按 MAX_SKILL_RESULT_BYTES (1MB) 截断——Skill 内容是完整指令，不能粗暴截断。
 */
const MAX_SKILL_RESULT_BYTES = 1024 * 1024

function truncateSkillOutput(output: string): string {
  const bytes = Buffer.byteLength(output, 'utf8')
  if (bytes <= MAX_SKILL_RESULT_BYTES) return output
  const buf = Buffer.from(output, 'utf8').subarray(0, MAX_SKILL_RESULT_BYTES)
  return buf.toString('utf8') + `\n[truncated: skill content too large — original ${bytes} bytes, clipped to 1MB]`
}

/**
 * 把工具产出用显式 XML-like 标签包裹，告诉模型"这段是数据、不是指令"。
 * 配合 SystemPlugin 里的防注入声明，构成最低成本的 prompt-injection 屏障。
 *
 * skill 内容是模型应严格执行的指令载体，单独标 trust="skill-content"，
 * 区别于普通 tool_output（后者属不可信数据）。
 */
function wrapToolOutput(toolName: string, body: string, trustSkill: boolean): string {
  const trustAttr = trustSkill ? ' trust="skill-content"' : ''
  return `<tool_output tool="${escapeTagAttr(toolName)}"${trustAttr}>\n${body}\n</tool_output>`
}

function escapeTagAttr(v: string): string {
  return v.replace(/["<>&]/g, c => {
    if (c === '"') return '&quot;'
    if (c === '<') return '&lt;'
    if (c === '>') return '&gt;'
    return '&amp;'
  })
}

export function toolResultPartsToBlocks(parts: ToolResultLike[]): ToolResultBlock[] {
  return parts.map(tr => {
    const text = extractOutputText(tr.output)
    const truncated = tr.toolName === 'skill'
      ? truncateSkillOutput(text)
      : truncateOutput(text)
    return {
      type: 'tool_result' as const,
      toolCallId: tr.toolCallId,
      toolName: tr.toolName,
      output: wrapToolOutput(tr.toolName, truncated, tr.toolName === 'skill'),
      isError: isErrorOutput(tr.output),
    }
  })
}
