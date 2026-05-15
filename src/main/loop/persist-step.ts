// src/main/loop/persist-step.ts —— 业务层: SDK StepResult → DB 持久化
//
// 主循环 runReactStep 完成一次 streamText 后, 把 StepResult 转成
// AssistantContent + ToolContent 配对 (或单条 assistant text), 落库。
//
// 关键约束:
//   - assistant(tool_use) + tool(result) 必须同事务 (createBatch), 不能拆两次 create —
//     否则下次 rebuild prompt 时 SDK 抛 "Every tool_use must have a tool_result"
//     破坏 session 不变量
//   - tool result 落库前要 wrapToolOutput + truncate (skill 1MB / 其他 8KB)
//
// 允许依赖: ./stream-utils, ../repos/session-repo, ./step-adapter
// 禁止依赖: ipc/*, ai/* (除 type)

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type { StepResult, ToolSet, AssistantContent, ToolContent } from 'ai'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import { extractOutputText, truncateOutput, wrapToolOutput, isErrorOutput } from './stream-utils'
import {
  extractTextFromStep,
  extractReasoningFromStep,
  toolCallsFromStep,
  toolResultsFromStep,
} from './step-adapter'

export interface PersistStepOpts {
  sessionId: string
  agentId: string
  /**
   * orchestrator 预生成的 wire id, 用于流式 chat:stream 协议关联消息。落库 id
   * 当前一律用 uuid, 此字段保留以便将来 FINAL step 想用稳定 id 时改造。
   */
  finalMessageId?: string
  /**
   * 标记本步为 turn 内的 mid-turn text 而非 FINAL text。当前 react-loop 总传 true,
   * FINAL 决策完全由主循环的 turn-end policy 做; 此字段控制 fallback 到 finalMessageId
   * 的逻辑 — false 时若无 tool 且有 text 才用 finalMessageId。
   */
  isMidTurnText?: boolean
}

/**
 * 从 SDK StepResult 落一条 (text only) 或两条 (assistant + tool) 消息。
 *
 * 返回 { kind, persistedAssistantId, persistedToolId? } 供调用方做后续 UI / detector 计费。
 *
 * 异常: 持久化失败往上抛 — react-loop 主循环 try/catch 决定是否兜底。
 */
export async function persistStepFromResult(
  step: StepResult<ToolSet>,
  opts: PersistStepOpts,
): Promise<{
  kind: 'text-only' | 'tool-pair' | 'empty'
  assistantId?: string
  toolId?: string
}> {
  const text = extractTextFromStep(step)
  const reasoning = extractReasoningFromStep(step)
  const toolCalls = toolCallsFromStep(step)
  const toolResults = toolResultsFromStep(step)

  // 无工具 + 无文本 — 不落库 (empty step, runReactLoop 决定 fallback summary)
  if (toolCalls.length === 0 && !text) {
    return { kind: 'empty' }
  }

  // 无工具 + 有文本 — 落一条 assistant
  if (toolCalls.length === 0) {
    const parts: AssistantContent = []
    if (reasoning) parts.push({ type: 'reasoning', text: reasoning })
    parts.push({ type: 'text', text })
    const id = opts.isMidTurnText ? uuidv4() : (opts.finalMessageId ?? uuidv4())
    messageRepo.create({
      id,
      session_id: opts.sessionId,
      role: 'assistant',
      content: parts,
      agent_id: opts.agentId,
    })
    sessionRepo.touch(opts.sessionId)
    return { kind: 'text-only', assistantId: id }
  }

  // 有工具调用 — assistant(tool_use) + tool(result) 配对事务
  const assistantParts: AssistantContent = []
  if (reasoning) assistantParts.push({ type: 'reasoning', text: reasoning })
  if (text) assistantParts.push({ type: 'text', text })
  for (const tc of toolCalls) {
    assistantParts.push({
      type: 'tool-call',
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    })
  }

  const toolParts: ToolContent = toolResults.map((tr) => {
    const rawText = extractOutputText(tr.output)
    const truncated =
      tr.toolName === 'skill' ? rawText.slice(0, 1_000_000) : truncateOutput(rawText)
    return {
      type: 'tool-result' as const,
      toolCallId: tr.toolCallId,
      toolName: tr.toolName,
      output: {
        type: 'text' as const,
        value: wrapToolOutput(tr.toolName, truncated, tr.toolName === 'skill'),
      },
      isError: isErrorOutput(tr.output),
    }
  })

  const assistantId = uuidv4()
  const toolId = uuidv4()
  messageRepo.createBatch([
    {
      id: assistantId,
      session_id: opts.sessionId,
      role: 'assistant',
      content: assistantParts,
      agent_id: opts.agentId,
    },
    {
      id: toolId,
      session_id: opts.sessionId,
      role: 'tool',
      content: toolParts,
      agent_id: opts.agentId,
    },
  ])
  sessionRepo.touch(opts.sessionId)
  log.info(
    `[ReactLoop]   → persist: assistant(${text ? 'text+' : ''}tool_use×${toolCalls.length}) + tool(result×${toolResults.length}) [tx]`,
  )
  return { kind: 'tool-pair', assistantId, toolId }
}

/**
 * 异常路径: streamText 抛错时, 把当步已累计的 text/toolCalls 尽力落一条 aborted 消息。
 * 不抛任何异常 — 仅 best-effort。
 */
export async function persistAbortedStep(
  opts: PersistStepOpts & { stepText: string; toolCallNames: string[] },
): Promise<void> {
  const parts: AssistantContent = []
  const abortTag =
    opts.toolCallNames.length > 0
      ? `\n\n[step interrupted: tool results not returned]`
      : `\n\n[step interrupted]`
  if (opts.stepText) {
    parts.push({ type: 'text', text: `${opts.stepText}${abortTag}` })
  } else {
    parts.push({ type: 'text', text: abortTag.trimStart() })
  }
  if (opts.toolCallNames.length > 0) {
    parts.push({
      type: 'text',
      text: `[tools invoked this step: ${opts.toolCallNames.join(', ')} — no results returned]`,
    })
  }
  try {
    messageRepo.create({
      id: uuidv4(),
      session_id: opts.sessionId,
      role: 'assistant',
      content: parts,
      agent_id: opts.agentId,
    })
    sessionRepo.touch(opts.sessionId)
    log.info(`[ReactLoop]   partial aborted step persisted (${parts.length} parts)`)
  } catch (err) {
    log.error('[ReactLoop]   failed to persist partial aborted step:', err)
  }
}
