// src/main/runtime/turn.ts — 业务层：chat:send 在 agent-engine 上的用例（一轮对话）
//
// 与旧的 sendChat 同样的签名与约定：只经 onDone 报错，函数本身不抛异常；注册中止之后才负责清理。
// 编排：校验 → 取目录快照、展开插件命令 → 注册中止 → 选 Agent 与模型 → 登记进行中的轮（用户行）→
// 登记本会话的授权端口 → 以会话的一轮启动运行并投影（含子孙运行，委托的子运行落到子会话）→ 等运行与投影结束 →
// 记本运行自己的用量（总量减子运行）→ onDone → 注销进行中的轮。运行 id 用本轮的 messageId，界面行的 trace_id 也是它。
// 会话 id 就是引擎会话：前文、跨轮压缩与副作用台账都由引擎从会话日志推导（会话方案）；界面消息也从会话日志
// 折叠（turn-rows），不写 messages 表。会话元数据里的前置输入（pending_context，例如提炼工作台的源对话快照）
// 放在本轮用户输入之前，运行开始后清掉；受理失败时保留到下一轮。
// 同一会话上一轮还没结束时引擎受理失败（session_busy），经 onDone 报错。
//
// 允许依赖: agent-engine（类型）、chat/*、repos/session-repo、store/config-store、runtime/*、
//          ipc/error-codes（classifyLlmError，沿用 chat/orchestrator 的做法）
// 禁止依赖: ipc/* 的其他运行时 import、db/*

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import type { Archive, RunResult } from 'agent-engine'
import type { AgentProfile } from '@shared/types/agent'
import type { AgentManager } from '../agent/agent-manager'
import type { ChatCallbacks, ChatPorts, ChatSendParams } from '../chat/types'
import {
  buildUserBlocks,
  checkVisionSupport,
  validateAttachment,
  type ValidatedAttachment,
} from '../chat/attachments'
import { resolveSessionProviderModel } from '../chat/provider-selector'
import { streamRegistry } from '../chat/stream-registry'
import { classifyLlmError, type ChatErrorCode } from '../ipc/error-codes'
import { sessionRepo, type ChatMessage } from '../repos/session-repo'
import { ConfigStore } from '../store/config-store'
import { agentFor, engineAgentId } from './agents'
import { registerApprovalPort } from './approval'
import { currentCatalog, expandCommand, type CatalogSnapshot } from './catalog'
import { createRunTreeProjection, ownNormalizedUsage } from './children'
import { addSessionUsage, usageRemainder } from './projection'
import { childTimeoutOf, getRuntime, type Runtime } from './engine'
import { modelRefOf } from './models'
import { attachLiveFold, beginLiveTurn, endLiveTurn } from './live-turns'
import { taskFor } from './task'

const CHAT_ERROR_OF_MODEL_ERROR: Readonly<Record<string, ChatErrorCode>> = {
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  MODEL_TIMEOUT: 'LLM_TIMEOUT',
  MODEL_CONNECTION: 'LLM_CONNECTION_FAILED',
  // 引擎开跑前的模型适配检查：附件模态模型不接收
  model_unsuitable: 'MODEL_INPUT_UNSUPPORTED',
}

/** 运行结果 → 渲染端错误；failed 与 stopped 报错（被 report_blocked 停住的不报错，受阻卡片说明原因），其余不报错。 */
export function chatErrorOf(
  result: RunResult,
): { code: ChatErrorCode; message: string } | undefined {
  if (result.status === 'failed') {
    const code = result.error?.code ?? result.code ?? ''
    return {
      code: CHAT_ERROR_OF_MODEL_ERROR[code] ?? 'LLM_ERROR',
      message: result.error?.message ?? result.code ?? 'failed',
    }
  }
  if (result.status === 'stopped' && result.code === 'notice_blocked') {
    // 插件 hook（UserPromptSubmit）拦下了这次运行：显示 hook 给的原因
    return { code: 'LLM_ERROR', message: result.text || 'hook 拦下了这次运行' }
  }
  if (result.status === 'stopped' && result.intent?.tool === 'report_blocked') return undefined
  if (result.status === 'stopped') {
    return { code: 'LLM_ERROR', message: `运行停止（${result.code ?? 'stopped'}）` }
  }
  return undefined
}

/** 会话的 agent，取不到时为 `__chat__`。 */
export function profileForSession(sessionId: string, agentManager: AgentManager): AgentProfile {
  const agentId = sessionRepo.getById(sessionId)?.agent_id ?? '__chat__'
  return (agentManager.getAgent(agentId) ?? agentManager.getChatAgent()).profile
}

/**
 * 本会话上一轮用的执行环境与现在的不同：插件 hook 等权限规则变了。
 * 环境指纹由引擎按规则内容算出；没有上一轮或档案读不了时为 false。
 */
export async function rulesChangedSince(
  archive: Pick<Archive, 'query'>,
  sessionId: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    // 会话的轮按开始时间倒序；子运行不带会话，查不到
    const [previous] = await archive.query({ session: sessionId, limit: 1 })
    return previous !== undefined && previous.environmentFingerprint !== fingerprint
  } catch (err) {
    log.warn('[turn] previous run lookup failed', err)
    return false
  }
}

/** 会话元数据里的前置输入；格式不对时为空。 */
export function pendingContextOf(sessionId: string): string[] {
  const raw = sessionRepo.getMetadata(sessionId).pending_context
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
}

/** 本轮已带上的前置输入从元数据里删掉（期间新加的保留）。 */
export function consumePendingContext(sessionId: string, used: readonly string[]): void {
  try {
    const metadata = sessionRepo.getMetadata(sessionId)
    const rest = pendingContextOf(sessionId).filter((x) => !used.includes(x))
    sessionRepo.setMetadata(sessionId, { ...metadata, pending_context: rest })
    log.info(`[turn] pending context consumed session=${sessionId} parts=${used.length}`)
  } catch (err) {
    log.warn('[turn] pending context not cleared', err)
  }
}

/** 进行中的轮次：退出时等它们写完。 */
const active = new Set<Promise<unknown>>()

export function waitForTurns(): Promise<void> {
  return Promise.allSettled([...active]).then(() => undefined)
}

type TurnDeps = { runtime?: () => Runtime; now?: () => Date; catalog?: () => CatalogSnapshot }

export function sendTurn(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
  deps: TurnDeps = {},
): Promise<{ messageId: string }> {
  const turn = runTurn(params, callbacks, ports, deps)
  active.add(turn)
  void turn.finally(() => active.delete(turn))
  return turn
}

async function runTurn(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
  deps: TurnDeps,
): Promise<{ messageId: string }> {
  const messageId = uuidv4()
  const sessionId = params.sessionId
  const typed = params.content.trim()
  const attachments = params.attachments ?? []
  let registered = false
  let live = false
  let unregisterPort: (() => void) | undefined

  try {
    if (!typed && attachments.length === 0) throw new Error('Empty message')
    const validated: ValidatedAttachment[] =
      attachments.length > 0 ? await Promise.all(attachments.map(validateAttachment)) : []
    // 这一轮只取一次目录快照：插件命令展开与 Agent 装配用同一个
    const snapshot = (deps.catalog ?? currentCatalog)()
    const userContent = expandCommand(typed, snapshot.commands) ?? typed

    const abort = streamRegistry.register(sessionId, messageId)
    registered = true

    if (!ports.agentManager) throw new Error('agentManager not injected')
    const session = sessionRepo.getById(sessionId)
    const agentId = session?.agent_id ?? '__chat__'
    const profile = profileForSession(sessionId, ports.agentManager)

    const { provider, modelId, fellBack } = resolveSessionProviderModel(session)
    if (validated.length > 0) checkVisionSupport(provider, validated)
    const model = modelRefOf(provider.id, modelId, fellBack ? undefined : session?.reasoning)

    const userBlocks = buildUserBlocks(userContent, validated)
    const userRow: ChatMessage = {
      id: `${messageId}:u`,
      session_id: sessionId,
      role: 'user',
      content: JSON.stringify(userBlocks),
      agent_id: agentId,
      created_at: new Date().toISOString(),
      trace_id: messageId,
    }
    beginLiveTurn(sessionId, { runId: messageId, userRow })
    live = true
    sessionRepo.touch(sessionId)
    const preface = pendingContextOf(sessionId)

    const runtime = (deps.runtime ?? getRuntime)()
    // 审批走授权窗口（chat:permission-request）；没有端口时审批人按拒绝处理
    if (ports.promptPermission) {
      unregisterPort = registerApprovalPort(sessionId, ports.promptPermission)
    }
    const task = taskFor({
      sessionId,
      workspace: session?.workspace ?? '',
      userContent: userBlocks,
      preface,
      maxSteps: ConfigStore.getInstance().get('max_react_steps'),
      now: (deps.now ?? (() => new Date()))(),
      rulesChanged: await rulesChangedSince(
        runtime.archive,
        sessionId,
        runtime.interactive.fingerprint,
      ),
    })

    log.info(`[turn] start session=${sessionId} run=${messageId} model=${model}`)
    const agent = agentFor(profile, snapshot, {
      childTimeoutMs: childTimeoutOf(ConfigStore.getInstance().getDelegation()),
    })
    const run = runtime.interactive.start(agent, task, {
      model,
      runId: messageId,
      session: sessionId,
    })
    const projection = createRunTreeProjection({
      sessionId,
      messageId,
      agentId,
      callbacks,
      getBlob: (ref) => runtime.archive.getBlob(ref),
      profileOf: (id) => snapshot.agents.find((a) => engineAgentId(a.profile.id) === id)?.profile,
    })
    run.subscribe(projection.subscriber, { children: true })
    attachLiveFold(sessionId, messageId, projection.fold())
    if (preface.length > 0) {
      run.subscribe({
        onEvent(e) {
          if (e.t === 'run_started') consumePendingContext(sessionId, preface)
        },
      })
    }
    if (abort.signal.aborted) run.abort('user')
    else abort.signal.addEventListener('abort', () => run.abort('user'), { once: true })

    const result = await run.result
    await projection.idle()
    log.info(
      `[turn] end run=${messageId} status=${result.status} code=${result.code ?? '-'} steps=${result.steps}`,
    )

    // 用量已逐步写入；子运行的记在各自的子会话，本会话只补本运行自己的余数
    addSessionUsage(
      sessionId,
      usageRemainder(ownNormalizedUsage(result.usage), projection.recordedUsage()),
    )

    callbacks.onDone(messageId, chatErrorOf(result))
    return { messageId }
  } catch (error) {
    log.error('[turn] error:', error)
    const message = error instanceof Error ? error.message : String(error)
    callbacks.onDone(messageId, { code: classifyLlmError(error), message })
    return { messageId }
  } finally {
    unregisterPort?.()
    if (live) endLiveTurn(sessionId, messageId)
    if (registered) streamRegistry.cleanup(sessionId, messageId)
  }
}
