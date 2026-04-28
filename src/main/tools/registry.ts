// src/main/tools/registry.ts — 内置工具注册中心
//
// 仅管理内置工具（read/write/edit/ls/glob/grep/bash）。
// MCP 工具由 McpRegistry 管理，不在此注册。
// Agent 的 ToolRegistry（agent/tool-registry.ts）组合本模块 + McpRegistry → 白名单过滤。

import { v4 as uuidv4 } from 'uuid'
import type {
  ToolDefinition,
  ToolResult,
  ToolExecuteContext,
  ToolMetadata,
} from './types'
export type {
  ToolDefinition,
  ToolResult,
  ToolExecuteContext,
  ToolMetadata,
} from './types'
import {
  DEFAULT_MAX_READ_SIZE_BYTES,
  DEFAULT_MAX_WRITE_SIZE_BYTES,
  DEFAULT_MAX_PARALLEL_TOOLS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './types'

const tools = new Map<string, ToolDefinition>()

function applyContextDefaults(context: ToolExecuteContext): ToolExecuteContext {
  return {
    ...context,
    maxReadSizeBytes: context.maxReadSizeBytes ?? DEFAULT_MAX_READ_SIZE_BYTES,
    maxWriteSizeBytes: context.maxWriteSizeBytes ?? DEFAULT_MAX_WRITE_SIZE_BYTES,
    maxParallelTools: context.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS,
    toolTimeoutMs: context.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
  }
}

export const toolRegistry = {
  register(tool: ToolDefinition): void {
    if (!tool.name) throw new Error('Tool must have a name')
    if (!tool.description) throw new Error('Tool must have a description')
    if (typeof tool.execute !== 'function') throw new Error('Tool must have an execute function')
    if (tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`)
    tools.set(tool.name, tool)
  },

  unregister(name: string): void {
    if (!tools.has(name)) throw new Error(`Tool not found: ${name}`)
    tools.delete(name)
  },

  getTool(name: string): ToolDefinition | undefined {
    return tools.get(name)
  },

  listTools(): string[] {
    return Array.from(tools.keys())
  },

  listAll(): ToolDefinition[] {
    return Array.from(tools.values())
  },

  getAllSchemas(): ToolMetadata[] {
    return Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
    }))
  },

  get size(): number {
    return tools.size
  },

  clear(): void {
    tools.clear()
  },

  async execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const tool = tools.get(toolName)
    if (!tool) throw new Error(`Tool not found: ${toolName}`)

    const toolCallId = uuidv4()
    const ctxWithDefaults = applyContextDefaults(context)
    const startTime = Date.now()

    try {
      const result = await tool.execute(input, ctxWithDefaults)
      return {
        toolCallId,
        toolName,
        output: result.output,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      return {
        toolCallId,
        toolName,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      }
    }
  },
}
