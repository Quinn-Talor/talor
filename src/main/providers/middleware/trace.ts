// src/main/providers/middleware/trace.ts —— 业务层: LLM 调用观测中间件
//
// 每次 doGenerate / doStream 尝试(含 SDK 重试)记一条 GENERATION observation:父节点与
// 名称取自 trace scope;流式下首个输出 chunk 记 completion_start_time,finish chunk 给
// usage 与 finishReason;异常记 ERROR,中止 / 取消记 WARNING + ABORTED。
// 无 trace scope 时直接透传;chunk 原样透传,不改变模型行为。
//
// 允许依赖: ai(类型), ../../observe/*, ../usage-normalizer
// 禁止依赖: ipc/*

import type { LanguageModelMiddleware } from 'ai'
import { currentScope } from '../../observe/trace-context'
import { traceRecorder, type EndObservationInput } from '../../observe/trace-recorder'
import { errorMessage, isRecord } from '../../observe/value-utils'
import { normalizeUsage } from '../usage-normalizer'

type WrapStreamOptions = Parameters<NonNullable<LanguageModelMiddleware['wrapStream']>>[0]
type CallOptions = WrapStreamOptions['params']
type WrappedModel = WrapStreamOptions['model']
type StreamResult = Awaited<ReturnType<WrapStreamOptions['doStream']>>
type StreamPart = StreamResult['stream'] extends ReadableStream<infer P> ? P : never
type FinishPart = Extract<StreamPart, { type: 'finish' }>

const DEFAULT_GENERATION_NAME = 'llm'
const FIRST_OUTPUT_TYPES = new Set([
  'text-delta',
  'reasoning-delta',
  'tool-input-start',
  'tool-call',
])
const ABORTED: EndObservationInput = { level: 'WARNING', statusMessage: 'ABORTED' }

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function num(v: unknown): number {
  return isFiniteNumber(v) ? v : 0
}

function finiteOrUndefined(v: unknown): number | undefined {
  return isFiniteNumber(v) ? v : undefined
}

function isAbort(e: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (e instanceof Error && e.name === 'AbortError')
}

function failure(e: unknown, signal: AbortSignal | undefined): EndObservationInput {
  return isAbort(e, signal) ? ABORTED : { level: 'ERROR', statusMessage: errorMessage(e) }
}

/**
 * SDK V4 usage → Langfuse usage_details(五桶互不重叠 + total,BR-003)。
 * 输入侧(input 不含缓存读写)与 session token 统计同走 normalizeUsage(含 providerMetadata
 * 兜底),两边口径一致;output 不含 reasoning,缺 text 时用 total 减 reasoning。
 */
export function toUsageDetails(
  usage: unknown,
  providerMetadata?: unknown,
): Record<string, number> | undefined {
  if (!isRecord(usage)) return undefined
  const inTok = isRecord(usage.inputTokens) ? usage.inputTokens : {}
  const outTok = isRecord(usage.outputTokens) ? usage.outputTokens : {}
  const normalized = normalizeUsage(
    {
      inputTokens: finiteOrUndefined(inTok.total),
      inputTokenDetails: {
        noCacheTokens: finiteOrUndefined(inTok.noCache),
        cacheReadTokens: finiteOrUndefined(inTok.cacheRead),
        cacheWriteTokens: finiteOrUndefined(inTok.cacheWrite),
      },
    },
    isRecord(providerMetadata) ? providerMetadata : undefined,
  )
  const input = normalized.inputTokens
  const cacheRead = normalized.cacheReadTokens
  const cacheWrite = normalized.cacheWriteTokens
  const reasoning = num(outTok.reasoning)
  const output = isFiniteNumber(outTok.text)
    ? outTok.text
    : Math.max(0, num(outTok.total) - reasoning)
  return {
    input,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output,
    output_reasoning_tokens: reasoning,
    total: input + cacheRead + cacheWrite + output + reasoning,
  }
}

function pickParams(params: CallOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {
    toolCount: params.tools?.length ?? 0,
    providerOptions: params.providerOptions ?? null,
  }
  if (params.maxOutputTokens !== undefined) out.maxOutputTokens = params.maxOutputTokens
  if (params.temperature !== undefined) out.temperature = params.temperature
  if (params.topP !== undefined) out.topP = params.topP
  if (params.topK !== undefined) out.topK = params.topK
  if (params.reasoning !== undefined) out.reasoning = params.reasoning
  return out
}

function startGeneration(params: CallOptions, model: WrappedModel) {
  return traceRecorder.startObservation({
    type: 'GENERATION',
    name: currentScope()?.generationName ?? DEFAULT_GENERATION_NAME,
    model: model.modelId,
    modelParameters: pickParams(params),
    promptMessages: params.prompt,
  })
}

function generateOutput(content: readonly unknown[]): {
  text: string
  tool_calls: Array<{ toolCallId: string; toolName: string }>
} {
  let text = ''
  const toolCalls: Array<{ toolCallId: string; toolName: string }> = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') text += part.text
    if (
      part.type === 'tool-call' &&
      typeof part.toolCallId === 'string' &&
      typeof part.toolName === 'string'
    ) {
      toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName })
    }
  }
  return { text, tool_calls: toolCalls }
}

interface StreamAccumulator {
  firstOutputAt?: string
  text: string
  toolCalls: Array<{ toolCallId: string; toolName: string }>
  finish?: FinishPart
  hasError: boolean
  error?: unknown
}

function observeChunk(acc: StreamAccumulator, chunk: StreamPart): void {
  if (acc.firstOutputAt === undefined && FIRST_OUTPUT_TYPES.has(chunk.type)) {
    acc.firstOutputAt = new Date().toISOString()
  }
  switch (chunk.type) {
    case 'text-delta':
      acc.text += chunk.delta
      break
    case 'tool-call':
      acc.toolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName })
      break
    case 'finish':
      acc.finish = chunk
      break
    case 'error':
      acc.hasError = true
      acc.error = chunk.error
      break
  }
}

export const traceMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',

  async wrapGenerate({ doGenerate, params, model }) {
    const h = startGeneration(params, model)
    if (h.ref === null) return doGenerate()
    try {
      const result = await doGenerate()
      h.end({
        output: generateOutput(result.content),
        usageDetails: toUsageDetails(result.usage, result.providerMetadata),
        metadata: { finish_reason: result.finishReason?.unified ?? null, provider: model.provider },
      })
      return result
    } catch (e) {
      h.end(failure(e, params.abortSignal))
      throw e
    }
  },

  async wrapStream({ doStream, params, model }) {
    const h = startGeneration(params, model)
    if (h.ref === null) return doStream()
    const signal = params.abortSignal
    const onAbort = (): void => h.end(ABORTED)
    signal?.addEventListener('abort', onAbort, { once: true })
    const detach = (): void => signal?.removeEventListener('abort', onAbort)

    let result: StreamResult
    try {
      result = await doStream()
    } catch (e) {
      detach()
      h.end(failure(e, signal))
      throw e
    }

    const reader = result.stream.getReader()
    const acc: StreamAccumulator = { text: '', toolCalls: [], hasError: false }
    const stream = new ReadableStream<StreamPart>({
      async pull(controller) {
        let next: Awaited<ReturnType<typeof reader.read>>
        try {
          next = await reader.read()
        } catch (e) {
          detach()
          h.end(failure(e, signal))
          controller.error(e)
          return
        }
        if (next.done) {
          detach()
          h.end({
            completionStartTime: acc.firstOutputAt,
            output: { text: acc.text, tool_calls: acc.toolCalls },
            usageDetails: toUsageDetails(acc.finish?.usage, acc.finish?.providerMetadata),
            level: acc.hasError ? 'ERROR' : 'DEFAULT',
            statusMessage: acc.hasError ? errorMessage(acc.error) : undefined,
            metadata: {
              finish_reason: acc.finish?.finishReason.unified ?? null,
              provider: model.provider,
            },
          })
          controller.close()
          return
        }
        observeChunk(acc, next.value)
        controller.enqueue(next.value)
      },
      cancel(reason) {
        detach()
        h.end(ABORTED)
        return reader.cancel(reason)
      },
    })
    return { ...result, stream }
  },
}
