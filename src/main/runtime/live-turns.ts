// src/main/runtime/live-turns.ts — 业务层：进行中的轮（只在主进程内存）
//
// 发送一轮时立刻登记用户行，渲染端马上能拉到；运行开始后挂上投影的折叠状态，已折叠的步随之可读；
// 这一轮结束后注销，之后由引擎档案读出（turn-rows）。按会话 id 登记，一个会话同一时刻只有一轮
// （引擎会话串行）；子会话按子会话 id 登记它的子运行。注销只删仍是自己的登记。
//
// 允许依赖: repos/session-repo（类型）、runtime/turn-rows（类型）
// 禁止依赖: ipc/*、db/*

import type { ChatMessage } from '../repos/session-repo'
import type { TurnFold } from './turn-rows'

interface LiveTurn {
  runId: string
  userRow: ChatMessage
  fold?: TurnFold
}

const live = new Map<string, LiveTurn>()

export function beginLiveTurn(
  sessionId: string,
  turn: { runId: string; userRow: ChatMessage },
): void {
  live.set(sessionId, { runId: turn.runId, userRow: turn.userRow })
}

export function attachLiveFold(sessionId: string, runId: string, fold: TurnFold): void {
  const turn = live.get(sessionId)
  if (turn?.runId === runId) turn.fold = fold
}

/** 进行中的轮的行：折叠出用户行之前先用登记的用户行。 */
export function liveRows(sessionId: string): ChatMessage[] {
  const turn = live.get(sessionId)
  if (!turn) return []
  const rows = turn.fold?.rows() ?? []
  return rows.some((r) => r.role === 'user') ? rows : [turn.userRow, ...rows]
}

export function endLiveTurn(sessionId: string, runId: string): void {
  if (live.get(sessionId)?.runId === runId) live.delete(sessionId)
}
