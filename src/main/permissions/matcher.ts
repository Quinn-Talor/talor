// src/main/permissions/matcher.ts — 业务层：权限规则匹配器
//
// 按 tool 分派到不同的 argPattern 匹配器。Deny-first：先扫 deny 规则，命中
// 立即拒绝；再扫 allow。若都未命中，返回 unknown 由上层决定是否询问用户。
//
// 允许依赖：permissions/*、shared/*
// 禁止依赖：ipc/*

import { permissionStore } from './permission-store'
import type { PermissionRule } from '@shared/types/permissions'

export interface MatchContext {
  workspacePath: string
  toolName: string
  /** path 工具：已解析到 absPath（absolute + realpath）。非 path 工具为 undefined。 */
  absPath?: string
  /** bash 工具：命令原文（trim 前后均可，内部会 trim）。非 bash 为 undefined。 */
  bashCommand?: string
}

export type MatchResult =
  | { decision: 'allow'; ruleId: string }
  | { decision: 'deny'; ruleId: string }
  | { decision: 'unknown' }

const FILE_TOOLS = new Set(['read', 'write', 'edit', 'ls', 'glob', 'grep'])

/**
 * 匹配规则列表。deny-first：
 *   1. 遍历所有 effect='deny' 的规则，命中 → 拒绝
 *   2. 遍历所有 effect='allow' 的规则，命中 → 放行
 *   3. 都未命中 → unknown（上层弹窗询问）
 *
 * 使用 permissionStore.allRulesFor() 拿到 session + persisted 合并列表；
 * session 规则因此优先于 persisted 被扫到——但由于 deny-first 语义，相同
 * effect 下顺序不影响结果。
 */
export function matchRules(ctx: MatchContext): MatchResult {
  const all = permissionStore.allRulesFor(ctx.workspacePath)

  for (const r of all) {
    if (r.effect === 'deny' && matchSingleRule(r, ctx)) {
      return { decision: 'deny', ruleId: r.id }
    }
  }
  for (const r of all) {
    if (r.effect === 'allow' && matchSingleRule(r, ctx)) {
      return { decision: 'allow', ruleId: r.id }
    }
  }
  return { decision: 'unknown' }
}

function matchSingleRule(rule: PermissionRule, ctx: MatchContext): boolean {
  if (rule.tool !== ctx.toolName) return false

  if (rule.tool === 'bash') {
    if (!ctx.bashCommand) return false
    try {
      return new RegExp(rule.argPattern).test(ctx.bashCommand.trim())
    } catch {
      // 损坏的正则——视为不匹配，不抛错
      return false
    }
  }

  if (FILE_TOOLS.has(rule.tool)) {
    if (!ctx.absPath) return false
    // 尾 '/' = 目录前缀匹配；否则精确匹配
    if (rule.argPattern.endsWith('/')) return ctx.absPath.startsWith(rule.argPattern)
    return ctx.absPath === rule.argPattern
  }

  return false
}
