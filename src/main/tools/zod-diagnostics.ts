// src/main/tools/zod-diagnostics.ts — 工具层: Zod 校验失败 → 模型可读诊断消息
//
// 目标:ZodError 结构化信息 → 一段 LLM 容易 act-upon 的文本。
//
// 优先级:
//   1. 缺 required(code='invalid_type' 且 received='undefined'):复用现有
//      diagnoseInputMismatch 的"missing + provided + schema + Did you mean"
//      组合,与原有错误消息形态保持一致。
//   2. 其他错误:按 issue 拼成多行,每行 `"<field>": <message>`,前置
//      "Invalid input for tool ..."头部,与 ERROR_OUTPUT_PATTERNS 对齐保证 isError。

import type { z } from 'zod'
import { diagnoseInputMismatch } from './input-diagnostics'

export function formatZodError(
  toolName: string,
  params: Record<string, unknown>,
  input: unknown,
  error: z.ZodError,
): string {
  const issues = error.issues

  // 优先处理"缺 required"场景,复用 diagnoseInputMismatch(含 Did-you-mean)。
  // Zod v4:缺字段时 code='invalid_type' && path.length===1 && input undefined。
  const missingFields: string[] = []
  for (const issue of issues) {
    if (
      issue.code === 'invalid_type' &&
      issue.path.length === 1 &&
      // 读取当前 input 中该字段是否缺失,避免把"类型错误"错判为"缺字段"
      isMissing(input, issue.path[0])
    ) {
      missingFields.push(String(issue.path[0]))
    }
  }
  if (missingFields.length > 0 && missingFields.length === issues.length) {
    // 全是缺字段 → 走 diagnose 分支,保持与旧 diagnose 消息形态一致
    return diagnoseInputMismatch(
      toolName,
      params as { required?: string[]; properties?: Record<string, { type?: string; description?: string }> },
      input,
      missingFields,
    )
  }

  // 其他错误:多 issue 合并为一段诊断消息
  const lines: string[] = [`Invalid input for tool "${toolName}":`]
  for (const issue of issues) {
    const loc = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)'
    lines.push(`  - "${loc}": ${issue.message}`)
  }
  return lines.join('\n')
}

function isMissing(input: unknown, key: PropertyKey): boolean {
  if (input === null || input === undefined) return true
  if (typeof input !== 'object') return false
  const obj = input as Record<string, unknown>
  const v = obj[key as string]
  return v === undefined || v === null
}
