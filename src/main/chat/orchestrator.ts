// src/main/chat/orchestrator.ts —— 业务层（chat 领域）：chat:send 用例编排
//
// 职责：接收参数化的 chat 请求 + UI 回调，完成 "附件校验 → provider/model →
// 工具装配 → 持久化用户消息 → 驱动 ReAct 循环" 全流程。不感知 Electron / IPC。
//
// 允许依赖：chat/（同层）、tools/*、loop/*、prompt/*、memory/*、providers/*、observe/*、
//          repos/*、store/*（只读）、services/*（基础能力 safe-storage 等）
// 禁止依赖：ipc/* 的运行时代码（仅允许 ipc/ 的纯类型 import，如 ToolConfirmPort / ChatErrorCode）

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { ConfigStore } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { getAdapter, resolveStreamOptions } from '../providers/model-adapter'
import '../tools/builtin'
import { runReactLoop } from '../loop/react-loop'
import { SkillActivationTracker } from '../skills/registry'
import { ExecutionEventBus } from './events'
import { resolveProviderConfig, PromptPipeline } from '../prompt/PromptPipeline'
import { MemoryManager } from '../memory/MemoryManager'
import {
  validateAttachment,
  buildUserBlocks,
  checkVisionSupport,
  type ValidatedAttachment,
} from './attachments'
import { resolveSessionProviderModel } from './provider-selector'
import { streamRegistry } from './stream-registry'
import { classifyLlmError, type ChatErrorCode } from '../ipc/error-codes'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import type { LoopExitReason, LoopResult } from '../loop/types'
import { traceRecorder } from '../observe/trace-recorder'
import { runInScope } from '../observe/trace-context'

/**
 * 本轮未正常完成的 loop 结束原因：trace root 记 WARNING（具体原因见 metadata.exit_reason）。
 * 典型是 fallback_summary —— 整轮模型调用都失败（如 401）时 loop 自行兜底收尾、不抛错，
 * root 若仍记 DEFAULT，失败轮在 trace 里看起来与正常轮无异。
 */
const DEGRADED_EXITS: ReadonlySet<LoopExitReason> = new Set<LoopExitReason>([
  'abort',
  'fallback_summary',
  'context_overflow',
  'repeated_error',
  'max_steps',
  'empty_text',
  'step_error',
])

// 单例：pipeline 和 memoryManager 按进程全局持有，避免每次请求重建插件链。
// 注：单例副作用意味着未来增加与 session 绑定的状态时要小心——目前两者都是无状态的。
//
// `pipeline` 也供 delegate_agent 子 loop 复用（pipeline.build(ctx) 按 sessionId
// 取消息，不持有 session 级状态）；通过 sharedPromptPipeline export 暴露。
const memoryManager = new MemoryManager()
const pipeline = new PromptPipeline(memoryManager)
export const sharedPromptPipeline = pipeline

/** chat:send 业务入参（camelCase；入口层负责 snake_case ↔ camelCase 转换）。 */
export interface ChatSendParams {
  sessionId: string
  content: string
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

/**
 * UI 事件回调。入口层把每个回调桥接到 `webContents.send('chat:xxx', ...)`。
 *
 * 设计：单一出口 `onDone` 表示流结束；err 非空代表这次请求没能正常完成，
 * 前端通过 `err.code` 做差异化提示（如"API key 无效"），不需要额外的 error 事件。
 */
export interface ChatCallbacks {
  onTextDelta(messageId: string, delta: string, stepIndex: number): void
  onToolCall(
    messageId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
    stepIndex: number,
    startedAt: number,
  ): void
  onToolResult(
    messageId: string,
    toolCallId: string,
    toolName: string,
    output: unknown,
    durationMs: number,
  ): void
  /**
   * v3.6: 主进程一条消息落库后触发。入口层桥接到
   * `webContents.send('chat:message-persisted', { sessionId, stepIndex })`,
   * renderer 收到事件立即调 loadMessages, 替代 3s polling。
   *
   * stepIndex 用于 renderer 清理 streamItems 中 step <= 该值的项, 避免
   * 已落库 message 与 streaming UI 同时显示同一步工具调用(1:1 视觉重复)。
   */
  onMessagePersisted?(sessionId: string, stepIndex: number): void
  onDone(messageId: string, err?: { code: ChatErrorCode; message: string }): void
}

/**
 * 端口注入：业务层声明"需要什么能力"，具体实现由入口层提供。
 * confirmTool 绑定了 mainWindow 的 `requestToolConfirm` 调用。
 * promptPermission 用于跨 workspace 路径/命令的用户授权（PR #5）。
 */
export interface ChatPorts {
  confirmTool: ToolConfirmPort
  promptPermission?: import('../permissions/port').PermissionUIPrompt
  agentManager: import('../agent/agent-manager').AgentManager
}

/**
 * chat:send 业务入口。
 *
 * 编排顺序：
 *   1. 校验非空（content 和 attachments 至少有一）
 *   2. 校验附件（逐个 validateAttachment：路径/大小/mime + 图片 base64）
 *   3. streamRegistry.register（同 session 新请求会 abort 旧的）
 *   4. 选 provider + 预热 API key（让 safe-storage 触发 OS keychain 解锁）+ 视觉能力校验
 *   5. 持久化 user 消息（role='user'）并 touch session
 *   6. 装配 tools（含 MCP 等待 + 高风险确认端口）
 *   7. 驱动 runReactLoop，回调桥接到 callbacks.*
 *   8. 成功 → callbacks.onDone(messageId)
 *
 * 单一错误出口：任何步骤抛错都通过 onDone(messageId, { code, message }) 回报；
 * 函数本身始终 resolve 到 { messageId }，**不 throw**。
 * 这样入口层无需 try/catch，也避免渲染端同时收到 stream 错误 + Promise reject 的双通知。
 */
export async function sendChat(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
): Promise<{ messageId: string }> {
  const messageId = uuidv4()
  const sessionId = params.sessionId
  const userContent = params.content.trim()
  const attachments = params.attachments ?? []
  // 只有本请求 register 成功后才负责清理注册项;register 之前失败的请求
  // (空消息 / 附件不合法)不得触碰同 session 正在运行的请求条目。
  let registered = false

  try {
    // 一轮一条 trace(id = messageId);观测关闭时 scope 为 null,下面的 trace 调用均为 no-op。
    const scope = traceRecorder.startTrace({
      id: messageId,
      sessionId,
      name: 'turn',
      input: userContent,
      rootName: 'agent:__pending__',
      config: ConfigStore.getInstance().getTrace(),
    })
    const loopResult = await runInScope(scope, async (): Promise<LoopResult> => {
      // Step 1: 非空校验
      if (!userContent && attachments.length === 0) throw new Error('Empty message')

      // Step 2: 附件校验（并行，任意一个失败都中止本次请求）
      const validated: ValidatedAttachment[] =
        attachments.length > 0 ? await Promise.all(attachments.map(validateAttachment)) : []

      // Step 3: 注册流（若同 session 有未完成流，先 abort）
      const abortController = streamRegistry.register(sessionId, messageId)
      registered = true

      // Step 4.5: 获取 Agent（通过 session.agent_id 查找，ADR-2 统一模型）
      if (!ports.agentManager) throw new Error('agentManager not injected')
      const session = sessionRepo.getById(sessionId)
      const agentId = session?.agent_id ?? '__chat__'
      const agent = ports.agentManager.getAgent(agentId) ?? ports.agentManager.getChatAgent()

      // Step 4: provider + model;预热 API key;视觉能力校验
      // 回落链见 resolveSessionProviderModel(session provider 被删/禁用时模型随 provider 回落)。
      const { provider, modelId: effectiveModelId, fellBack } = resolveSessionProviderModel(session)
      const apiKey = SafeStorageService.getInstance().getApiKey(provider.id)
      if (validated.length > 0) checkVisionSupport(provider, validated)

      // session 级推理配置针对原 provider;回落到默认 provider 时只用其自身配置。
      const reasoning = fellBack ? provider.reasoning : (session?.reasoning ?? provider.reasoning)
      const effectiveProvider = { ...provider, reasoning }
      const adapter = getAdapter(provider.type)
      const model = adapter.createModel(effectiveProvider, effectiveModelId)
      traceRecorder.updateRoot(messageId, {
        name: `agent:${agentId}`,
        metadata: {
          agent_id: agentId,
          provider_id: provider.id,
          provider_type: provider.type,
          model_id: effectiveModelId,
          reasoning: reasoning ?? null,
          // trace input 只存文本;附件只记摘要(不存内容),用于判断本轮是否带图 / 文件
          ...(validated.length > 0
            ? {
                attachments: validated.map((a) => ({
                  name: a.filename,
                  mime_type: a.mime_type,
                  size_bytes: a.size_bytes,
                })),
              }
            : {}),
        },
      })
      if (apiKey) traceRecorder.addSecret(messageId, apiKey)
      const workspace = session?.workspace ?? ''

      // Step 5: 持久化用户消息
      messageRepo.create({
        id: uuidv4(),
        session_id: sessionId,
        role: 'user',
        content: buildUserBlocks(userContent, validated),
        agent_id: agentId,
      })
      sessionRepo.touch(sessionId)

      log.info(
        '[chat-orch] Starting ReAct loop, model:',
        effectiveModelId,
        'provider:',
        `${provider.id}(${provider.type})`,
        'agent:',
        agentId,
      )

      // Per-execution event bus: subsystems emit/subscribe state-change notifications.
      // Lives only for this sendChat — drops with the stack, no manual unsubscribe needed.
      const events = new ExecutionEventBus()

      // Per-session skill tracker: dedupes skill activations within this request.
      // When memory compresses (skill tool_result contents get summarized away),
      // clear the tracker so the model can re-activate and receive fresh instructions.
      const skillTracker = new SkillActivationTracker()
      events.on('memory.compressed', (e) => {
        skillTracker.clear()
        log.info(
          `[chat-orch] memory compressed (covered_until=${e.coveredUntilMessageId}), skill tracker cleared`,
        )
      })

      // Step 5.5: 构造 permission port。只在 workspace 已设置且 UI 端口存在时启用；
      // 否则 requestPermission=undefined，工具退化为"needs_consent → deny"。
      const { createPermissionPort } = await import('../permissions/port')
      const requestPermission =
        workspace && ports.promptPermission
          ? createPermissionPort({ workspacePath: workspace, promptUI: ports.promptPermission })
          : undefined

      // Step 6: 驱动 ReAct 循环（工具由 pipeline 每步产出，react-loop 内部调 buildTools 包装）
      const maxReactSteps = ConfigStore.getInstance().get('max_react_steps')
      const loopResult = await runReactLoop({
        model,
        sessionId,
        messageId,
        userContent,
        mappedAttachments: validated.map((a) => ({
          name: a.filename,
          mediaType: a.mime_type,
          base64: a.base64_data,
          content: undefined,
        })),
        abortSignal: abortController.signal,
        pipeline,
        provider,
        providerConfig: resolveProviderConfig(provider, effectiveModelId),
        workspace,
        maxSteps:
          typeof maxReactSteps === 'number' && maxReactSteps > 0 ? maxReactSteps : undefined,
        agent,
        confirmTool: ports.confirmTool,
        requestPermission,
        skillTracker,
        events,
        streamOptions: resolveStreamOptions(adapter, effectiveProvider, effectiveModelId),
        callbacks: {
          onTextDelta: (delta, stepIdx) => callbacks.onTextDelta(messageId, delta, stepIdx),
          onToolCall: (id, name, input, stepIdx, startedAt) =>
            callbacks.onToolCall(messageId, id, name, input, stepIdx, startedAt),
          onToolResult: (id, name, output, durationMs) =>
            callbacks.onToolResult(messageId, id, name, output, durationMs),
          onMessagePersisted: (sid, stepIdx) => callbacks.onMessagePersisted?.(sid, stepIdx),
        },
      })
      return loopResult
    })
    traceRecorder.endTrace(messageId, {
      output: messageRepo.getLastAssistantText(sessionId, messageId),
      level: DEGRADED_EXITS.has(loopResult.exitReason) ? 'WARNING' : 'DEFAULT',
      metadata: {
        exit_reason: loopResult.exitReason,
        policy_exit_reason: loopResult.policyExitReason,
        total_steps: loopResult.totalSteps,
        total_tool_calls: loopResult.totalToolCalls,
      },
    })

    // Step 8: 终态（成功）
    callbacks.onDone(messageId)
    return { messageId }
  } catch (error) {
    // 单一错误出口：分类成 ChatErrorCode 后通过 onDone 回报，不抛出
    log.error('[chat-orch] error:', error)
    const code = classifyLlmError(error)
    const message = error instanceof Error ? error.message : String(error)
    traceRecorder.endTrace(messageId, {
      level: 'ERROR',
      statusMessage: `${code}: ${message}`,
      metadata: { error_code: code },
    })
    callbacks.onDone(messageId, { code, message })
    return { messageId }
  } finally {
    // 无论成败都清理本请求的 stream 注册项（abort 已由 streamRegistry.abort 触发，不在此处）
    if (registered) streamRegistry.cleanup(sessionId, messageId)
  }
}
