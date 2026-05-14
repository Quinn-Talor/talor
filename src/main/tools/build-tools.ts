// src/main/tools/build-tools.ts —— 业务层：工具装配 (v3.7.2 路径统一版)
//
// 将 pipeline 产出的 ToolMetadata 列表包装为 AI SDK dynamicTool。
// 不区分 builtin / MCP / skill —— 全部走 agent.toolRegistry.execute()。
//
// v3.7.2: HIGH static 工具 (bash/write/edit) 的 confirm 逻辑已迁入 RiskGate
// (路径 1 'high-static'),buildTools 不再嵌入 confirm 处理。所有路径统一在
// Gate 内决策 → buildTools 只看 action='pass'/'deny'。

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { ToolExecuteContext, ToolMetadata, PermissionPort } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { RiskGate } from './risk-gate'
import { sessionApprovalMemory } from './session-approval-memory'
import { sideEffectLedger } from '../repos/side-effect-ledger'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'

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

        // v3.7.2 路径统一:所有 confirm/拦截逻辑都在 RiskGate.gate() 内决策。
        //   - HIGH static (bash/write/edit) → via='high-static' (Gate 内 confirm)
        //   - LLM emit pending_confirm     → via='pendingBlock'
        //   - 代码 regex 兜底              → via='fallback'
        //   - memory pattern               → via='memory'
        //   - 无风险信号                   → via='auto-low' (直通)
        // Ledger 也在 Gate 内 record,buildTools 不重复写。
        let gateDecision: Awaited<ReturnType<RiskGate['gate']>>
        try {
          const fakeToolDef = {
            name: schema.name,
            description: schema.description,
            parameters: schema.parameters,
            riskLevel: schema.riskLevel ?? 'LOW',
            execute: async () => ({ output: null }),
          } as import('./types').ToolDefinition
          gateDecision = await riskGate.gate(fakeToolDef, input, execCtx, confirmTool)
        } catch (err) {
          // Gate 自身异常是 framework bug — 拒绝执行,返结构化错误信封
          log.error('[buildTools] RiskGate threw exception:', schema.name, err)
          return {
            __talor_error: true,
            code: 'RISK_GATE_ERROR',
            message: `Risk gate failed for ${schema.name}: ${err instanceof Error ? err.message : String(err)}`,
          }
        }

        if (gateDecision.action === 'deny') {
          return {
            __talor_error: true,
            code: 'USER_DENIED',
            message: `User denied the operation: ${gateDecision.summary ?? schema.name}`,
          }
        }

        // action === 'pass'
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
