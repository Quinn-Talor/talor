// src/main/loop/react-loop.ts
import { streamText } from 'ai'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { toolResultPartsToBlocks, buildStreamSignal } from '../ipc/chat-utils'
import type { ReactLoopOptions } from './types'
import type { ContentBlock } from '@shared/types/message'

const DEFAULT_MAX_STEPS = 30

export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const {
    model,
    tools,
    sessionId,
    messageId,
    userContent,
    mappedAttachments,
    abortSignal,
    pipeline,
    provider,
    providerConfig,
    workspace,
    callbacks,
    maxSteps = DEFAULT_MAX_STEPS,
  } = opts

  let fullText = ''
  let wroteAssistantFinal = false

  for (let step = 0; step < maxSteps; step++) {
    if (abortSignal.aborted) break

    const pipelineCtx = {
      sessionId,
      currentMessage: { text: userContent, attachments: mappedAttachments },
      provider,
      providerConfig,
      workspacePath: workspace || undefined,
    }
    const { messages: currentMessages } = await pipeline.build(pipelineCtx)
    log.info(`[ReactLoop] step ${step + 1}/${maxSteps}, messages: ${currentMessages.length}`)

    const stepToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = []
    let stepText = ''

    const result = streamText({
      model,
      messages: currentMessages,
      tools,
      abortSignal: buildStreamSignal(abortSignal),
      onChunk({ chunk }) {
        if (chunk.type === 'text-delta') {
          fullText += chunk.text
          stepText += chunk.text
          if (chunk.text.length > 0) callbacks.onTextDelta(chunk.text)
        } else if (chunk.type === 'tool-call') {
          stepToolCalls.push({ toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: chunk.input })
          callbacks.onToolCall(chunk.toolCallId, chunk.toolName, chunk.input)
        } else if (chunk.type === 'tool-result') {
          callbacks.onToolResult(chunk.toolCallId, chunk.toolName, chunk.output)
        }
      },
      onError({ error }) {
        log.error('[ReactLoop] Stream error:', error)
      },
    })

    await result.consumeStream()
    log.info(`[ReactLoop] consumed, toolCalls: ${stepToolCalls.length}, fullText: ${fullText.length}`)

    if (stepToolCalls.length === 0) {
      if (stepText) {
        messageRepo.create({
          id: messageId,
          session_id: sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: stepText }],
        })
        sessionRepo.touch(sessionId)
        wroteAssistantFinal = true
      }
      break
    }

    const toolResults = await result.toolResults
    if (toolResults.length === 0) {
      log.error('[ReactLoop] Tool calls made but no results returned, breaking')
      break
    }

    const assistantBlocks: ContentBlock[] = []
    if (stepText) assistantBlocks.push({ type: 'text', text: stepText })
    for (const tc of stepToolCalls) {
      assistantBlocks.push({ type: 'tool_use', toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.input })
    }
    messageRepo.create({ id: uuidv4(), session_id: sessionId, role: 'assistant', content: assistantBlocks })

    const toolBlocks: ContentBlock[] = toolResultPartsToBlocks(toolResults)
    messageRepo.create({ id: uuidv4(), session_id: sessionId, role: 'tool', content: toolBlocks })

    log.info(`[ReactLoop] Persisted assistant + tool messages for step ${step + 1}`)
  }

  // 兜底：循环结束但无任何文本输出 → 强制一次无工具摘要步
  if (!wroteAssistantFinal && fullText.length === 0) {
    log.info('[ReactLoop] No final text, requesting forced summary')
    try {
      const summaryCtx = {
        sessionId,
        currentMessage: { text: userContent, attachments: mappedAttachments },
        provider,
        providerConfig,
        workspacePath: workspace || undefined,
      }
      const { messages: summaryMessages } = await pipeline.build(summaryCtx)
      const summaryResult = streamText({
        model,
        messages: summaryMessages,
        abortSignal: buildStreamSignal(abortSignal),
      })
      let summaryText = ''
      for await (const chunk of summaryResult.textStream) {
        summaryText += chunk
        callbacks.onTextDelta(chunk)
      }
      if (summaryText.trim()) {
        messageRepo.create({
          id: uuidv4(),
          session_id: sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: summaryText }],
        })
        log.info('[ReactLoop] Forced summary written, length:', summaryText.length)
      }
    } catch (err) {
      log.error('[ReactLoop] Forced summary failed:', err)
    }
  }
}
