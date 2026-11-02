// src/main/runtime/task.ts — 业务层：会话组装成 agent-engine 的任务
//
// messages 表 → 引擎消息（history），并修复工具调用的成对：每个工具调用后面紧跟它的全部结果，
// 缺的补 TOOL_MISSING_RESULT 错误结果，前面没有调用的结果丢弃。本轮输入、易变信息（日期、
// 操作系统、工作区）、作业范围、会话 id 与步数上限组装成任务。
//
// 允许依赖: agent-engine、ai（类型）、repos/session-repo（类型）
// 禁止依赖: ipc/*、db/*

import type { UserContent } from 'ai'
import {
  defineTask,
  type ContentPart,
  type ModelMessage,
  type ReasoningPart,
  type Segment,
  type Task,
  type TextPart,
  type ToolCallPart,
  type ToolResultPart,
} from 'agent-engine'
import type { ChatMessage } from '../repos/session-repo'

const MISSING_RESULT = 'ERROR [TOOL_MISSING_RESULT]: 没有记录到这次调用的结果'

type Part = Record<string, unknown>

const isPart = (value: unknown): value is Part =>
  value !== null && typeof value === 'object' && typeof (value as Part).type === 'string'

const partsOf = (content: unknown): Part[] => (Array.isArray(content) ? content.filter(isPart) : [])

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function parseContent(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function userPartsOf(content: UserContent): ContentPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return partsOf(content).flatMap((part): ContentPart[] => {
    if (part.type === 'text') return [{ type: 'text', text: str(part.text) }]
    if (part.type === 'image' && typeof part.image === 'string') {
      return [
        {
          type: 'image',
          image: part.image,
          ...(typeof part.mediaType === 'string' ? { mediaType: part.mediaType } : {}),
        },
      ]
    }
    if (part.type === 'file' && typeof part.data === 'string') {
      return [
        {
          type: 'file',
          data: part.data,
          mediaType: str(part.mediaType),
          ...(typeof part.filename === 'string' ? { filename: part.filename } : {}),
        },
      ]
    }
    return []
  })
}

function assistantPartsOf(content: unknown): Array<TextPart | ReasoningPart | ToolCallPart> {
  return partsOf(content).flatMap((part): Array<TextPart | ReasoningPart | ToolCallPart> => {
    if (part.type === 'text') return [{ type: 'text', text: str(part.text) }]
    if (part.type === 'reasoning') {
      return [
        {
          type: 'reasoning',
          text: str(part.text),
          ...(part.providerOptions !== undefined ? { providerData: part.providerOptions } : {}),
        },
      ]
    }
    if (part.type === 'tool-call') {
      return [
        {
          type: 'tool-call',
          toolCallId: str(part.toolCallId),
          toolName: str(part.toolName),
          input: part.input,
        },
      ]
    }
    return []
  })
}

/** AI SDK 的工具结果输出 → 引擎看到的字符串；error-* 为失败。 */
function outputOf(output: unknown): { text: string; error: boolean } {
  if (!isPart(output)) return { text: typeof output === 'string' ? output : '', error: false }
  const error = output.type === 'error-text' || output.type === 'error-json'
  const text =
    output.type === 'text' || output.type === 'error-text'
      ? str(output.value)
      : JSON.stringify(output.value ?? null)
  return { text, error }
}

function toolResultsOf(content: unknown): ToolResultPart[] {
  return partsOf(content)
    .filter((part) => part.type === 'tool-result')
    .map((part) => {
      const { text, error } = outputOf(part.output)
      return {
        type: 'tool-result',
        toolCallId: str(part.toolCallId),
        toolName: str(part.toolName),
        output: text,
        isError: error || part.isError === true,
      }
    })
}

function messageOf(row: ChatMessage): ModelMessage {
  const content = parseContent(row.content)
  switch (row.role) {
    case 'system':
      return {
        role: 'system',
        content:
          typeof content === 'string'
            ? content
            : partsOf(content)
                .filter((p) => p.type === 'text')
                .map((p) => str(p.text))
                .join('\n'),
      }
    case 'user':
      return {
        role: 'user',
        content: typeof content === 'string' ? content : userPartsOf(content as UserContent),
      }
    case 'assistant':
      return {
        role: 'assistant',
        content: typeof content === 'string' ? content : assistantPartsOf(content),
      }
    case 'tool':
      return { role: 'tool', content: toolResultsOf(content) }
  }
}

/** 每个工具调用后面紧跟它的全部结果；缺的补错误结果，没有调用的结果丢弃。 */
function repairPairs(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.role === 'tool') continue
    out.push(message)
    if (message.role !== 'assistant' || typeof message.content === 'string') continue
    const calls = message.content.filter((p): p is ToolCallPart => p.type === 'tool-call')
    if (calls.length === 0) continue
    const next = messages[i + 1]
    const given = next?.role === 'tool' ? next.content : []
    if (next?.role === 'tool') i++
    const byId = new Map(given.map((r) => [r.toolCallId, r]))
    out.push({
      role: 'tool',
      content: calls.map(
        (c): ToolResultPart =>
          byId.get(c.toolCallId) ?? {
            type: 'tool-result',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            output: MISSING_RESULT,
            isError: true,
          },
      ),
    })
  }
  return out
}

/** 提示消息（content_type 'notice'）只给用户看，不进模型输入。 */
export function historyOf(rows: ChatMessage[]): ModelMessage[] {
  return repairPairs(rows.filter((r) => r.content_type !== 'notice').map(messageOf))
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function volatileOf(workspace: string, now: Date): Segment[] {
  const text = [
    `Current date: ${localDate(now)}`,
    `Operating system: ${process.platform}`,
    `Workspace: ${workspace || '(not set)'}`,
  ].join('\n')
  return [{ role: 'system', parts: [{ type: 'text', text }] }]
}

export function taskFor(input: {
  sessionId: string
  workspace: string
  userContent: UserContent
  history: ModelMessage[]
  maxSteps?: number
  now: Date
}): Task {
  const { sessionId, workspace, maxSteps } = input
  return defineTask({
    input: [{ role: 'user', parts: userPartsOf(input.userContent) }],
    history: input.history,
    volatile: volatileOf(workspace, input.now),
    ...(workspace ? { scope: { workspace } } : {}),
    subject: sessionId,
    ...(maxSteps !== undefined && maxSteps > 0 ? { budget: { maxSteps } } : {}),
  })
}
