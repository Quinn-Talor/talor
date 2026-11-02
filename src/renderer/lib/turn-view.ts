// src/renderer/lib/turn-view.ts — 一条 assistant 消息行的显示信息
//
// phase 为 null 表示没有阶段标记的行（旧路径写的），渲染端按改动前的方式显示。
import { phaseOfParts, type TurnPhase } from '@shared/turn-phase'

export interface AssistantView {
  phase: TurnPhase | null
  text: string
  reasoning: string
}

export function assistantView(content: string): AssistantView {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { phase: null, text: content, reasoning: '' }
  }
  if (typeof parsed === 'string') return { phase: null, text: parsed, reasoning: '' }
  if (!Array.isArray(parsed)) return { phase: null, text: content, reasoning: '' }
  const parts = parsed as Array<{ type?: unknown; text?: unknown }>
  const textOf = (type: string) =>
    parts
      .filter((p) => p && p.type === type && typeof p.text === 'string')
      .map((p) => p.text as string)
  return {
    phase: phaseOfParts(parsed),
    text: textOf('text').join(''),
    reasoning: textOf('reasoning').join('\n'),
  }
}
