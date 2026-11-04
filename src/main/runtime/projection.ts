// src/main/runtime/projection.ts — 业务层：运行事件投影成渲染端回调
//
// 渲染端协议不变：文本增量 → onTextDelta，模型给出的工具调用 → onToolCall，工具结果 → onToolResult，
// 每步折叠完成 → onMessagePersisted（渲染端据此重新拉取消息）。消息行由 turn-rows 的折叠函数从事件
// 推导，不再写 messages 表：进行中的轮经 fold() 交给 live-turns，结束后由档案读出。
// 事件处理串成一条链；run.result 不等订阅者，调用方用 idle() 等处理完。
// 判定为完成的纯文本步等交付结果期间回调 onRunStatus('verifying')，交付结果到了回调 'idle'。
// 用量逐步写进会话：主模型（model_responded）与记忆、监督的模型调用（external_call kind=model）；
// 子运行的用量由子会话自己记录，这里不记。recordedUsage() 是本投影已写的部分，结束时调用方只补余数。
//
// 允许依赖: agent-engine（类型）、chat/types（类型）、repos/session-repo、runtime/turn-rows、electron-log
// 禁止依赖: ipc/* 的运行时 import、db/*

import log from 'electron-log'
import type { BlobRef, NormalizedUsage, RunSubscriber } from 'agent-engine'
import type { ChatCallbacks } from '../chat/types'
import { sessionRepo } from '../repos/session-repo'
import { createTurnFold, toolOutputBody, type TurnFold } from './turn-rows'

export { toolOutputBody } from './turn-rows'

export interface Projection {
  subscriber: RunSubscriber
  /** 已收到的事件全部处理完时 resolve。 */
  idle(): Promise<void>
  /** 本投影逐步写进会话的用量之和。 */
  recordedUsage(): NormalizedUsage
  /** 本运行的折叠状态（进行中的轮从这里取行）。 */
  fold(): TurnFold
}

const ZERO_USAGE: NormalizedUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** 应记用量减已记用量，逐字段下限 0。 */
export function usageRemainder(total: NormalizedUsage, recorded: NormalizedUsage): NormalizedUsage {
  return {
    input: Math.max(0, total.input - recorded.input),
    output: Math.max(0, total.output - recorded.output),
    cacheRead: Math.max(0, total.cacheRead - recorded.cacheRead),
    cacheWrite: Math.max(0, total.cacheWrite - recorded.cacheWrite),
  }
}

const usageSum = (u: NormalizedUsage) => u.input + u.output + u.cacheRead + u.cacheWrite

/** 用量写进会话（四项全为 0 时不写）。 */
export function addSessionUsage(sessionId: string, u: NormalizedUsage): void {
  if (usageSum(u) === 0) return
  sessionRepo.addUsage(sessionId, {
    inputTokens: u.input,
    outputTokens: u.output,
    cacheReadTokens: u.cacheRead,
    cacheWriteTokens: u.cacheWrite,
  })
}

export function createProjection(opts: {
  sessionId: string
  messageId: string
  agentId: string
  callbacks: ChatCallbacks
  getBlob(ref: BlobRef): Promise<string | Uint8Array>
}): Projection {
  const { sessionId, messageId, callbacks } = opts
  const fold = createTurnFold({
    sessionId,
    runId: messageId,
    agentId: opts.agentId,
    getBlob: opts.getBlob,
  })
  let chain: Promise<void> = Promise.resolve()
  let recorded: NormalizedUsage = { ...ZERO_USAGE }

  const record = (u: NormalizedUsage | undefined) => {
    if (!u || usageSum(u) === 0) return
    addSessionUsage(sessionId, u)
    recorded = {
      input: recorded.input + u.input,
      output: recorded.output + u.output,
      cacheRead: recorded.cacheRead + u.cacheRead,
      cacheWrite: recorded.cacheWrite + u.cacheWrite,
    }
  }

  const persisted = (steps: number[]) => {
    if (steps.length === 0) return
    sessionRepo.touch(sessionId)
    for (const step of steps) callbacks.onMessagePersisted?.(sessionId, step)
  }

  async function handle(e: Parameters<NonNullable<RunSubscriber['onEvent']>>[0]): Promise<void> {
    const waiting = fold.pendingDelivery()
    const steps = await fold.apply(e)
    switch (e.t) {
      case 'model_responded':
        for (const call of e.response.toolCalls) {
          callbacks.onToolCall(messageId, call.id, call.name, call.input, e.step, e.at)
        }
        record(e.response.usage)
        break
      case 'external_call':
        if (e.kind === 'model') record(e.usage)
        break
      case 'tool_finished': {
        const result = fold.resultOf(e.callId)
        if (!result) break
        const body = toolOutputBody(result.shown)
        callbacks.onToolResult(
          messageId,
          e.callId,
          fold.toolNameOf(e.callId),
          e.isError
            ? { __talor_error: true, code: e.errorCode ?? 'TOOL_ERROR', message: body }
            : body,
          e.durationMs,
        )
        break
      }
      case 'step_ended':
        if (waiting === undefined && fold.pendingDelivery() === e.step) {
          callbacks.onRunStatus?.(messageId, 'verifying')
        }
        break
      case 'delivery_checked':
        if (waiting !== undefined) callbacks.onRunStatus?.(messageId, 'idle')
        else log.debug('[projection] delivery_checked without pending step')
        break
      case 'fallback_generated':
        callbacks.onTextDelta(messageId, e.text, steps[0] ?? 0)
        break
      case 'run_ended':
        if (waiting !== undefined) callbacks.onRunStatus?.(messageId, 'idle')
        break
      default:
        break
    }
    persisted(steps)
  }

  return {
    subscriber: {
      onEvent(e) {
        chain = chain.then(() =>
          handle(e).catch((error: unknown) => {
            log.error(`[projection] 处理事件 ${e.t} 出错`, error)
          }),
        )
        return chain
      },
      onNotice(n) {
        if (n.t === 'text_delta') callbacks.onTextDelta(messageId, n.text, n.step)
        else if (n.t === 'reasoning_delta') callbacks.onReasoningDelta?.(messageId, n.text, n.step)
      },
    },
    idle: () => chain,
    recordedUsage: () => ({ ...recorded }),
    fold: () => fold,
  }
}
