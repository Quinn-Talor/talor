// src/main/loop/step-adapter.ts —— 业务层: SDK StepResult → Talor 内部模型 (v4 Phase 3)
//
// 作用:
//   AI SDK 的 onStepFinish 回调拿到 StepResult<TOOLS>, 字段是 SDK 的 schema。
//   detector / forced-summary / 持久化路径用的是 Talor 内部 OutcomeFacts / StepOutcome。
//   本模块负责单向转换 + 复用 v3 已有的 stepSignature / extractRawForHash 等纯函数。
//
//   v3 同款逻辑(canonicalizeJson / extractRawForHash / sha8 / stepSignature /
//   isSubagentFailureOutput)从 react-loop.ts 搬过来 — runReactStep 删除后这些
//   helper 留在此处独立可测。
//
// 允许依赖: ./types, ./outcome-facts, ./stream-utils (isErrorOutput / extractOutputText)
// 禁止依赖: ipc/*, ../repos/*

import { createHash } from 'crypto'
import type { StepResult, ToolSet } from 'ai'
import type { OutcomeFacts } from './outcome-facts'
import type { StepOutcome } from './types'
import { isErrorOutput } from './stream-utils'

// ── 纯哈希 / 签名 helper (v3 → step-adapter) ────────────────────────────

export function sha8(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 8)
}

/**
 * 对任意 JSON 值做规范化序列化:递归对对象键排序,确保键顺序差异不影响 hash。
 * 用途:同命令的两次调用即使字段顺序不同也产出相同的 inputHash。
 */
export function canonicalizeJson(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return '[' + v.map(canonicalizeJson).join(',') + ']'
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return (
    '{' + entries.map(([k, val]) => JSON.stringify(k) + ':' + canonicalizeJson(val)).join(',') + '}'
  )
}

/**
 * 从 tool_result output 抽 raw 段做 hash。
 *
 * tool_result body 结构:[通用指引] + "---" + "[Raw output]\n" + <raw>。
 * 抽取 `[Raw output]\n` 之后前 500 字节;缺失则 fallback 到整条 output。
 */
export function extractRawForHash(output: string): string {
  const marker = '[Raw output]\n'
  const idx = output.indexOf(marker)
  const raw = idx === -1 ? output : output.slice(idx + marker.length)
  return raw.slice(0, 500)
}

/**
 * 一步的复合签名 = sorted `toolName#inputHash:outputHash`。
 *
 * - inputHash: canonical JSON sha1 前 8 位 (忽略键顺序)
 * - outputHash: raw 段前 500 字节的 sha1 前 8 位 (跳过指引前缀)
 * - sorted: 并行/乱序的多工具不影响签名
 */
export function stepSignature(
  toolCalls: Array<{ toolCallId?: string; toolName: string; input: unknown }>,
  toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>,
): string {
  if (toolCalls.length === 0) return ''
  const resultByCallId = new Map<string, unknown>()
  for (const tr of toolResults) resultByCallId.set(tr.toolCallId, tr.output)
  return toolCalls
    .map((tc) => {
      const inputHash = sha8(canonicalizeJson(tc.input))
      const out = tc.toolCallId ? resultByCallId.get(tc.toolCallId) : undefined
      const outText = extractRawForHash(String(out ?? ''))
      const outputHash = outText ? sha8(outText) : 'none'
      return `${tc.toolName}#${inputHash}:${outputHash}`
    })
    .sort()
    .join('|')
}

/**
 * SUBAGENT_ / DELEGATION_ 前缀的失败 envelope 判定 — failure-streak 加权用。
 */
export function isSubagentFailureOutput(output: unknown): boolean {
  if (typeof output !== 'object' || output === null) return false
  const env = output as Record<string, unknown>
  if (env.__talor_error !== true) return false
  if (typeof env.code !== 'string') return false
  const code = env.code
  return (
    code.startsWith('SUBAGENT_') ||
    code === 'DELEGATION_BUDGET_EXHAUSTED' ||
    code === 'DELEGATION_QUEUE_TIMEOUT'
  )
}

// ── SDK StepResult → Talor 内部模型 ────────────────────────────────────

/**
 * 从 SDK StepResult.content 抽出纯文本 (合并所有 text 段)。
 *
 * SDK content 是 ContentPart 联合; text 段 type='text', value 在 .text。
 * reasoning 段不在此处合并 (单独 extractReasoningFromStep)。
 */
export function extractTextFromStep(step: StepResult<ToolSet>): string {
  // SDK v6 直接提供 step.text — 是所有 text part 的拼接。
  return step.text ?? ''
}

/** 从 step.reasoning[] 拼接 reasoning text。 */
export function extractReasoningFromStep(step: StepResult<ToolSet>): string {
  return step.reasoningText ?? ''
}

/** SDK toolCalls → Talor 内部精简形态 (toolCallId / toolName / input)。 */
export function toolCallsFromStep(
  step: StepResult<ToolSet>,
): Array<{ toolCallId: string; toolName: string; input: unknown }> {
  return (step.toolCalls ?? []).map((tc) => ({
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    input: tc.input,
  }))
}

/** SDK toolResults → Talor 内部精简形态。 */
export function toolResultsFromStep(
  step: StepResult<ToolSet>,
): Array<{ toolCallId: string; toolName: string; output: unknown }> {
  return (step.toolResults ?? []).map((tr) => ({
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    output: tr.output,
  }))
}

/**
 * 派生 allToolsFailed 三态:
 *   - null:  无工具调用
 *   - true:  全部 tool result 是 error
 *   - false: 至少一个成功
 */
export function deriveAllToolsFailed(toolResults: Array<{ output: unknown }>): boolean | null {
  if (toolResults.length === 0) return null
  return toolResults.every((tr) => isErrorOutput(tr.output))
}

/** 从 SDK StepResult 派生 OutcomeFacts (detector 消费)。 */
export function factsFromStep(step: StepResult<ToolSet>): OutcomeFacts {
  const toolCalls = toolCallsFromStep(step)
  const toolResults = toolResultsFromStep(step)
  const text = extractTextFromStep(step)
  return {
    hasToolCall: toolCalls.length > 0,
    hasText: text.trim() !== '',
    allToolsFailed: deriveAllToolsFailed(toolResults),
    isSubagentFailure: toolResults.some((tr) => isSubagentFailureOutput(tr.output)),
    signature: stepSignature(toolCalls, toolResults),
  }
}

/**
 * 从 SDK StepResult 派生 StepOutcome (turn-end policy 链消费)。
 *
 * 兼容 v3 主循环 StepOutcome 接口 — policy 链不用改。
 * wroteAssistantFinal / shouldContinue 由调用方根据上下文设定 (此 adapter 默认 false)。
 */
export function outcomeFromStep(step: StepResult<ToolSet>, durationMs = 0): StepOutcome {
  const toolCalls = toolCallsFromStep(step)
  const toolResults = toolResultsFromStep(step)
  const text = extractTextFromStep(step)
  return {
    stepText: text,
    wroteAssistantFinal: false,
    shouldContinue: toolCalls.length > 0,
    durationMs,
    toolNames: toolCalls.map((tc) => tc.toolName),
    signature: stepSignature(toolCalls, toolResults),
    allToolsFailed: deriveAllToolsFailed(toolResults),
    containsSubagentFailure: toolResults.some((tr) => isSubagentFailureOutput(tr.output)),
    finishReason: step.finishReason,
  }
}
