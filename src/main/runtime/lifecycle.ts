// src/main/runtime/lifecycle.ts — 业务层：引擎运行时的生命周期（能力架构方案 §3.8；修 §1.5 #8）
//
// 启动：预热引擎（预连接 MCP）。引擎创建时给没结束的运行补记中断结局，界面上的中断提示由
// turn-rows 从结局折叠，这里不写任何行。子会话的中断状态由 cleanupOrphanRunningSubSessions 处理。
// 退出：创建过引擎时，关库之前限时等引擎关闭（停止进行中的运行）与进行中的轮次写完。
// 删除会话：引擎档案里的会话（各轮、子运行与 blob）一起删除；会话还有一轮在收尾时等进行中的轮次写完再删。
//
// 允许依赖: agent-engine（类型）、electron-log、runtime/*
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import type { Archive, Engine } from 'agent-engine'
import { getRuntime, runArchive, runtimeCreated, shutdownRuntime, warmUpRuntime } from './engine'
import { waitForTurns } from './turn'

/** 启动时预热引擎（预连接 MCP）；引擎创建时会给没结束的运行补记中断结局，界面的中断提示从结局折叠。 */
export async function startEngineRuntime(deps: { warmUp?: () => void } = {}): Promise<void> {
  ;(deps.warmUp ?? warmUpRuntime)()
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

/**
 * 删除会话在引擎档案里的全部记录。引擎已创建时经引擎删除（先占住会话）：会话还有一轮在收尾
 * （session_busy，例如刚中止）时等进行中的轮次写完再试一次；没创建过引擎时直接删档案。
 * 失败只记日志、返回 false，不影响界面上的删除。
 */
export async function deleteEngineSession(
  sessionId: string,
  deps: {
    engine?: () => Pick<Engine, 'deleteSession'> | undefined
    archive?: () => Pick<Archive, 'deleteSession'>
    waitForTurns?: () => Promise<void>
  } = {},
): Promise<boolean> {
  try {
    const engine = (deps.engine ?? (() => (runtimeCreated() ? getRuntime().engine : undefined)))()
    if (!engine) {
      await (deps.archive ?? runArchive)().deleteSession(sessionId)
      return true
    }
    let result = await engine.deleteSession(sessionId)
    if (!result.ok && result.code === 'session_busy') {
      await (deps.waitForTurns ?? waitForTurns)()
      result = await engine.deleteSession(sessionId)
    }
    if (result.ok) return true
    log.warn(
      `[lifecycle] engine session ${sessionId} not deleted: ${result.code} ${result.message}`,
    )
    return false
  } catch (err) {
    log.warn(`[lifecycle] engine session ${sessionId} not deleted`, err)
    return false
  }
}
