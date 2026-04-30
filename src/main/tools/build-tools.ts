// src/main/tools/build-tools.ts —— 业务层：工具装配
//
// 将 pipeline 产出的 ToolMetadata 列表包装为 AI SDK dynamicTool。
// 不区分 builtin / MCP / skill —— 全部走 agent.toolRegistry.execute()。

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { ToolExecuteContext, ToolMetadata, PermissionPort } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { diagnoseInputMismatch } from './input-diagnostics'

function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = (input ?? {}) as Record<string, unknown>
  if (toolName === 'bash')
    return String(obj.command ?? '')
      .trim()
      .slice(0, MAX)
  if (toolName === 'write') {
    const lines = String(obj.content ?? '')
      .split('\n')
      .slice(0, 20)
      .map((l) => l.slice(0, 80))
    return `File: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '')
      .split('\n')
      .slice(0, 10)
      .map((l) => l.slice(0, 80))
    return `File: ${obj.path}\nOld content:\n${lines.join('\n')}`.slice(0, MAX)
  }
  // MCP / 其它工具：JSON 摘要。空对象也返回可读提示，避免被外层 "!summary.trim()" 误判为无效输入。
  const json = JSON.stringify(input ?? {})
  return json === '{}' ? `Call ${toolName} (no arguments)` : json.slice(0, MAX)
}

export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  confirmTool: ToolConfirmPort
  /**
   * File 工具跨 workspace 访问时触发用户授权。入口层 (ipc/permission.ts)
   * 用 createPermissionPort() 注入。可选——不传则工具退化回"直接拒绝"。
   */
  requestPermission?: PermissionPort
  agent: import('../agent/agent').Agent
  toolSchemas?: ToolMetadata[]
  skillTracker?: import('../skills/registry').SkillActivationTracker
  /** ReAct loop 的 abortSignal,透传到工具(当前用于 bash 子进程终止)。 */
  abortSignal?: AbortSignal
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, confirmTool, agent } = opts

  const schemas = opts.toolSchemas ?? agent.toolRegistry.listTools()
  if (schemas.length === 0 && !workspace.trim()) return undefined

  const ctx: ToolExecuteContext = {
    sessionId,
    workspace,
    skillTracker: opts.skillTracker,
    requestPermission: opts.requestPermission,
    abortSignal: opts.abortSignal,
  }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {}

  for (const schema of schemas) {
    const isHighRisk = schema.riskLevel === 'HIGH'

    tools[schema.name] = dynamicTool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters),
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        if (isHighRisk) {
          const summary = buildInputSummary(schema.name, input)
          if (!summary.trim()) {
            const params = schema.parameters as {
              required?: string[]
              properties?: Record<string, { type?: string; description?: string }>
            }
            const inputObj =
              input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
            const missing = (params.required ?? []).filter(
              (f) => inputObj[f] === undefined || inputObj[f] === null,
            )
            if (missing.length > 0) {
              return diagnoseInputMismatch(schema.name, params, input, missing)
            }
            return `Invalid input for tool "${schema.name}": could not build a summary from the provided input. Provided fields: [${Object.keys(inputObj).join(', ') || 'none'}].`
          }
          const toolCallId = options?.toolCallId ?? uuidv4()
          let confirmed: boolean
          try {
            const confirmPromise = confirmTool({
              sessionId,
              messageId,
              toolCallId,
              toolName: schema.name,
              inputSummary: summary,
              inputFull: input,
            })
            if (opts.abortSignal) {
              const abortPromise = new Promise<false>((_, reject) => {
                if (opts.abortSignal!.aborted) {
                  reject(new DOMException('Aborted', 'AbortError'))
                  return
                }
                opts.abortSignal!.addEventListener(
                  'abort',
                  () => reject(new DOMException('Aborted', 'AbortError')),
                  { once: true },
                )
              })
              confirmed = await Promise.race([confirmPromise, abortPromise])
            } else {
              confirmed = await confirmPromise
            }
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              return 'Tool call aborted by user.'
            }
            log.warn('[buildTools] confirmTool failed, treating as rejected:', schema.name, err)
            return 'Tool confirmation failed. The tool call was not executed.'
          }
          if (!confirmed) return 'User rejected the tool call.'
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

  log.info(
    '[buildTools] tools:',
    Object.keys(tools).length,
    'agent:',
    agent.id,
    'names:',
    Object.keys(tools).join(', '),
  )
  return Object.keys(tools).length > 0 ? tools : undefined
}
