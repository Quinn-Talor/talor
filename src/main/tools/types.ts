/**
 * Tool Calling type definitions for talor-desktop.
 * Defines interfaces for tool definitions, results, execution logs, and configuration.
 */

export interface ValidationResult {
  ok: boolean
  error?: string
}

export interface VerifyResult {
  ok: boolean
  output: unknown
  warning?: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
  riskLevel?: 'HIGH' | 'LOW'
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

