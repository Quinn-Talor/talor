/**
 * Tool Calling type definitions for talor-desktop.
 * Defines interfaces for tool definitions, results, execution logs, and configuration.
 */

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  schema?: Record<string, unknown>
  riskLevel?: 'HIGH' | 'LOW'
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
}

export interface MCPToolProvider {
  name: string
  version?: string
  listTools(): ToolMetadata[]
  execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<{ output: unknown }>
}
