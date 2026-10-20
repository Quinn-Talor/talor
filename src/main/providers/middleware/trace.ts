// src/main/providers/middleware/trace.ts —— 业务层: LLM 调用观测中间件
//
// 每次 doGenerate / doStream 尝试(含 SDK 重试)记一条 GENERATION observation:父节点与
// 名称取自 trace scope;输入记 prompt 消息与本次提供的工具定义(均去重存 blob);输出记文本、
// 推理文本与工具调用(含参数);流式下首个输出 chunk 记 completion_start_time,finish chunk 给
// usage 与 finishReason,response-metadata / stream-start 给响应 id、实际模型与告警;
// 异常记 ERROR,中止 / 取消记 WARNING + ABORTED。
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
    toolDefinitions: params.tools,
  })
}

interface ToolCallRecord {
  toolCallId: string
  toolName: string
  /** 模型给出的原始参数(JSON 字符串,不解析,保留畸形参数供排查) */
  input: string
}

/** GENERATION output:文本、推理文本(有才记)、工具调用及参数。 */
function generationOutput(
  text: string,
  reasoning: string,
  toolCalls: ToolCallRecord[],
): Record<string, unknown> {
  return { text, ...(reasoning.length > 0 ? { reasoning } : {}), tool_calls: toolCalls }
}

/** GENERATION metadata:结束原因、provider,以及有值才记的响应 id / 实际模型 / 告警。 */
function generationMetadata(
  model: WrappedModel,
  finishReason: string | null,
  response: { id?: string; modelId?: string } | undefined,
  warnings: readonly unknown[] | undefined,
): Record<string, unknown> {
  return {
    finish_reason: finishReason,
    provider: model.provider,
    ...(response?.id !== undefined ? { response_id: response.id } : {}),
    ...(response?.modelId !== undefined ? { response_model_id: response.modelId } : {}),
    ...(warnings !== undefined && warnings.length > 0 ? { warnings } : {}),
  }
}

function generateOutput(content: readonly unknown[]): Record<string, unknown> {
  let text = ''
  let reasoning = ''
  const toolCalls: ToolCallRecord[] = []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') text += part.text
    if (part.type === 'reasoning' && typeof part.text === 'string') reasoning += part.text
    if (
      part.type === 'tool-call' &&
      typeof part.toolCallId === 'string' &&
      typeof part.toolName === 'string'
    ) {
      toolCalls.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: typeof part.input === 'string' ? part.input : String(part.input),
      })
    }
  }
  return generationOutput(text, reasoning, toolCalls)
}

interface StreamAccumulator {
  firstOutputAt?: string
  text: string
  reasoning: string
  toolCalls: ToolCallRecord[]
  warnings?: readonly unknown[]
  response?: { id?: string; modelId?: string }
  finish?: FinishPart
  hasError: boolean
  error?: unknown
}

function observeChunk(acc: StreamAccumulator, chunk: StreamPart): void {
  if (acc.firstOutputAt === undefined && FIRST_OUTPUT_TYPES.has(chunk.type)) {
    acc.firstOutputAt = new Date().toISOString()
  }
  switch (chunk.type) {
    case 'stream-start':
      acc.warnings = chunk.warnings
      break
    case 'response-metadata':
      acc.response = { id: chunk.id, modelId: chunk.modelId }
      break
    case 'text-delta':
      acc.text += chunk.delta
      break
    case 'reasoning-delta':
      acc.reasoning += chunk.delta
      break
    case 'tool-call':
      acc.toolCalls.push({
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        input: chunk.input,
      })
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
        metadata: generationMetadata(
          model,
          result.finishReason?.unified ?? null,
          result.response,
          result.warnings,
        ),
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
    const acc: StreamAccumulator = { text: '', reasoning: '', toolCalls: [], hasError: false }
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
            output: generationOutput(acc.text, acc.reasoning, acc.toolCalls),
            usageDetails: toUsageDetails(acc.finish?.usage, acc.finish?.providerMetadata),
            level: acc.hasError ? 'ERROR' : 'DEFAULT',
            statusMessage: acc.hasError ? errorMessage(acc.error) : undefined,
            metadata: generationMetadata(
              model,
              acc.finish?.finishReason.unified ?? null,
              acc.response,
              acc.warnings,
            ),
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
