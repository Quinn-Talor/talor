// src/main/agent/draft-extractor.ts — 业务层：Agent 草稿提取
//
// 两个纯函数：
//   1. serializeS1History — 把 S1 messages 序列化为 markdown 文本（推给 crystallizer 做 first user message）
//   2. parseAgentDraft    — 从 crystallizer 输出的 markdown 抠 ```json``` 块 + validateProfile
//
// 允许依赖：repos/* (类型) / shared/* / agent/validator
// 禁止依赖：ipc/*

import type { ChatMessage } from '../repos/session-repo'
import type { AgentProfile } from '@shared/types/agent'
import { validateProfile } from './validator'

/** 历史快照字符长度上限（防 LLM context 爆）。超过截断。 */
export const SNAPSHOT_MAX_CHARS = 50_000

/**
 * 单值截断 helper（hidden 实现细节）。
 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '...'
}

/**
 * 把 ChatMessage[] 序列化为 markdown 文本，供 crystallizer 在 first user message
 * 中阅读"原对话"。
 *
 * 序列化规则（语义锁定）：
 *   - role='system': 跳过（不写入快照 — 系统提示不属于"对话"，会污染 crystallizer 视角）
 *   - role='user' / 'assistant' / 'tool': 写入 `**<role>**: <text>` 行
 *   - content 解析顺序：JSON.parse → 数组（content blocks）→ 提取 text
 *     - block.type === 'text': 取 block.text
 *     - block.type === 'tool_use' / 'tool-call': 格式化为 `[tool: <name>(<truncated args>)]`
 *     - block.type === 'tool_result' / 'tool-result': 格式化为 `[result: <truncated text>]`
 *   - content 解析失败 / 是字符串：用 raw string fallback
 *   - 每条 message 用 `\n\n---\n\n` 分隔
 *   - 总长度超 SNAPSHOT_MAX_CHARS：截断 + 末尾 `[...truncated]` 标记
 */
export function serializeS1History(messages: ChatMessage[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.role === 'system') continue
    const textPart = extractTextFromContent(msg.content)
    parts.push(`**${msg.role}**: ${textPart.trim()}`)
  }
  let output = parts.join('\n\n---\n\n')
  if (output.length > SNAPSHOT_MAX_CHARS) {
    output = output.slice(0, SNAPSHOT_MAX_CHARS) + '\n[...truncated]'
  }
  return output
}

/**
 * 从单条 message 的 content（JSON 字符串）抽出可读文本片段。
 *
 * Content blocks 来自 AI SDK 的 AssistantContent / UserContent / ToolContent；
 * 我们仅展示对 crystallizer 有意义的字段，把 tool 调用格式化成简短摘要。
 */
function extractTextFromContent(rawContent: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawContent)
  } catch {
    return rawContent
  }
  if (typeof parsed === 'string') return parsed
  if (!Array.isArray(parsed)) return ''

  const lines: string[] = []
  for (const block of parsed) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    const type = b.type
    if (type === 'text' && typeof b.text === 'string') {
      lines.push(b.text)
    } else if (type === 'tool_use' || type === 'tool-call') {
      const name = typeof b.toolName === 'string' ? b.toolName : 'unknown'
      const inputStr = truncate(JSON.stringify(b.input ?? {}), 200)
      lines.push(`[tool: ${name}(${inputStr})]`)
    } else if (type === 'tool_result' || type === 'tool-result') {
      const out = b.output
      let outStr: string
      if (typeof out === 'string') outStr = out
      else if (
        out &&
        typeof out === 'object' &&
        typeof (out as Record<string, unknown>).value === 'string'
      )
        outStr = (out as { value: string }).value
      else outStr = JSON.stringify(out ?? {})
      lines.push(`[result: ${truncate(outStr, 200)}]`)
    }
    // 其它类型（image / reasoning 等）跳过
  }
  return lines.join('\n')
}

export interface ParseDraftResult {
  valid: boolean
  profile?: AgentProfile
  error?: string
  /** 原文（用于 UI 展示原始 JSON 折叠区） */
  raw: string
}

/**
 * 从 crystallizer 输出的 markdown 文本中抠出最后一个**合法**的 ```json``` 块
 * 并 validateProfile。
 *
 * 选择"最后一个"的设计理由：crystallizer 多轮迭代时每次都重新输出整份 JSON，
 * 末尾即最终版本（AC-007）。如果末尾不合法，回退到向前找最近的合法版本。
 */
export function parseAgentDraft(text: string): ParseDraftResult {
  // matchAll 正则：```json\n<内容>\n``` —— 用 [\s\S]+? 跨行非贪婪
  const REGEX = /```json\s*\n([\s\S]+?)\n```/g
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = REGEX.exec(text)) !== null) {
    blocks.push(m[1])
  }
  if (blocks.length === 0) {
    return { valid: false, error: 'no json code block found', raw: text }
  }

  // 从后往前尝试解析，取第一个合法的
  let lastError = 'parse failed'
  for (let i = blocks.length - 1; i >= 0; i--) {
    let parsed: unknown
    try {
      parsed = JSON.parse(blocks[i])
    } catch (parseErr) {
      lastError = parseErr instanceof Error ? parseErr.message : String(parseErr)
      continue
    }
    const result = validateProfile(parsed)
    if (result.valid) {
      return { valid: true, profile: result.profile, raw: text }
    }
    lastError = result.errors.join('; ')
  }
  return { valid: false, error: lastError, raw: text }
}
