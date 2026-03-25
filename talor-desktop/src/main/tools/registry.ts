import { v4 as uuidv4 } from 'uuid'
import type {
  ToolDefinition,
  ToolResult,
  ToolExecuteContext,
  MCPToolProvider,
  ToolMetadata,
} from './types'
export type {
  ToolDefinition,
  ToolResult,
  ToolExecuteContext,
  MCPToolProvider,
  ToolMetadata,
} from './types'
import {
  DEFAULT_MAX_READ_SIZE_BYTES,
  DEFAULT_MAX_WRITE_SIZE_BYTES,
  DEFAULT_MAX_PARALLEL_TOOLS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './types'

const tools = new Map<string, ToolDefinition>()
const externalProviders = new Map<string, MCPToolProvider>()

function applyContextDefaults(
  context: ToolExecuteContext,
): ToolExecuteContext {
  return {
    ...context,
    maxReadSizeBytes:
      context.maxReadSizeBytes ?? DEFAULT_MAX_READ_SIZE_BYTES,
    maxWriteSizeBytes:
      context.maxWriteSizeBytes ?? DEFAULT_MAX_WRITE_SIZE_BYTES,
    maxParallelTools: context.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS,
    toolTimeoutMs: context.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
  }
}

export const toolRegistry = {
  register(tool: ToolDefinition): void {
    if (!tool.name) {
      throw new Error('Tool must have a name')
    }
    if (!tool.description) {
      throw new Error('Tool must have a description')
    }
    if (typeof tool.execute !== 'function') {
      throw new Error('Tool must have an execute function')
    }
    if (tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    tools.set(tool.name, tool)
  },

  unregister(name: string): void {
    if (!tools.has(name)) {
      throw new Error(`Tool not found: ${name}`)
    }
    tools.delete(name)
  },

  getTool(name: string): ToolDefinition | undefined {
    return tools.get(name)
  },

  getToolFromExternal(
    name: string,
  ): { tool: ToolMetadata; provider: MCPToolProvider } | undefined {
    for (const provider of Array.from(externalProviders.values())) {
      const toolList = provider.listTools()
      const tool = toolList.find((t) => t.name === name)
      if (tool) {
        return { tool, provider }
      }
    }
    return undefined
  },

  listTools(): string[] {
    return Array.from(tools.keys())
  },

  getAllSchemas(): Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    schema?: Record<string, unknown>
  }> {
    return Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
    }))
  },

  clear(): void {
    tools.clear()
    externalProviders.clear()
  },

  registerExternalProvider(provider: MCPToolProvider): void {
    if (!provider.name) {
      throw new Error('Provider must have a name')
    }
    if (typeof provider.listTools !== 'function') {
      throw new Error('Provider must have a listTools function')
    }
    if (typeof provider.execute !== 'function') {
      throw new Error('Provider must have an execute function')
    }
    if (externalProviders.has(provider.name)) {
      throw new Error(`Provider already registered: ${provider.name}`)
    }
    externalProviders.set(provider.name, provider)
  },

  unregisterExternalProvider(name: string): void {
    if (!externalProviders.has(name)) {
      throw new Error(`Provider not found: ${name}`)
    }
    externalProviders.delete(name)
  },

  getExternalProvider(name: string): MCPToolProvider | undefined {
    return externalProviders.get(name)
  },

  listExternalProviders(): string[] {
    return Array.from(externalProviders.keys())
  },

  listAllTools(): Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    schema?: Record<string, unknown>
    provider?: string
  }> {
    const builtin = Array.from(tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      schema: tool.schema,
      provider: 'builtin' as const,
    }))
    const external: Array<{
      name: string
      description: string
      parameters: Record<string, unknown>
      schema?: Record<string, unknown>
      provider: string
    }> = []
    for (const [providerName, provider] of Array.from(externalProviders)) {
      for (const tool of provider.listTools()) {
        external.push({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          schema: tool.schema,
          provider: providerName,
        })
      }
    }
    return [...builtin, ...external]
  },

  async execute(
    toolName: string,
    input: unknown,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const tool = tools.get(toolName)
    const externalTool = tool
      ? undefined
      : this.getToolFromExternal(toolName)

    if (!tool && !externalTool) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    const toolCallId = uuidv4()
    const ctxWithDefaults = applyContextDefaults(context)
    const startTime = Date.now()

    try {
      let result: { output: unknown }
      if (tool) {
        result = await tool.execute(input, ctxWithDefaults)
      } else if (externalTool) {
        result = await externalTool.provider.execute(
          toolName,
          input,
          ctxWithDefaults,
        )
      } else {
        throw new Error('Invalid state: no tool or external tool found')
      }
      return {
        toolCallId,
        toolName,
        output: result.output,
        durationMs: Date.now() - startTime,
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err)
      return {
        toolCallId,
        toolName,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      }
    }
  },
}
