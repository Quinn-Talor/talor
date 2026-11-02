// src/renderer/lib/intent-view.ts — 引擎写的、标为答复的 assistant 行里意图调用的显示信息
//
// 一条 assistant 行按意图卡片显示，当且仅当：阶段标记为 answer、所有调用都是意图工具、配对的结果都不是错误
// （C2 BR-002）。旧路径的行（没有阶段标记）与过程行返回 null，显示与改动前一致。
import { isIntentCall } from '@shared/intents'
import { phaseOfParts } from '@shared/turn-phase'

export type IntentView =
  | { kind: 'finish'; text: string; summary: string }
  | { kind: 'ask_user'; text: string; question: string; options: string[] }
  | {
      kind: 'propose'
      text: string
      summary: string
      preview: string
      actions: Array<{ tool: string; input: unknown }>
    }
  | { kind: 'report_blocked'; text: string; reason: string }

type Part = {
  type?: unknown
  text?: unknown
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
  isError?: unknown
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

function partsOf(content: string | undefined): Part[] | null {
  if (content === undefined) return null
  try {
    const parsed: unknown = JSON.parse(content)
    return Array.isArray(parsed) ? (parsed as Part[]) : null
  } catch {
    return null
  }
}

/** `toolContent` 为紧随其后的 tool 行内容。 */
export function intentViewOf(content: string, toolContent?: string): IntentView | null {
  const parts = partsOf(content)
  if (!parts) return null
  if (phaseOfParts(parts) !== 'answer') return null
  const calls = parts.filter((p) => p && p.type === 'tool-call')
  if (calls.length === 0 || calls.some((c) => !isIntentCall(str(c.toolName)))) return null
  const results = partsOf(toolContent)
  if (results) {
    const ids = new Set(calls.map((c) => c.toolCallId))
    const failed = results.some(
      (r) => r && r.type === 'tool-result' && ids.has(r.toolCallId) && r.isError === true,
    )
    if (failed) return null
  }
  const call = calls[0]!
  const input =
    typeof call.input === 'object' && call.input !== null
      ? (call.input as Record<string, unknown>)
      : {}
  const text = parts
    .filter((p) => p && p.type === 'text')
    .map((p) => str(p.text))
    .join('')
  switch (call.toolName) {
    case 'finish':
      return { kind: 'finish', text, summary: str(input.summary) }
    case 'ask_user':
      return {
        kind: 'ask_user',
        text,
        question: str(input.question),
        options:
          Array.isArray(input.options) && input.options.every((o) => typeof o === 'string')
            ? (input.options as string[])
            : [],
      }
    case 'propose':
      return {
        kind: 'propose',
        text,
        summary: str(input.summary),
        preview: str(input.preview),
        actions: Array.isArray(input.actions)
          ? input.actions.map((a) => {
              const action = (typeof a === 'object' && a !== null ? a : {}) as Record<
                string,
                unknown
              >
              return { tool: str(action.tool), input: action.input }
            })
          : [],
      }
    case 'report_blocked':
      return { kind: 'report_blocked', text, reason: str(input.reason) }
    default:
      return null
  }
}

/** 用户确认或拒绝提议时作为下一条用户消息发出的文本。 */
export function proposalReply(
  view: Extract<IntentView, { kind: 'propose' }>,
  accepted: boolean,
): string {
  if (!accepted) return `不执行这个提议：${view.summary}`
  return (
    `确认执行提议：${view.summary}` +
    view.actions.map((a, i) => `\n${i + 1}. ${a.tool} ${JSON.stringify(a.input)}`).join('')
  )
}
