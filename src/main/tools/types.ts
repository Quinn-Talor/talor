/**
 * Tool Calling type definitions for talor-desktop.
 * Defines interfaces for tool definitions, results, execution logs, and configuration.
 */

import type { z } from 'zod'

export interface ValidationResult {
  ok: boolean
  error?: string
}

/**
 * 结构化错误信封。所有工具产出错误时优先使用,替代"错误前缀字符串"的脆弱约定。
 *
 * 消费者:
 *   - stream-utils.isErrorOutput 优先通过 __talor_error 标志位判错,
 *     不再依赖 ERROR_OUTPUT_PATTERNS 正则命中 → 新错误前缀不会被漏识别
 *   - extractOutputText 把信封展开成 "[CODE] message\n(hint: ...)" 给 LLM 看
 *   - 死循环检测 / 兜底摘要据此可靠地判断"这步是否失败"
 *
 * code 约定(首字母大写下划线分隔):
 *   - 'MCP_ERROR' / 'MCP_TIMEOUT' / 'MCP_DISCONNECTED'
 *   - 'SCHEMA_INVALID' / 'VERIFY_BLOCKED' / 'VERIFY_CRASH'
 *   - 'BASH_STDERR_FAILURE' / 'EDIT_AMBIGUOUS_MATCH' 等工具特定错误
 */
export interface ToolErrorEnvelope {
  __talor_error: true
  code: string
  message: string
  hint?: string
}

export function isToolErrorEnvelope(value: unknown): value is ToolErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__talor_error' in value &&
    (value as { __talor_error: unknown }).__talor_error === true
  )
}

export interface VerifyResult {
  ok: boolean
  output: unknown
  warning?: string
  /**
   * block: verify 判定输出不合格 → registry 将其转换为 VERIFY_BLOCKED 信封,
   *   **不回退**原始 rawOutput(防止幻觉检测被静默绕过)。
   * warning(默认): 只记日志,照常透传 verify 产出的 output。
   */
  severity?: 'warning' | 'block'
}

/**
 * 工具定义。
 *
 * 参数校验两条路径(由 registry 自动选择,工具只需声明其一):
 *
 *   ① Zod 路径(推荐,内置工具统一用):设置 `zodSchema`,registry 用
 *      z.safeParse 做结构+类型+refine 级联校验,失败直接返回格式化诊断,
 *      成功时 `input` 在进入 `execute` 前已经是 z.infer<zodSchema> 的干净对象
 *      (包含 trim/default 等变换)。`parameters` 仍需提供一份 JSON Schema
 *      (由 zodSchema 通过 z.toJSONSchema 生成),因为 AI SDK 的 dynamicTool
 *      和 LLM 的 tools 字段都按 JSON Schema 协议工作。
 *
 *   ② 手写路径(MCP 工具走此路径):不设 `zodSchema`,registry 用 `parameters`
 *      做轻量 JSON Schema 子集校验(type/enum/pattern/min/max/length)。
 *      MCP 工具的 schema 来自远端服务器,无法 Zod 化。
 *
 * `validate` 保留给特殊业务规则(需要 context 的动态校验,如 bash 的 write
 * redirect 必须引用 context.workspace)。Zod refine 能表达的规则一律放进
 * zodSchema。
 */
export interface ToolDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
  riskLevel?: 'HIGH' | 'LOW'
  /** Zod schema。提供则 registry 用 Zod 校验,跳过 schema-check。 */
  zodSchema?: TSchema
  validate?: (input: unknown, context: ToolExecuteContext) => ValidationResult
  verify?: (output: unknown, input: unknown, context: ToolExecuteContext) => VerifyResult | Promise<VerifyResult>
  execute: (input: unknown, context: ToolExecuteContext) => Promise<{ output: unknown }>
}

export interface ToolResult {
  toolCallId: string
  toolName: string
  output?: unknown
  error?: string
  durationMs?: number
}

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'timeout'

export interface ToolCallLog {
  id: string
  sessionId: string
  toolCallId: string
  toolName: string
  input: unknown
  status: ToolCallStatus
  startTime: string
  endTime: string
  parallelGroup?: string
  error?: string
}

export interface ToolConfig {
  workspace: string
  maxReadSizeBytes?: number
  maxWriteSizeBytes?: number
  maxParallelTools?: number
  toolTimeoutMs?: number
}

export interface ToolExecuteContext extends ToolConfig {
  sessionId: string
  tmpDir?: string
  /** Per-session skill activation tracker — injected by build-tools, used by skill-tool. */
  skillTracker?: import('../skills/registry').SkillActivationTracker
  /**
   * Permission port — injected by build-tools. File tools call this when
   * resolveToolPath returns `needs_consent`; bash calls it for workspace-
   * external commands. Returns true if the user (or an existing rule)
   * allows the call. See src/main/permissions for details.
   *
   * Absent means "no consent flow available" — tools must fall back to
   * denying the call (current behavior before the dialog wiring lands).
   */
  requestPermission?: PermissionPort
  /**
   * Abort signal propagated from the ReAct loop / orchestrator. When the user
   * hits "stop" or a new chat request supersedes this one, tools receive the
   * signal here. Currently honored by bash (kills the child process) — other
   * tools may opt in as needed.
   */
  abortSignal?: AbortSignal
}

export type PermissionPort = (req: PermissionRequestInput) => Promise<boolean>

/**
 * What a tool tells the PermissionPort about the attempted call. The port
 * consumes this internally (rule matching + UI prompt) and returns a bool.
 */
export interface PermissionRequestInput {
  toolName: string
  reason: 'path_outside_workspace' | 'high_risk_tool'
  /** For path tools: resolved absolute path. */
  absPath?: string
  /** For bash: the command string. */
  bashCommand?: string
  /** Short user-facing summary for the dialog body (~ first 500 chars). */
  inputSummary: string
}

export const DEFAULT_MAX_READ_SIZE_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_WRITE_SIZE_BYTES = 10 * 1024 * 1024
export const DEFAULT_MAX_PARALLEL_TOOLS = 5
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000

export interface ToolMetadata {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
  riskLevel?: 'HIGH' | 'LOW'
  provider?: string
}

