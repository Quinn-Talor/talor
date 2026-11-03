// src/main/runtime/lifecycle.ts — 业务层：引擎运行时的生命周期（能力架构方案 §3.8；修 §1.5 #8）
//
// 启动：模式不是 off 时预热引擎（预连接 MCP），再为引擎补齐结尾的顶层运行写中断提示。
// 中断提示是 content_type 为 'notice' 的 assistant 消息，只给用户看，不进任何一条路径的模型输入；
// 它排在该运行最后一行之后，最终文本已经落库的运行不写。子会话的中断状态由
// cleanupOrphanRunningSubSessions 处理，这里只管顶层运行。
// 退出：创建过引擎时，关库之前限时等引擎关闭（停止进行中的运行）与进行中的轮次写完。
//
// 允许依赖: agent-engine（类型）、electron-log、repos/session-repo、runtime/*
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { messageRepo, sessionRepo, type ChatMessage } from '../repos/session-repo'
import { runtimeMode, type RuntimeMode } from './dispatch'
import { getRuntime, runtimeCreated, shutdownRuntime, warmUpRuntime, type Runtime } from './engine'
import { waitForTurns } from './turn'

export const INTERRUPTED_NOTE = '⚠️ 这一轮回答在应用退出时中断，没有完成。'

/** 该运行的最后一行是只有文本的 assistant：最终答复已经落库，不算没做完。 */
function finishedWithText(last: ChatMessage): boolean {
  if (last.role !== 'assistant') return false
  let content: unknown
  try {
    content = JSON.parse(last.content)
  } catch {
    content = last.content
  }
  if (typeof content === 'string') return content.trim().length > 0
  if (!Array.isArray(content)) return false
  const parts = content as Array<{ type?: string; text?: string }>
  return (
    !parts.some((p) => p.type === 'tool-call') &&
    parts.some((p) => p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0)
  )
}

/**
 * 为没做完的运行写一条中断提示；最终文本已落库时不写，返回 false。
 * `unfinished`：引擎已确认运行被打断（退出时运行中），最后一行是半截文本也写提示。
 */
export function markInterrupted(
  sessionId: string,
  runId: string,
  opts: { agentId: string; startedAt?: number; unfinished?: boolean },
): boolean {
  const rows = messageRepo
    .listBySession(sessionId)
    .filter((m) => m.trace_id === runId && m.content_type !== 'notice')
  const last = rows.at(-1)
  if (!opts.unfinished && last && finishedWithText(last)) return false
  const createdAt =
    last?.created_at ??
    (opts.startedAt !== undefined ? new Date(opts.startedAt).toISOString() : undefined)
  messageRepo.create({
    id: uuidv4(),
    session_id: sessionId,
    role: 'assistant',
    content: [{ type: 'text', text: INTERRUPTED_NOTE }],
    content_type: 'notice',
    agent_id: opts.agentId,
    trace_id: runId,
    ...(createdAt ? { created_at: createdAt } : {}),
  })
  sessionRepo.touch(sessionId)
  return true
}

/** 启动时为引擎补齐结尾的顶层运行写中断提示；返回写入的条数。 */
export async function recoverInterruptedRuns(runtime: Runtime): Promise<number> {
  let summaries
  try {
    summaries = await runtime.engine.interrupted()
  } catch (err) {
    log.warn('[lifecycle] interrupted runs recovery failed', err)
    return 0
  }
  let n = 0
  for (const s of summaries) {
    if (s.parentRunId || !s.subject) continue
    try {
      const session = sessionRepo.getById(s.subject)
      if (!session) continue
      if (
        markInterrupted(s.subject, s.runId, { agentId: session.agent_id, startedAt: s.startedAt })
      ) {
        n++
      }
    } catch (err) {
      log.warn('[lifecycle] mark interrupted run failed', s.runId, err)
    }
  }
  if (n > 0) log.info(`[lifecycle] marked ${n} interrupted runs`)
  return n
}

/** 模式不是 off 时预热引擎并收尾中断的运行；off 时什么都不做。 */
export async function startEngineRuntime(
  deps: {
    mode?: () => RuntimeMode
    warmUp?: () => void
    runtime?: () => Runtime
    recover?: (runtime: Runtime) => Promise<number>
  } = {},
): Promise<void> {
  if ((deps.mode ?? runtimeMode)() === 'off') return
  ;(deps.warmUp ?? warmUpRuntime)()
  let runtime: Runtime
  try {
    runtime = (deps.runtime ?? getRuntime)()
  } catch {
    return
  }
  await (deps.recover ?? recoverInterruptedRuns)(runtime)
}

/** 退出时等待引擎关闭的上限。 */
export const QUIT_SHUTDOWN_TIMEOUT_MS = 3000

/** 退出关闭：没创建过引擎时返回 none；否则等引擎关闭与进行中的轮次写完，超时返回 timeout。 */
export async function shutdownForQuit(
  timeoutMs: number = QUIT_SHUTDOWN_TIMEOUT_MS,
  deps: { waitForTurns?: () => Promise<void> } = {},
): Promise<'none' | 'closed' | 'timeout'> {
  if (!runtimeCreated()) return 'none'
  const done = (async () => {
    await shutdownRuntime()
    await (deps.waitForTurns ?? waitForTurns)()
    return 'closed' as const
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const result = await Promise.race([done, timeout])
  clearTimeout(timer)
  log.info(`[lifecycle] quit shutdown ${result}`)
  return result
}
