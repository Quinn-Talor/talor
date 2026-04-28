// src/main/tools/build-tools.ts —— 业务层：工具装配
//
// 将 pipeline 产出的 ToolMetadata 列表包装为 AI SDK dynamicTool。
// 不区分 builtin / MCP / skill —— 全部走 agent.toolRegistry.execute()。

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { ToolExecuteContext, ToolMetadata } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') return String(obj.command ?? '').slice(0, MAX)
  if (toolName === 'write') {
    const lines = String(obj.content ?? '').split('\n').slice(0, 20).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '').split('\n').slice(0, 10).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n旧内容:\n${lines.join('\n')}`.slice(0, MAX)
  }
  return JSON.stringify(input).slice(0, MAX)
}

export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  confirmTool: ToolConfirmPort
  agent: import('../agent/agent').Agent
  toolSchemas?: ToolMetadata[]
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, confirmTool, agent } = opts

  const schemas = opts.toolSchemas ?? agent.toolRegistry.listTools()
  if (schemas.length === 0 && !workspace.trim()) return undefined

  const ctx: ToolExecuteContext = { sessionId, workspace }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {}

  for (const schema of schemas) {
    const isHighRisk = schema.riskLevel === 'HIGH'

    tools[schema.name] = dynamicTool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters),
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        if (isHighRisk) {
          const toolCallId = options?.toolCallId ?? uuidv4()
          const confirmed = await confirmTool({
            sessionId, messageId, toolCallId,
            toolName: schema.name,
            inputSummary: buildInputSummary(schema.name, input),
            inputFull: input,
          })
          if (!confirmed) return '用户拒绝执行'
        }
        try {
          const result = await agent.toolRegistry.execute(schema.name, input, ctx)
          return result.output ?? null
        } catch (err) {
          log.error('[buildTools] Tool execute exception:', schema.name, err)
          return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    })
  }

  log.info('[buildTools] tools:', Object.keys(tools).length,
    'agent:', agent.id, 'names:', Object.keys(tools).join(', '))
  return Object.keys(tools).length > 0 ? tools : undefined
}
