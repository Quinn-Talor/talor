// src/main/runtime/projection.ts — 业务层：运行事件投影成渲染端回调与 messages 行
//
// 渲染端协议不变：文本增量 → onTextDelta，模型给出的工具调用 → onToolCall，工具结果 → onToolResult，
// 每步结束 → assistant 行与 tool 行同一批落库后 onMessagePersisted。行格式与旧路径一致（切回旧运行时
// 也读得懂），trace_id 为本轮的运行 id。运行中断时把没落库的步补齐，缺结果的调用写错误占位，保证成对。
// 事件处理串成一条链；run.result 不等订阅者，调用方用 idle() 等处理完。
// 每步按引擎的判定与交付结果分类：带工具调用的步、被退回或转兜底的步是过程，交付的文本是答复；
// 判定为完成的纯文本步等 delivery_checked（或 run_ended）再落库，期间回调 onRunStatus('verifying')。
// 只含意图调用（finish / ask_user / propose / report_blocked）的步按纯文本步分类，混了普通工具的步仍是过程。
// 阶段标记写在文本片段与 tool-call 片段的 providerOptions.talor.phase，reasoning 片段不标。
// 用量逐步写进会话：主模型（model_responded）与记忆、监督的模型调用（external_call kind=model）；
// 子运行的用量由子会话自己记录，这里不记。recordedUsage() 是本投影已写的部分，结束时调用方只补余数。
//
// 允许依赖: agent-engine（类型）、chat/types（类型）、@shared/turn-phase、@shared/intents、repos/session-repo、electron-log
// 禁止依赖: ipc/* 的运行时 import、db/*

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import type { BlobRef, NormalizedUsage, RunEvent, RunSubscriber } from 'agent-engine'
import { isIntentCall } from '@shared/intents'
import { phaseMarker, type TurnPhase } from '@shared/turn-phase'
import type { ChatCallbacks } from '../chat/types'
import { messageRepo, sessionRepo, type MessageCreateParams } from '../repos/session-repo'

const MISSING_RESULT =
  '<tool_output>\nERROR [TOOL_MISSING_RESULT]: 没有记录到这次调用的结果\n</tool_output>'

export interface Projection {
  subscriber: RunSubscriber
  /** 已收到的事件全部处理完（含落库）时 resolve。 */
  idle(): Promise<void>
  /** 落库失败的异常；没有则 undefined。 */
  persistError(): unknown
  /** 本投影逐步写进会话的用量之和。 */
  recordedUsage(): NormalizedUsage
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

interface StepState {
  responded: boolean
  persisted: boolean
  text: string
  reasoning?: { text: string; providerData?: unknown }
  toolCalls: Array<{ id: string; name: string; input: unknown }>
  results: Map<string, { shown: string; isError: boolean }>
  verdict?: Verdict
}

type Verdict = 'complete' | 'continue' | 'finalize' | 'awaitInput' | 'stop'

function verdictOf(v: Record<string, unknown>): Verdict {
  if ('complete' in v) return 'complete'
  if ('continue' in v) return 'continue'
  if ('finalize' in v) return 'finalize'
  if ('awaitInput' in v) return 'awaitInput'
  return 'stop'
}

/** `shown` 去掉 `<tool_output>` 包装，并还原被转义的结束标签。 */
export function toolOutputBody(shown: string): string {
  return shown
    .replace(/^<tool_output>\n/, '')
    .replace(/\n<\/tool_output>$/, '')
    .replaceAll('<\\/tool_output>', '</tool_output>')
}

const textOf = (blob: string | Uint8Array) =>
  typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8')

export function createProjection(opts: {
  sessionId: string
  messageId: string
  agentId: string
  callbacks: ChatCallbacks
  getBlob(ref: BlobRef): Promise<string | Uint8Array>
}): Projection {
  const { sessionId, messageId, agentId, callbacks } = opts
  const steps = new Map<number, StepState>()
  const stepOfCall = new Map<string, number>()
  let chain: Promise<void> = Promise.resolve()
  let failure: unknown
  let recorded: NormalizedUsage = { ...ZERO_USAGE }
  /** 判定为完成、等交付结果再落库的纯文本步。 */
  let pendingDelivery: number | undefined

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

  const stepState = (step: number): StepState => {
    let state = steps.get(step)
    if (!state) {
      state = { responded: false, persisted: false, text: '', toolCalls: [], results: new Map() }
      steps.set(step, state)
    }
    return state
  }

  const row = (role: 'assistant' | 'tool', content: unknown): MessageCreateParams => ({
    id: uuidv4(),
    session_id: sessionId,
    role,
    content,
    agent_id: agentId,
    trace_id: messageId,
  })

  const persist = (step: number, rows: MessageCreateParams[]) => {
    if (failure !== undefined) return
    try {
      messageRepo.createBatch(rows)
      sessionRepo.touch(sessionId)
    } catch (error) {
      log.error(`[projection] 落库失败 step=${step}`, error)
      failure = error
      return
    }
    callbacks.onMessagePersisted?.(sessionId, step)
  }

  const flush = (step: number, phase: TurnPhase) => {
    const state = steps.get(step)
    if (!state || state.persisted) return
    state.persisted = true
    if (!state.text && state.toolCalls.length === 0) return
    const assistant: unknown[] = []
    if (state.reasoning?.text) {
      assistant.push({
        type: 'reasoning',
        text: state.reasoning.text,
        ...(state.reasoning.providerData !== undefined
          ? { providerOptions: state.reasoning.providerData }
          : {}),
      })
    }
    const marker = phaseMarker(phase)
    if (state.text) assistant.push({ type: 'text', text: state.text, providerOptions: marker })
    for (const call of state.toolCalls) {
      assistant.push({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.input,
        providerOptions: marker,
      })
    }
    if (state.toolCalls.length === 0) {
      persist(step, [row('assistant', assistant)])
      return
    }
    const results = state.toolCalls.map((call) => {
      const result = state.results.get(call.id)
      return {
        type: 'tool-result',
        toolCallId: call.id,
        toolName: call.name,
        output: { type: 'text', value: result?.shown ?? MISSING_RESULT },
        isError: result ? result.isError : true,
      }
    })
    persist(step, [row('assistant', assistant), row('tool', results)])
  }

  const lastStep = () => Math.max(0, ...steps.keys())
  /** 带普通工具调用的步（只含意图调用的不算）。 */
  const hasWorkCalls = (state: StepState) =>
    state.toolCalls.length > 0 && !state.toolCalls.every((c) => isIntentCall(c.name))

  async function handle(e: RunEvent): Promise<void> {
    switch (e.t) {
      case 'model_responded': {
        const state = stepState(e.step)
        state.responded = true
        state.text = e.response.text
        if (e.response.reasoning) state.reasoning = e.response.reasoning
        state.toolCalls = e.response.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          input: c.input,
        }))
        for (const call of state.toolCalls) {
          stepOfCall.set(call.id, e.step)
          callbacks.onToolCall(messageId, call.id, call.name, call.input, e.step, e.at)
        }
        record(e.response.usage)
        return
      }
      case 'external_call':
        if (e.kind === 'model') record(e.usage)
        return
      case 'model_aborted': {
        const state = stepState(e.step)
        if (!state.responded) state.text = e.partialText
        return
      }
      case 'tool_finished': {
        const step = stepOfCall.get(e.callId)
        if (step === undefined) return
        const state = stepState(step)
        const shown = textOf(await opts.getBlob(e.shown))
        state.results.set(e.callId, { shown, isError: e.isError })
        const name = state.toolCalls.find((c) => c.id === e.callId)?.name ?? ''
        const body = toolOutputBody(shown)
        callbacks.onToolResult(
          messageId,
          e.callId,
          name,
          e.isError
            ? { __talor_error: true, code: e.errorCode ?? 'TOOL_ERROR', message: body }
            : body,
          e.durationMs,
        )
        return
      }
      case 'evaluated':
        stepState(e.step).verdict = verdictOf(e.verdict as unknown as Record<string, unknown>)
        return
      case 'step_ended': {
        const state = stepState(e.step)
        if (hasWorkCalls(state)) {
          flush(e.step, 'process')
        } else if (state.verdict === 'complete') {
          pendingDelivery = e.step
          callbacks.onRunStatus?.(messageId, 'verifying')
        } else if (state.verdict === 'continue' || state.verdict === 'finalize') {
          flush(e.step, 'process')
        } else {
          flush(e.step, 'answer')
        }
        return
      }
      case 'delivery_checked': {
        if (pendingDelivery === undefined) {
          log.debug('[projection] delivery_checked without pending step')
          return
        }
        const step = pendingDelivery
        pendingDelivery = undefined
        callbacks.onRunStatus?.(messageId, 'idle')
        flush(step, e.outcome === 'returned' || e.outcome === 'fallback' ? 'process' : 'answer')
        return
      }
      case 'fallback_generated': {
        const step = lastStep() + 1
        const state = stepState(step)
        state.persisted = true
        callbacks.onTextDelta(messageId, e.text, step)
        persist(step, [
          row('assistant', [
            { type: 'text', text: e.text, providerOptions: phaseMarker('answer') },
          ]),
        ])
        return
      }
      case 'run_ended':
        if (pendingDelivery !== undefined) {
          flush(pendingDelivery, 'answer')
          pendingDelivery = undefined
          callbacks.onRunStatus?.(messageId, 'idle')
        }
        for (const step of [...steps.keys()].sort((a, b) => a - b)) {
          flush(step, hasWorkCalls(steps.get(step)!) ? 'process' : 'answer')
        }
        return
      default:
        return
    }
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
    persistError: () => failure,
    recordedUsage: () => ({ ...recorded }),
  }
}
