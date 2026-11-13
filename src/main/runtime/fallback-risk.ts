// src/main/runtime/fallback-risk.ts — 业务层：兜底危险模式的权限规则（agent-engine 的 PermissionRule）
//
// 对所有工具（含 MCP）的参数做兜底正则检查（SQL DML、`> /etc/` 等），命中即高风险询问；
// 引擎 riskApproval 的危险模式不含这些。高风险工具直接放行给 riskApproval（不重复询问）。
// 放在执行环境的工作区沙箱之后、riskApproval 之前。
//
// 允许依赖: agent-engine（类型）
// 禁止依赖: ipc/*、repos/*、db/*

import type { PermissionRule } from '@talor/agent-engine'

const SUMMARY_CHARS = 200
const INPUT_CHARS = 2000

export function talorFallbackRisk(): PermissionRule {
  return {
    id: 'talor-fallback-risk',
    version: '1',
    async permit(call) {
      if (call.risk === 'high') return 'allow'
      const hit = detectFallbackRisk(call.input)
      if (!hit) return 'allow'
      const preview = call.input === undefined ? '' : JSON.stringify(call.input)
      return {
        ask: {
          summary: `${call.toolName} ${preview.slice(0, SUMMARY_CHARS)}`.trim(),
          risk: 'high',
          detail: {
            input: preview.slice(0, INPUT_CHARS),
            reason: `参数命中旧路径的危险模式：${hit.reason}`,
          },
        },
      }
    },
  }
}

/**
 * 通用危险关键字 — 不绑业务名，只识别"操作类型"层。
 * 业务层判断（production schema / 关键表名等）由工具自身的风险等级表达，不在此处。
 */
const FALLBACK_DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: 'SQL DDL: DROP/TRUNCATE' },
  { pattern: /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i, reason: 'SQL DML' },
  { pattern: /\brm\s+-rf?\s+\//, reason: 'rm -rf' },
  { pattern: /\bsudo\b/, reason: 'sudo' },
  { pattern: />\s*\/etc\//, reason: 'redirect to /etc' },
  { pattern: /chmod\s+777/, reason: 'chmod 777' },
]

/** SQL 噪声剥离 — 避免误报字符串字面量 / 注释中的关键字（标准 SQL 注释 + 字符串字面量）。 */
export function stripSqlNoise(text: string): string {
  return text
    .replace(/--[^\n]*/g, '') // 行注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/'(?:[^']|'')*'/g, "''") // 单引号字符串
    .replace(/"(?:[^"]|"")*"/g, '""') // 双引号字符串
}

export function detectFallbackRisk(input: unknown): { reason: string } | null {
  // 扁平化提取所有字符串字段后再 stripSqlNoise + regex。
  // 不能直接 JSON.stringify(input) — stripSqlNoise 的双引号字面量剥离规则会把
  // JSON 内的 "key":"value" 整段剥光，导致漏检。
  const text = stripSqlNoise(flattenStringValues(input))
  for (const { pattern, reason } of FALLBACK_DANGER_PATTERNS) {
    if (pattern.test(text)) return { reason }
  }
  return null
}

/** 递归提取 input 中所有 string 字段，用空格连接为一个字符串供 regex 扫描。 */
function flattenStringValues(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(flattenStringValues).join(' ')
  if (typeof v === 'object') {
    return Object.values(v).map(flattenStringValues).join(' ')
  }
  return ''
}
