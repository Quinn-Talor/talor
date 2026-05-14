// src/main/loop/test-helpers/mock-stream-text.ts —— 测试 helper: 模拟 AI SDK streamText 多步行为
//
// v4 react-loop 改用 SDK 内置多步 (一次 streamText 调用内 SDK 自动跑 N 步).
// 测试 mock 必须能驱动:
//   - 每步: onChunk (text-delta), experimental_onToolCallStart/Finish, onStepFinish
//   - 每步前: prepareStep (allowing message modification)
//   - 每步后: stopWhen 检查 (数组中任一返 true 即终止)
//   - 结束: onFinish, result.steps / toolResults / finishReason / usage / warnings 等 promise
//
// 使用:
//   mockStreamText.mockImplementation(driveStreamText([
//     { text: 'hello', toolCalls: [...], toolResults: [...] },
//     { text: '', finishReason: 'stop' },
//   ]))
//
// 关键: 步与步之间 stopWhen 检查; 命中即不再继续 (但已 mock 的步若超出会被 skip)

import { vi } from 'vitest'
import type { StepResult, ToolSet } from 'ai'

export interface MockStep {
  /** 纯文本输出 (累计 onChunk text-delta) */
  text?: string
  /** reasoning 输出 (onChunk reasoning-delta) */
  reasoning?: string
  /** 工具调用 (experimental_onToolCallStart 触发) */
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
  /** 工具结果 (experimental_onToolCallFinish 触发, success 推断自 isError) */
  toolResults?: Array<{
    toolCallId: string
    toolName: string
    output: unknown
    isError?: boolean
    durationMs?: number
  }>
  /** SDK 报告的 finishReason ('stop' 默认) */
  finishReason?: import('ai').FinishReason
  /** SDK usage 报告 */
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  /** SDK warnings (CallWarning[]) */
  warnings?: Array<{ type?: string; message?: string } & Record<string, unknown>>
  /** SDK provider metadata (e.g. anthropic cache 信号) */
  providerMetadata?: Record<string, unknown>
}

type StreamTextMockParams = {
  onChunk?: (arg: { chunk: { type: string; text?: string } }) => void
  experimental_onToolCallStart?: (event: {
    toolCall: { toolCallId: string; toolName: string; input: unknown }
  }) => void
  experimental_onToolCallFinish?: (
    event:
      | {
          toolCall: { toolCallId: string; toolName: string; input: unknown }
          durationMs: number
          success: true
          output: unknown
        }
      | {
          toolCall: { toolCallId: string; toolName: string; input: unknown }
          durationMs: number
          success: false
          error: unknown
        },
  ) => void
  onStepFinish?: (event: StepResult<ToolSet>) => void | Promise<void>
  onFinish?: (event: {
    finishReason: import('ai').FinishReason
    usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
    warnings?: unknown[]
    steps: StepResult<ToolSet>[]
    totalUsage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  }) => void | Promise<void>
  onError?: (event: { error: unknown }) => void
  prepareStep?: (options: {
    stepNumber: number
    steps: StepResult<ToolSet>[]
    messages: unknown[]
    model: unknown
  }) => unknown | Promise<unknown>
  stopWhen?:
    | ((opts: { steps: StepResult<ToolSet>[] }) => boolean | PromiseLike<boolean>)
    | Array<(opts: { steps: StepResult<ToolSet>[] }) => boolean | PromiseLike<boolean>>
  messages?: unknown[]
  model?: unknown
}

/**
 * 构造一个 StepResult 实例 (mock 用).
 *
 * 真实 StepResult 字段众多, 这里只填 v4 react-loop 实际消费的字段:
 *   text / reasoning(Text) / toolCalls / toolResults / finishReason / usage / warnings /
 *   providerMetadata.
 * 其余字段填空数组 / undefined / null, 类型断言成 StepResult。
 */
export function makeStepResult(step: MockStep): StepResult<ToolSet> {
  return {
    text: step.text ?? '',
    reasoningText: step.reasoning,
    reasoning: step.reasoning ? [{ type: 'reasoning', text: step.reasoning }] : [],
    toolCalls: (step.toolCalls ?? []) as unknown as StepResult<ToolSet>['toolCalls'],
    toolResults: (step.toolResults ?? []).map((tr) => ({
      toolCallId: tr.toolCallId,
      toolName: tr.toolName,
      output: tr.output,
    })) as unknown as StepResult<ToolSet>['toolResults'],
    finishReason: step.finishReason ?? 'stop',
    usage: (step.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) as never,
    warnings: step.warnings as never,
    providerMetadata: step.providerMetadata as never,
    content: [],
    files: [],
    sources: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    staticToolResults: [],
    dynamicToolResults: [],
    rawFinishReason: undefined,
    request: {} as never,
    response: { messages: [] } as never,
  } as unknown as StepResult<ToolSet>
}

/**
 * 构造 streamText mock 实现: 驱动给定 steps 数组按顺序通过所有 lifecycle 回调。
 *
 * 每步执行顺序:
 *   1. await prepareStep({ stepNumber, steps: previousCompleted, messages, model })
 *   2. onChunk(text-delta) — 一次性 flush (mock 简化, 不分多 chunk)
 *   3. onChunk(reasoning-delta) — 同上
 *   4. for each toolCall: experimental_onToolCallStart + experimental_onToolCallFinish
 *   5. await onStepFinish(stepResult)
 *   6. check stopWhen (any → break)
 *
 * 结束:
 *   - onFinish(aggregate)
 *   - 返回 { consumeStream, steps, toolResults, finishReason, usage, warnings, providerMetadata }
 *
 * forced-summary 路径 (params 没有 onStepFinish / stopWhen, 只有 textStream / consumeStream):
 *   - 自动检测: 若 params 缺 onStepFinish, 视为 forced-summary 调用, 返 textStream-only result
 *   - 此时 firstStep.text 作为 textStream 输出
 */
export function driveStreamText(steps: MockStep[]): (params: StreamTextMockParams) => unknown {
  return (params) => {
    // forced-summary 路径检测: 缺 onStepFinish + 缺 stopWhen → textStream only
    const isForcedSummary = !params.onStepFinish && !params.stopWhen
    if (isForcedSummary) {
      const text = steps[0]?.text ?? ''
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        textStream: (async function* () {
          if (text) yield text
        })(),
      }
    }

    // SDK 多步路径
    const completedSteps: StepResult<ToolSet>[] = []
    const allToolResults: Array<{ toolCallId: string; toolName: string; output: unknown }> = []
    let aborted = false

    // 异步驱动: 把 stream 的"自然顺序"封装成一个 Promise (consumeStream 等它)
    const consumePromise = (async () => {
      for (let i = 0; i < steps.length; i++) {
        if (aborted) break
        const step = steps[i]

        // 1. prepareStep
        try {
          await params.prepareStep?.({
            stepNumber: i,
            steps: completedSteps,
            messages: params.messages ?? [],
            model: params.model,
          })
        } catch (err) {
          params.onError?.({ error: err })
        }

        // 2. onChunk text-delta
        if (step.text) {
          params.onChunk?.({ chunk: { type: 'text-delta', text: step.text } })
        }
        // 3. onChunk reasoning-delta
        if (step.reasoning) {
          params.onChunk?.({ chunk: { type: 'reasoning-delta', text: step.reasoning } })
        }

        // 4. tool lifecycle
        for (const tc of step.toolCalls ?? []) {
          params.experimental_onToolCallStart?.({ toolCall: tc })
          const result = step.toolResults?.find((tr) => tr.toolCallId === tc.toolCallId)
          if (result === undefined) {
            // 无 result — 当 success=false (空) 处理, 让 react-loop 走 SDK_TOOL_ERROR
            params.experimental_onToolCallFinish?.({
              toolCall: tc,
              durationMs: 1,
              success: false,
              error: 'no result mocked',
            })
            continue
          }
          if (result.isError) {
            params.experimental_onToolCallFinish?.({
              toolCall: tc,
              durationMs: result.durationMs ?? 1,
              success: false,
              error: result.output,
            })
          } else {
            params.experimental_onToolCallFinish?.({
              toolCall: tc,
              durationMs: result.durationMs ?? 1,
              success: true,
              output: result.output,
            })
            allToolResults.push({
              toolCallId: result.toolCallId,
              toolName: result.toolName,
              output: result.output,
            })
          }
        }

        // 5. onStepFinish
        const stepResult = makeStepResult(step)
        completedSteps.push(stepResult)
        await params.onStepFinish?.(stepResult)

        // 6. stopWhen
        const conditions = Array.isArray(params.stopWhen)
          ? params.stopWhen
          : params.stopWhen
            ? [params.stopWhen]
            : []
        for (const cond of conditions) {
          if (await cond({ steps: completedSteps })) {
            aborted = true
            break
          }
        }
      }

      // onFinish (aggregate)
      const totalUsage = completedSteps.reduce(
        (acc, s) => ({
          inputTokens: (acc.inputTokens ?? 0) + ((s.usage?.inputTokens as number) ?? 0),
          outputTokens: (acc.outputTokens ?? 0) + ((s.usage?.outputTokens as number) ?? 0),
          totalTokens: (acc.totalTokens ?? 0) + ((s.usage?.totalTokens as number) ?? 0),
        }),
        { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      )
      const last = completedSteps[completedSteps.length - 1]
      await params.onFinish?.({
        finishReason: last?.finishReason ?? 'stop',
        usage: totalUsage,
        warnings: undefined,
        steps: completedSteps,
        totalUsage,
      })
    })()

    return {
      consumeStream: vi.fn().mockImplementation(() => consumePromise),
      steps: consumePromise.then(() => completedSteps),
      toolResults: consumePromise.then(() => allToolResults),
      finishReason: consumePromise.then(
        () => completedSteps[completedSteps.length - 1]?.finishReason ?? 'stop',
      ),
      usage: consumePromise.then(() => completedSteps[completedSteps.length - 1]?.usage),
      warnings: consumePromise.then(
        () => completedSteps[completedSteps.length - 1]?.warnings ?? [],
      ),
      providerMetadata: consumePromise.then(
        () => completedSteps[completedSteps.length - 1]?.providerMetadata,
      ),
    }
  }
}

/**
 * 简化: 单步 mock — 等价于 driveStreamText([step])。
 */
export function singleStep(step: MockStep): (params: StreamTextMockParams) => unknown {
  return driveStreamText([step])
}
