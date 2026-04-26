// src/main/tools/build-tools.ts —— 业务层：工具装配（MCP 等待 / dynamicTool 包装 / 高风险确认）
//
// 允许依赖：tools/*、ipc/tool-confirm 的"类型"（不是实现）、shared/*
// 禁止依赖：任何 ipc/* 的运行时代码

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'   // 仅类型 import，tsc 会擦除，不产生运行时依赖

/** MCP 启动等待窗口：registry 工具数少于阈值时，等 2 秒让 MCP server 完成 tools 注册。 */
const MCP_WAIT_MS = 2000

/**
 * 内建工具数量阈值。
 * 当前内建有 7 个（read / write / edit / bash / glob / grep / ls）。
 * registry 总数 ≤ 7 意味着 MCP server 还没来得及注册 external tools，先等一会儿再装配。
 */
const BUILTIN_TOOL_THRESHOLD = 7

/**
 * 给高风险工具构造用户可读的"输入摘要"供 UI 确认弹窗展示。
 * 纯格式化，长度上限 500，不抛错。
 */
function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') {
    return String(obj.command ?? '').slice(0, MAX)
  }
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

/**
 * 装配一次 chat 请求可用的工具集合，供 streamText 消费。
 *
 * 关键策略：
 *  - **MCP 等待兜底**：registry 工具数 ≤ 7 时说明 MCP 尚未连接完成，等 2s 再读一次。
 *  - **workspace 过滤**：无 workspace 时不暴露内建文件工具（read/write/edit/bash/glob/grep/ls），
 *    避免模型访问进程工作目录导致的安全问题。
 *  - **高风险工具确认**：`riskLevel === 'HIGH'` 的工具在 execute 前通过 `confirmTool` 端口
 *    请求用户确认；拒绝时返回字符串 "用户拒绝执行" 而非抛错（不破坏 ReAct 循环，让模型继续推理）。
 *  - **错误包装**：toolRegistry.execute 内部若抛错，在此转为字符串返回，避免让 streamText
 *    捕获异常中断整个流。
 *
 * 返回 `undefined` 表示无可用工具（下游 streamText 的 tools 参数为 undefined 时即纯对话模式）。
 */
export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  confirmTool: ToolConfirmPort
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, confirmTool } = opts
  const hasWorkspace = workspace.trim() !== ''

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
          // 高风险工具（bash/write/edit）：先让用户确认
          const toolCallId = options?.toolCallId ?? uuidv4()
          log.info('[buildTools] Requesting tool confirm for:', schema.name, toolCallId)
          const confirmed = await confirmTool({
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
          // 转字符串返回而不是抛错：保护 ReAct 流不被单个工具异常打断
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
