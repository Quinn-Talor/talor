// src/main/loop/prompt-estimate.ts —— 业务层: 模型输入 token 估算(上下文预算用)
//
// pre-step context-budget 的输入:本次 prompt(消息 + 工具定义)的字符估算,
// 再按上一次调用的实际 input token 比例校准。
//
// 按 part 估算而非整体 JSON.stringify:图片 / 文件 part 的 base64 数据若当文本计,
// 一张 1.5MB 截图会被估成数十万 token,首步即误判超限,且图片留在历史里后每步都超限。
// 媒体 part 按固定 token 计,口径与 memory/types.ts 的 estimateMessage(图片 85)一致。
//
// 允许依赖: ../memory/types (estimate), ../tools/types (类型), ai (类型)
// 禁止依赖: ipc/*

import type { ModelMessage } from 'ai'
import { estimate } from '../memory/types'
import type { ToolMetadata } from '../tools/types'

/** 单个图片 / 文件 part 的固定 token 数,与 memory/types.ts estimateMessage 的图片口径一致。 */
export const MEDIA_PART_TOKENS = 85

/** tool-result content 输出里表示媒体的 part 类型(SDK ToolResultOutput content 项)。 */
const MEDIA_OUTPUT_TYPES = new Set([
  'media',
  'image-data',
  'image-url',
  'image-file-id',
  'file-data',
  'file-url',
  'file-id',
])

/** 兜底序列化时剔除的二进制载荷字段,避免 base64 被当文本计。 */
const BINARY_KEYS = new Set(['data', 'image'])

function stringifyWithoutBinary(v: unknown): string {
  try {
    return JSON.stringify(v, (k, val) => (BINARY_KEYS.has(k) ? undefined : val)) ?? ''
  } catch {
    return ''
  }
}

function estimateToolOutput(output: unknown): number {
  if (typeof output === 'string') return estimate(output)
  if (typeof output !== 'object' || output === null) return 0
  const o = output as { type?: unknown; value?: unknown }
  if (o.type === 'content' && Array.isArray(o.value)) {
    let total = 0
    for (const item of o.value as Array<{ type?: unknown; text?: unknown }>) {
      if (item && typeof item.type === 'string' && MEDIA_OUTPUT_TYPES.has(item.type)) {
        total += MEDIA_PART_TOKENS
      } else if (item && typeof item.text === 'string') {
        total += estimate(item.text)
      } else {
        total += estimate(stringifyWithoutBinary(item))
      }
    }
    return total
  }
  if (typeof o.value === 'string') return estimate(o.value)
  return estimate(stringifyWithoutBinary(o.value ?? output))
}

/** 单个 content part 的 token 估算。 */
export function estimatePartTokens(part: unknown): number {
  if (typeof part === 'string') return estimate(part)
  if (typeof part !== 'object' || part === null) return 0
  const p = part as { type?: unknown; text?: unknown; input?: unknown; output?: unknown }
  switch (p.type) {
    case 'text':
    case 'reasoning':
      return typeof p.text === 'string' ? estimate(p.text) : 0
    case 'image':
    case 'file':
    case 'reasoning-file':
      return MEDIA_PART_TOKENS
    case 'tool-call':
      return estimate(JSON.stringify(p.input ?? ''))
    case 'tool-result':
      return estimateToolOutput(p.output)
    default:
      return estimate(stringifyWithoutBinary(part))
  }
}

/** 单条消息的 token 估算。 */
export function estimateMessageTokens(m: ModelMessage): number {
  const content: unknown = m.content
  if (typeof content === 'string') return estimate(content)
  if (!Array.isArray(content)) return estimate(stringifyWithoutBinary(content))
  let total = 0
  for (const part of content) total += estimatePartTokens(part)
  return total
}

/** 按字符估算一次模型输入的 token:消息 + 本次提供的工具定义(工具定义常是大头)。 */
export function estimatePromptTokens(messages: ModelMessage[], tools: ToolMetadata[]): number {
  let total = 0
  for (const m of messages) total += estimateMessageTokens(m)
  return tools.length > 0 ? total + estimate(JSON.stringify(tools)) : total
}

/** 校准比例的上下限:单次异常不致让估算整体失真。 */
const CALIBRATION_MIN = 0.5
const CALIBRATION_MAX = 2

/**
 * 上下文预算估算:本次输入的字符估算 × 上一次调用的"实际 input token / 上次字符估算"比例。
 * 按比例而非差值校准:字符估算对工具定义 JSON 的偏差与其体量成正比,工具集变化时
 * (如 MCP 全量 294 个工具 → 14 个)差值会把旧工具集的偏差带到新调用上(实测高估 2.5×),
 * 比例则随体量缩放(同一数据回算误差 +9% / +0.9%)。首次调用没有实际值,直接用字符估算。
 */
export function calibratedContextEstimate(
  promptEstimate: number,
  last: { inputTokens?: number; promptEstimate?: number },
): number {
  if (!last.inputTokens || !last.promptEstimate) return promptEstimate
  const ratio = Math.min(
    CALIBRATION_MAX,
    Math.max(CALIBRATION_MIN, last.inputTokens / last.promptEstimate),
  )
  return Math.round(promptEstimate * ratio)
}
