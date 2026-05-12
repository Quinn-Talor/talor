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
import { RiskGate } from './risk-gate'
import { sessionApprovalMemory } from './session-approval-memory'
import { sideEffectLedger } from '../repos/side-effect-ledger'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'

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
  /**
   * v3.6: 本 step 的 talor blocks (含 pending_confirm), 供 RiskGate 主路径。
   * 静态形式 — 用于测试或 react-loop 已完成解析的场景。
   * 流式场景应优先用 getCurrentStepBlocks getter。
   */
  currentStepBlocks?: TalorBlock[]
  /**
   * v3.6 流式 getter: tool execute 时实时取最新解析的 talor blocks。
   * react-loop 在 streamText onChunk 累积 stepText 后, 用此 getter
   * 在每次 tool 调用前 parseTalorBlocks(stepText) 取 pending_confirm。
   *
   * 优先级 > currentStepBlocks (静态)。两者都缺失时, RiskGate 仅靠 fallback regex。
   */
  getCurrentStepBlocks?: () => TalorBlock[]
  /** v3.6: 注入 RiskGate (测试可覆盖); 默认 new RiskGate(memory, ledger) */
  riskGate?: RiskGate
  /**
   * v3.6 Ledger: 透传给 ctx.stepIndex,Gate 内部 record 用。
   * react-loop 在每步 buildTools 时传当前 step,兜底 0。
   */
  stepIndex?: number
  /**
   * v3.6 Ledger: 父 session id (subagent 场景)。null 表示当前是 root。
   */
  parentSessionIdForLedger?: string | null
}): Promise<Record<string, ReturnType<typeof dynamicTool>> | undefined> {
  const { sessionId, messageId, workspace, confirmTool, agent } = opts

  const schemas = opts.toolSchemas ?? agent.toolRegistry.listTools()
  if (schemas.length === 0 && !workspace.trim()) return undefined

  const riskGate = opts.riskGate ?? new RiskGate(sessionApprovalMemory, sideEffectLedger)

  const ctx: ToolExecuteContext = {
    sessionId,
    workspace,
    skillTracker: opts.skillTracker,
    requestPermission: opts.requestPermission,
    abortSignal: opts.abortSignal,
    parentMessageId: messageId,
    confirmTool,
    currentStepBlocks: opts.currentStepBlocks,
    parentMessageIdForLedger: messageId,
    rootSessionId: opts.parentSessionIdForLedger ?? null,
    stepIndex: opts.stepIndex ?? 0,
  }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {}

  for (const schema of schemas) {
    const isHighRisk = schema.riskLevel === 'HIGH'

    tools[schema.name] = dynamicTool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters),
      execute: async (input: unknown, options: { toolCallId?: string }) => {
        const toolCallIdForGate = options?.toolCallId ?? uuidv4()
        // 流式 getter 优先 — 取最新解析的 blocks; 静态 fallback 给测试 & 旧调用方
        const liveBlocks = opts.getCurrentStepBlocks?.() ?? opts.currentStepBlocks
        const execCtx: ToolExecuteContext = {
          ...ctx,
          toolCallId: toolCallIdForGate,
          currentStepBlocks: liveBlocks,
        }

        // v3.6 L3 RiskGate: 先评估
        // 静态 HIGH (bash/write/edit) → pass-to-legacy, 走下方原有 confirm 流程
        // pending_confirm block / 兜底 regex → Gate 内弹 confirm 并返结果
        // 无风险信号 → 直接通过
        let gateDecision: Awaited<ReturnType<RiskGate['gate']>> | null = null
        try {
          // 包一个 fake ToolDefinition 给 gate (它只读 name + riskLevel)
          const fakeToolDef = {
            name: schema.name,
            description: schema.description,
            parameters: schema.parameters,
            riskLevel: schema.riskLevel ?? 'LOW',
            execute: async () => ({ output: null }),
          } as import('./types').ToolDefinition
          gateDecision = await riskGate.gate(fakeToolDef, input, execCtx, confirmTool)
        } catch (err) {
          log.error('[buildTools] RiskGate failed, falling back to legacy:', err)
          gateDecision = { action: 'pass-to-legacy', via: 'legacy' }
        }

        if (gateDecision.action === 'deny') {
          return {
            __talor_error: true,
            code: 'USER_DENIED',
            message: `User denied the operation: ${gateDecision.summary ?? schema.name}`,
          }
        }
        if (
          gateDecision.action === 'pass' &&
          (gateDecision.via === 'pendingBlock' ||
            gateDecision.via === 'fallback' ||
            gateDecision.via === 'memory')
        ) {
          // Gate 已在内部 record ledger (匹配方案 §5.2 双注入),此处直接执行工具
          try {
            const result = await agent.toolRegistry.execute(schema.name, input, execCtx)
            return result.output ?? null
          } catch (err) {
            log.error('[buildTools] Tool execute exception:', schema.name, err)
            return `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`
          }
        }
        // 落到这里说明 gateDecision.action === 'pass-to-legacy' 或 'pass' (auto-low)
        // 继续走原 high-risk 流程 (仅对 isHighRisk 触发)

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
            // v3.6: confirmTool 返回 boolean (legacy) 或 { approved, remember } (RiskGate 路径)
            // bash/write/edit legacy 路径不关心 remember,只取 approved
            const normalize = (r: boolean | { approved: boolean; remember?: boolean }): boolean =>
              typeof r === 'boolean' ? r : r.approved
            if (opts.abortSignal) {
              const abortPromise = new Promise<never>((_, reject) => {
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
              confirmed = normalize(await Promise.race([confirmPromise, abortPromise]))
            } else {
              confirmed = normalize(await confirmPromise)
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
          const result = await agent.toolRegistry.execute(schema.name, input, execCtx)
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
