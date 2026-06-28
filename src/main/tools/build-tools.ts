// src/main/tools/build-tools.ts —— 业务层：工具装配 (v3.7.2 路径统一版)
//
// 将 pipeline 产出的 ToolMetadata 列表包装为 AI SDK dynamicTool。
// 不区分 builtin / MCP / skill —— 全部走 agent.toolRegistry.execute()。
//
// v3.7.2: HIGH static 工具 (bash/write/edit) 的 confirm 逻辑已迁入 RiskGate
// (路径 1 'high-static'),buildTools 不再嵌入 confirm 处理。所有路径统一在
// Gate 内决策 → buildTools 只看 action='pass'/'deny'。
//
// 观测: 每次工具执行记一条 TOOL observation(父节点 = 调用 buildTools 时的 step),
// 记 gate / 执行耗时与结果;工具在该 observation 的 scope 内执行,返回值不变。
//
// 允许依赖: tools/*, repos/side-effect-ledger, observe/*, shared/*, ipc/tool-confirm(仅类型),
//          loop/stream-utils(仅 isErrorOutput:TOOL 观测的成败判定与落库 is_error 同口径)
// 禁止依赖: ipc/* 运行时代码、loop/* 其余模块

import { dynamicTool, jsonSchema } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import {
  isToolErrorEnvelope,
  type ToolExecuteContext,
  type ToolMetadata,
  type PermissionPort,
} from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { RiskGate } from './risk-gate'
import { sessionApprovalMemory } from './session-approval-memory'
import { sideEffectLedger } from '../repos/side-effect-ledger'
import { ConfigStore } from '../store/config-store'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'
import { currentParent, withParent } from '../observe/trace-context'
import { NOOP_OBSERVATION, traceRecorder } from '../observe/trace-recorder'
import { isErrorOutput } from '../loop/stream-utils'

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
  // buildTools 调用时捕获 step 父引用;工具执行时不依赖 SDK 内部的异步上下文传播。
  const toolParent = currentParent()

  const schemas = opts.toolSchemas ?? agent.toolRegistry.listTools()
  if (schemas.length === 0 && !workspace.trim()) return undefined

  // 默认通过模式(auto_approve_tools,默认 true):运行时执行工具不弹 confirm 授权。
  const autoApprove =
    (ConfigStore.getInstance().get('auto_approve_tools') as boolean | undefined) ?? true
  const riskGate =
    opts.riskGate ?? new RiskGate(sessionApprovalMemory, sideEffectLedger, autoApprove)

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
        const toolObs =
          toolParent === null
            ? NOOP_OBSERVATION
            : traceRecorder.startObservation({
                type: 'TOOL',
                name: schema.name,
                parent: toolParent,
                input,
                metadata: {
                  tool_call_id: toolCallIdForGate,
                  risk_level: schema.riskLevel ?? 'LOW',
                  mcp_server: schema.provider ?? null,
                },
              })
        const gateStart = Date.now()
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
          const envelope = {
            __talor_error: true,
            code: 'RISK_GATE_ERROR',
            message: `Risk gate failed for ${schema.name}: ${err instanceof Error ? err.message : String(err)}`,
          }
          toolObs.end({
            level: 'ERROR',
            statusMessage: 'RISK_GATE_ERROR',
            output: envelope,
            metadata: { gate_ms: Date.now() - gateStart },
          })
          return envelope
        }
        const gateMs = Date.now() - gateStart

        if (gateDecision.action === 'deny') {
          const envelope = {
            __talor_error: true,
            code: 'USER_DENIED',
            message: `User denied the operation: ${gateDecision.summary ?? schema.name}`,
          }
          toolObs.end({
            level: 'WARNING',
            statusMessage: 'USER_DENIED',
            output: envelope,
            metadata: { gate_ms: gateMs },
          })
          return envelope
        }

        // action === 'pass'
        const execStart = Date.now()
        try {
          const result = await withParent(toolObs.ref, () =>
            agent.toolRegistry.execute(schema.name, input, {
              ...execCtx,
              traceParent: toolObs.ref ?? undefined,
            }),
          )
          const output = result.output ?? null
          const timing = { gate_ms: gateMs, exec_ms: Date.now() - execStart }
          if (isToolErrorEnvelope(output)) {
            toolObs.end({ level: 'ERROR', statusMessage: output.code, output, metadata: timing })
          } else if (isErrorOutput(output)) {
            toolObs.end({
              level: 'ERROR',
              statusMessage: 'TOOL_ERROR_OUTPUT',
              output,
              metadata: timing,
            })
          } else {
            toolObs.end({ output, metadata: timing })
          }
          return output
        } catch (err) {
          log.error('[buildTools] Tool execute exception:', schema.name, err)
          const message = err instanceof Error ? err.message : String(err)
          toolObs.end({
            level: 'ERROR',
            statusMessage: 'TOOL_EXCEPTION',
            output: message,
            metadata: { gate_ms: gateMs, exec_ms: Date.now() - execStart },
          })
          return `Tool execution failed: ${message}`
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
