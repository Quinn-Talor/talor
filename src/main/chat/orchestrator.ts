// src/main/chat/orchestrator.ts —— 业务层（chat 领域）：chat:send 用例编排
//
// 职责：接收参数化的 chat 请求 + UI 回调，完成 "附件校验 → provider/model →
// 工具装配 → 持久化用户消息 → 驱动 ReAct 循环" 全流程。不感知 Electron / IPC。
//
// 允许依赖：chat/（同层）、tools/*、loop/*、prompt/*、memory/*、providers/*、
//          repos/*、store/*（只读）、services/*（基础能力 safe-storage 等）
// 禁止依赖：ipc/* 的运行时代码（仅允许 ipc/ 的纯类型 import，如 ToolConfirmPort / ChatErrorCode）

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { ConfigStore } from '../store/config-store'
import { SafeStorageService } from '../services/safe-storage'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { getAdapter } from '../providers/model-adapter'
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
import { getDefaultProvider } from './provider-selector'
import { streamRegistry } from './stream-registry'
import { classifyLlmError, type ChatErrorCode } from '../ipc/error-codes'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

// 单例：pipeline 和 memoryManager 按进程全局持有，避免每次请求重建插件链。
// 注：单例副作用意味着未来增加与 session 绑定的状态时要小心——目前两者都是无状态的。
const memoryManager = new MemoryManager()
const pipeline = new PromptPipeline(memoryManager)

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

  try {
    // Step 1: 非空校验
    if (!userContent && attachments.length === 0) throw new Error('Empty message')

    // Step 2: 附件校验（并行，任意一个失败都中止本次请求）
    const validated: ValidatedAttachment[] =
      attachments.length > 0 ? await Promise.all(attachments.map(validateAttachment)) : []

    // Step 3: 注册流（若同 session 有未完成流，先 abort）
    const abortController = streamRegistry.register(sessionId, messageId)

    // Step 4: provider + model；预热 API key；视觉能力校验
    const provider = getDefaultProvider()
    const session = sessionRepo.getById(sessionId)
    SafeStorageService.getInstance().getApiKey(provider.id)
    if (validated.length > 0) checkVisionSupport(provider, validated)

    const adapter = getAdapter(provider.type)
    const model = adapter.createModel(provider, session?.model_id ?? 'default')
    const workspace = session?.workspace ?? ''

    // Step 4.5: 获取 Agent（通过 session.agent_id 查找，ADR-2 统一模型）
    if (!ports.agentManager) throw new Error('agentManager not injected')
    const agentId = session?.agent_id ?? '__chat__'
    const agent = ports.agentManager.getAgent(agentId) ?? ports.agentManager.getChatAgent()

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
      session?.model_id ?? 'default',
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
    await runReactLoop({
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
      providerConfig: resolveProviderConfig(provider),
      workspace,
      maxSteps: typeof maxReactSteps === 'number' && maxReactSteps > 0 ? maxReactSteps : undefined,
      agent,
      confirmTool: ports.confirmTool,
      requestPermission,
      skillTracker,
      events,
      streamOptions: adapter.buildStreamOptions(),
      callbacks: {
        onTextDelta: (delta, stepIdx) => callbacks.onTextDelta(messageId, delta, stepIdx),
        onToolCall: (id, name, input, stepIdx, startedAt) =>
          callbacks.onToolCall(messageId, id, name, input, stepIdx, startedAt),
        onToolResult: (id, name, output, durationMs) =>
          callbacks.onToolResult(messageId, id, name, output, durationMs),
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
    callbacks.onDone(messageId, { code, message })
    return { messageId }
  } finally {
    // 无论成败都清理 stream 注册项（abort 已由 streamRegistry.abort 触发，不在此处）
    streamRegistry.cleanup(sessionId)
  }
}
