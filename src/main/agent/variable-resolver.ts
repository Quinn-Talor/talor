// src/main/agent/variable-resolver.ts — 业务层：模板变量替换
//
// 将 {{变量名}} 模板替换为 AccountStore 中的实际值。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*

import type { ResolveResult } from '@shared/types/agent'

const TEMPLATE_REGEX = /\{\{(\w+)\}\}/g

export function resolveVariables(
  config: Record<string, string>,
  accountValues: Map<string, string>,
): ResolveResult {
  const resolved: Record<string, string> = {}
  const allMissing = new Set<string>()

  for (const [key, value] of Object.entries(config)) {
    let result = value
    let entryHasMissing = false

    TEMPLATE_REGEX.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = TEMPLATE_REGEX.exec(value)) !== null) {
      const varName = match[1]
      const actual = accountValues.get(varName)
      if (actual !== undefined) {
        result = result.replace(match[0], actual)
      } else {
        allMissing.add(varName)
        entryHasMissing = true
      }
    }

    if (!entryHasMissing) {
      resolved[key] = result
    }
  }

  return { resolved, missing: Array.from(allMissing) }
}
