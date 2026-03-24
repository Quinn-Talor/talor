import type { LanguageModel } from 'ai'
import { dynamicTool } from 'ai'
import log from 'electron-log'
import { toolRegistry } from './registry'
import type { ToolExecuteContext } from './types'
import {
  DEFAULT_MAX_PARALLEL_TOOLS,
  DEFAULT_TOOL_TIMEOUT_MS,
} from './types'

export interface ToolCallChunk {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolResultChunk {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  result: unknown
}

export interface TextDeltaChunk {
  type: 'text-delta'
  text: string
}

export interface ErrorChunk {
  type: 'error'
  error: string
}

export interface FinishChunk {
  type: 'finish'
  finishReason: string
}

export type ExecutorChunk =
  | ToolCallChunk
  | ToolResultChunk
  | TextDeltaChunk
  | ErrorChunk
  | FinishChunk

export interface ExecuteOptions {
  model: LanguageModel
  messages: unknown[]
  context: ToolExecuteContext
  onChunk: (chunk: ExecutorChunk) => void
  maxIterations?: number
  abortSignal?: AbortSignal
}

const DEFAULT_MAX_ITERATIONS = 20

function chunkArray<T>(arr: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    groups.push(arr.slice(i, i + size))
  }
  return groups
}

export const toolExecutor = {
  async executeStream(options: ExecuteOptions): Promise<void> {
    const {
      model,
      messages,
      context,
      onChunk,
      maxIterations = DEFAULT_MAX_ITERATIONS,
      abortSignal,
    } = options

    const schemas = toolRegistry.getAllSchemas()

    const sdkTools = schemas.reduce(
      (acc, schema) => {
        const toolDef = toolRegistry.getTool(schema.name)
        if (!toolDef) return acc
        acc[schema.name] = dynamicTool({
          description: schema.description,
          inputSchema: schema.parameters as Parameters<typeof dynamicTool>[0]['inputSchema'],
          execute: async (input: unknown) => {
            const result = await toolRegistry.execute(schema.name, input, context)
            return result.output ?? null
          },
        })
        return acc
      },
      {} as Record<string, ReturnType<typeof dynamicTool>>,
    )

    let iteration = 0
    let currentMessages = [...messages]

    while (iteration < maxIterations) {
      iteration++

      try {
        type ContentPart =
          | { type: 'text'; text: string }
          | { type: 'reasoning'; text: string }
          | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }

        const sdkModel = model as unknown as {
          doGenerate: (opts: {
            prompt: unknown
            tools?: unknown
            abortSignal?: AbortSignal
          }) => Promise<{
            content: ContentPart[]
            finishReason: { unified: string; raw: string } | string
          }>
        }

        const rawToolsForDoGenerate =
          schemas.length > 0
            ? schemas.map((schema) => ({
                type: 'function' as const,
                name: schema.name,
                description: schema.description,
                parameters: schema.parameters,
              }))
            : undefined

        const result = await sdkModel.doGenerate({
          prompt: currentMessages,
          tools: rawToolsForDoGenerate,
          abortSignal,
        })

        const content = result.content ?? []
        log.info('[Executor] doGenerate result content:', JSON.stringify(content))
        log.info('[Executor] doGenerate finishReason:', JSON.stringify(result.finishReason))
        const finishReasonStr =
          typeof result.finishReason === 'object'
            ? result.finishReason.unified
            : (result.finishReason ?? 'stop')

        for (const part of content) {
          if (part.type === 'text' && part.text) {
            onChunk({ type: 'text-delta', text: part.text })
          }
        }

        const toolCalls = content.filter(
          (p): p is { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown } =>
            p.type === 'tool-call',
        )
        if (toolCalls.length === 0) {
          onChunk({ type: 'finish', finishReason: finishReasonStr })
          return
        }

        const maxParallel = context.maxParallelTools ?? DEFAULT_MAX_PARALLEL_TOOLS
        const batches = chunkArray(toolCalls, maxParallel)

        for (const batch of batches) {
          const toolCallChunks: ToolCallChunk[] = batch.map((tc) => ({
            type: 'tool-call' as const,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            input: tc.input,
          }))

          for (const chunk of toolCallChunks) {
            onChunk(chunk)
          }

          const toolResults = await Promise.all(
            batch.map(async (tc) => {
              const timeoutMs = context.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error(`Tool ${tc.toolName} timed out after ${timeoutMs}ms`)),
                  timeoutMs,
                ),
              )
              try {
                const parsedInput = (() => {
                  if (typeof tc.input === 'string') {
                    try { return JSON.parse(tc.input) } catch { return {} }
                  }
                  return tc.input ?? {}
                })()
                const result = await Promise.race([
                  toolRegistry.execute(tc.toolName, parsedInput, context),
                  timeoutPromise,
                ])
                return {
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  result: result.output ?? result.error ?? null,
                  isError: !!result.error,
                }
              } catch (err) {
                return {
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  result: err instanceof Error ? err.message : String(err),
                  isError: true,
                }
              }
            }),
          )

          const assistantMessage = {
            role: 'assistant' as const,
            content: toolCalls.map((tc) => ({
              type: 'tool-call' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: (() => {
                if (typeof tc.input === 'string') {
                  try { return JSON.parse(tc.input) } catch { return tc.input }
                }
                return tc.input
              })(),
            })),
          }

          const toolMessage = {
            role: 'tool' as const,
            content: toolResults.map((r) => ({
              type: 'tool-result' as const,
              toolCallId: r.toolCallId,
              toolName: r.toolName,
              output: {
                type: r.isError ? ('error-text' as const) : ('text' as const),
                value: r.isError ? `Error: ${r.result}` : String(r.result ?? ''),
              },
            })),
          }

          currentMessages = [...currentMessages, assistantMessage, toolMessage]
        }
      } catch (err) {
        onChunk({
          type: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        onChunk({ type: 'finish', finishReason: 'error' })
        return
      }
    }

    onChunk({ type: 'finish', finishReason: 'max-iterations' })
  },
}
