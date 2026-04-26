// src/main/tools/build-tools.ts
import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { BrowserWindow } from 'electron'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'
import { requestToolConfirm, buildInputSummary } from '../ipc/tool-confirm'

const MCP_WAIT_MS = 2000
const BUILTIN_TOOL_THRESHOLD = 7

export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  mainWindow: BrowserWindow
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, mainWindow } = opts
  const hasWorkspace = workspace.trim() !== ''

  // MCP 连接兜底：工具数 <= 7 说明 MCP 尚未就绪
  if (toolRegistry.listAllTools().length <= BUILTIN_TOOL_THRESHOLD) {
    log.warn('[buildTools] Only builtin tools found, waiting for MCP...')
    await new Promise(resolve => setTimeout(resolve, MCP_WAIT_MS))
  }

  const finalSchemas = toolRegistry.listAllTools().filter(schema => {
    const isBuiltin = !schema.provider || schema.provider === 'builtin'
    if (isBuiltin && !hasWorkspace) return false
    return true
  })

  if (finalSchemas.length === 0) return undefined

  const tools = finalSchemas.reduce((acc, schema) => {
    const builtinTool = toolRegistry.getTool(schema.name)
    const hasExternalTool = !builtinTool && !!toolRegistry.getToolFromExternal(schema.name)

    if (!builtinTool && !hasExternalTool) {
      log.warn('[buildTools] Tool not found, skipping:', schema.name)
      return acc
    }

    const ctx: ToolExecuteContext = { sessionId, workspace }

    acc[schema.name] = dynamicTool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters),
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        const toolDef = toolRegistry.getTool(schema.name)
        const isHighRisk = toolDef?.riskLevel === 'HIGH'

        if (isHighRisk) {
          const toolCallId = options?.toolCallId ?? uuidv4()
          log.info('[buildTools] Requesting tool confirm for:', schema.name, toolCallId)
          const confirmed = await requestToolConfirm(mainWindow, {
            sessionId,
            messageId,
            toolCallId,
            toolName: schema.name,
            inputSummary: buildInputSummary(schema.name, input),
            inputFull: input,
          })
          if (!confirmed) {
            log.info('[buildTools] Tool execution rejected:', schema.name)
            return '用户拒绝执行'
          }
        }

        try {
          const result = await toolRegistry.execute(schema.name, input, ctx)
          if (result.error) {
            log.error('[buildTools] Tool error:', result.toolName, result.error)
          }
          return result.output ?? null
        } catch (err) {
          log.error('[buildTools] Tool execute exception:', schema.name, err)
          return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    })
    return acc
  }, {} as Record<string, ReturnType<typeof dynamicTool>>)

  log.info('[buildTools] Tools ready, workspace:', workspace, 'count:', Object.keys(tools).length,
    'tools:', Object.keys(tools).join(', '))
  return Object.keys(tools).length > 0 ? tools : undefined
}
