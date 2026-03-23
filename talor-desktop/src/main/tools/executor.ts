import type { LanguageModel } from 'ai'
import { dynamicTool } from 'ai'
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
  messages: Array<{ role: string; content: string }>
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
        const sdkModel = model as unknown as {
          doGenerate: (opts: {
            prompt: unknown
            tools?: unknown
            abortSignal?: AbortSignal
          }) => Promise<{
            text?: string
            finishReason: string
            toolCalls?: Array<{
              toolCallId: string
              toolName: string
              input: unknown
            }>
          }>
        }

        const result = await sdkModel.doGenerate({
          prompt: currentMessages,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          abortSignal,
        })

        if (result.text) {
          onChunk({ type: 'text-delta', text: result.text })
        }

        const toolCalls = result.toolCalls ?? []
        if (toolCalls.length === 0) {
          onChunk({ type: 'finish', finishReason: result.finishReason ?? 'stop' })
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
                await Promise.race([
                  toolRegistry.execute(tc.toolName, tc.input ?? {}, context),
                  timeoutPromise,
                ])
                const result = await toolRegistry.execute(tc.toolName, tc.input ?? {}, context)
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
            content: JSON.stringify(
              toolCalls.map((tc) => ({
                tool_call_id: tc.toolCallId,
                tool_name: tc.toolName,
                input: tc.input,
              })),
            ),
          }

          const toolMessage = {
            role: 'tool' as const,
            content: JSON.stringify(
              toolResults.map((r) => ({
                tool_call_id: r.toolCallId,
                content: r.isError ? `Error: ${r.result}` : String(r.result ?? ''),
              })),
            ),
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
