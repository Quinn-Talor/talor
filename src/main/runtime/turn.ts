// src/main/runtime/turn.ts — 业务层：chat:send 在 agent-engine 上的用例（一轮对话）
//
// 与旧的 sendChat 同样的签名与约定：只经 onDone 报错，函数本身不抛异常；注册中止之后才负责清理。
// 编排：校验 → 取目录快照、展开插件命令 → 注册中止 → 选 Agent 与模型 → 保存用户消息 → 取 history（跨轮摘要，
// 上下文上限按引擎的输入上限；摘要实现把最后一条消息当本轮输入去掉）→
// 登记本会话的授权端口 → 启动运行并投影（含子孙运行，委托的子运行落到子会话）→ 等运行与投影结束 →
// 记本运行自己的用量（总量减子运行）→ onDone。运行 id 用本轮的 messageId，messages 行的 trace_id 也是它。
//
// 允许依赖: agent-engine（类型）、chat/*、history/context-config、repos/session-repo、store/config-store、runtime/*、
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
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { ConfigStore } from '../store/config-store'
import { agentFor, engineAgentId } from './agents'
import { registerApprovalPort } from './approval'
import { currentCatalog, expandCommand, type CatalogSnapshot } from './catalog'
import { createRunTreeProjection, ownNormalizedUsage } from './children'
import { addSessionUsage, usageRemainder } from './projection'
import { childTimeoutOf, getRuntime, type Runtime } from './engine'
import { historyConfigOf, modelRefOf } from './models'
import { markInterrupted } from './lifecycle'
import { historyFor } from './history-policy'
import { taskFor } from './task'

const CHAT_ERROR_OF_MODEL_ERROR: Readonly<Record<string, ChatErrorCode>> = {
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  MODEL_TIMEOUT: 'LLM_TIMEOUT',
  MODEL_CONNECTION: 'LLM_CONNECTION_FAILED',
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
 * 本会话上一轮（最近的顶层运行）用的执行环境与现在的不同：插件 hook 等权限规则变了。
 * 环境指纹由引擎按规则内容算出；没有上一轮或档案读不了时为 false。
 */
export async function rulesChangedSince(
  archive: Pick<Archive, 'query'>,
  sessionId: string,
  fingerprint: string,
): Promise<boolean> {
  try {
    const previous = (await archive.query({ subject: sessionId, limit: 20 })).find(
      (r) => r.parentRunId === undefined,
    )
    return previous !== undefined && previous.environmentFingerprint !== fingerprint
  } catch (err) {
    log.warn('[turn] previous run lookup failed', err)
    return false
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
    messageRepo.create({
      id: uuidv4(),
      session_id: sessionId,
      role: 'user',
      content: userBlocks,
      agent_id: agentId,
      trace_id: messageId,
    })
    sessionRepo.touch(sessionId)
    const history = await historyFor({
      sessionId,
      config: historyConfigOf(provider, modelId),
      signal: abort.signal,
    })

    const runtime = (deps.runtime ?? getRuntime)()
    // 审批走授权窗口（chat:permission-request）；没有端口时审批人按拒绝处理
    if (ports.promptPermission) {
      unregisterPort = registerApprovalPort(sessionId, ports.promptPermission)
    }
    const task = taskFor({
      sessionId,
      workspace: session?.workspace ?? '',
      userContent: userBlocks,
      history,
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
    const run = runtime.interactive.start(agent, task, { model, runId: messageId })
    const projection = createRunTreeProjection({
      sessionId,
      messageId,
      agentId,
      callbacks,
      getBlob: (ref) => runtime.archive.getBlob(ref),
      profileOf: (id) => snapshot.agents.find((a) => engineAgentId(a.profile.id) === id)?.profile,
    })
    run.subscribe(projection.subscriber, { children: true })
    if (abort.signal.aborted) run.abort('user')
    else abort.signal.addEventListener('abort', () => run.abort('user'), { once: true })

    const result = await run.result
    await projection.idle()
    // 被引擎关闭打断（应用退出）的运行留一条不进 history 的中断提示
    if (result.status === 'aborted' && result.code === 'interrupted') {
      markInterrupted(sessionId, messageId, { agentId, unfinished: true })
    }
    log.info(
      `[turn] end run=${messageId} status=${result.status} code=${result.code ?? '-'} steps=${result.steps}`,
    )

    // 用量已逐步写入；子运行的记在各自的子会话，本会话只补本运行自己的余数
    addSessionUsage(
      sessionId,
      usageRemainder(ownNormalizedUsage(result.usage), projection.recordedUsage()),
    )

    const persistError = projection.persistError()
    if (persistError !== undefined) {
      const reason = persistError instanceof Error ? persistError.message : String(persistError)
      callbacks.onDone(messageId, { code: 'LLM_ERROR', message: `消息落库失败：${reason}` })
    } else {
      callbacks.onDone(messageId, chatErrorOf(result))
    }
    return { messageId }
  } catch (error) {
    log.error('[turn] error:', error)
    const message = error instanceof Error ? error.message : String(error)
    callbacks.onDone(messageId, { code: classifyLlmError(error), message })
    return { messageId }
  } finally {
    unregisterPort?.()
    if (registered) streamRegistry.cleanup(sessionId, messageId)
  }
}
