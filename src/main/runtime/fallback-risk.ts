// src/main/runtime/fallback-risk.ts — 业务层：旧路径兜底危险模式的权限规则（agent-engine 的 PermissionRule）
//
// 旧路径的 RiskGate 对所有工具（含 MCP）的参数做兜底正则检查（SQL DML、`> /etc/` 等），命中即确认；
// 引擎 riskApproval 的危险模式不含这些。本规则复用 detectFallbackRisk，命中时返回高风险询问。
// 高风险工具直接放行给 riskApproval（与旧路径"高风险工具先走 high-static"一致，不重复询问）。
// 放在执行环境的工作区沙箱之后、riskApproval 之前。
//
// 允许依赖: agent-engine（类型）、tools/risk-gate
// 禁止依赖: ipc/*、repos/*、db/*

import type { PermissionRule } from 'agent-engine'
import { detectFallbackRisk } from '../tools/risk-gate'

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
