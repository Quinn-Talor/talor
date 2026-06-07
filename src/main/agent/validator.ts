// src/main/agent/validator.ts — 业务层: AgentProfile 极简 schema 校验
//
// 6 条规则(从 14 → 6):
//   rule 2:  必填字段(id/name/description/agentPrompt)非空
//   rule 3:  id 格式(snake_case 或平台 __X__)
//   rule 5:  tools 是 BuiltinToolName[]
//   rule 7:  subagents.ids 合法 + 已注册
//   rule 12: skills 是 string[]
//   rule 13: mcpServers 是 string[]
//
// 已删: rule 1 (schemaVersion) / rule 4 (semver version) / rule 6 (references) /
//       rule 8 (preferences.modelId) / rule 9 (entity pollution) / rule 14 (cli)
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*、repos/*

import type { AgentProfile, ValidateProfileResult, ValidatorIssue } from '@shared/types/agent'
import { BUILTIN_TOOL_NAMES } from '@shared/types/agent'

export interface ValidatorContext {
  /** 已注册工具名集合,不传时跳过 rule 5 严格匹配 */
  knownToolNames?: Set<string>
  /** 已注册 agent id 集合,不传时跳过 rule 7 */
  knownAgentIds?: Set<string>
  /** 已配置的平台 skill 名集合(~/.talor/skills),不传时跳过 rule 12 */
  knownSkillNames?: Set<string>
  /** 已配置的平台 MCP server name 集合(mcp_servers DB),不传时跳过 rule 13 */
  knownMcpServerNames?: Set<string>
  /**
   * agent 根目录(directory 模式下用于 loadAgentBundle)。
   * 仅 ValidatorContext 类型记录,实际 prompt 由 injectedAgentPrompt 传入。
   */
  agentRoot?: string
  /**
   * 已注入的 agentPrompt 文本。dual-mode 支持:
   *   - inline 模式: raw 对象自带 agentPrompt 字段(编辑实时校验场景)
   *   - directory 模式: loader 从 prompt.md 读完后传 injectedAgentPrompt(磁盘加载场景)
   * 两种模式至少要有一种提供 agentPrompt,否则 rule 2 失败。
   */
  injectedAgentPrompt?: string
}

const ID_RE = /^[a-z0-9_-]+$/
const PLATFORM_ID_RE = /^__[a-z0-9_-]+__$/

export function validateProfile(json: unknown, ctx: ValidatorContext = {}): ValidateProfileResult {
  const errors: ValidatorIssue[] = []
  const warnings: ValidatorIssue[] = []

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {
      valid: false,
      errors: [
        { severity: 'error', rule: 0, path: '', message: 'input must be a non-null object' },
      ],
      warnings: [],
    }
  }
  const o = json as Record<string, unknown>

  // dual-mode: 若调用方传入 injectedAgentPrompt (loader 从 prompt.md 读出后),
  // 把它合并进 raw 让后续规则跑。
  if (ctx.injectedAgentPrompt !== undefined && o.agentPrompt === undefined) {
    o.agentPrompt = ctx.injectedAgentPrompt
  }

  // RULE 2: 必填字段类型 + 非空
  for (const f of ['id', 'name', 'description', 'agentPrompt'] as const) {
    const v = o[f]
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push({
        severity: 'error',
        rule: 2,
        path: f,
        message: 'must be a non-empty string',
      })
    }
  }
  if (errors.length > 0) return { valid: false, errors, warnings }

  // RULE 3: id 格式
  if (typeof o.id === 'string' && !ID_RE.test(o.id) && !PLATFORM_ID_RE.test(o.id)) {
    errors.push({
      severity: 'error',
      rule: 3,
      path: 'id',
      message: 'must match /^[a-z0-9_-]+$/ or platform pattern /^__[a-z0-9_-]+__$/',
    })
  }

  // RULE 5: tools 白名单
  if (o.tools !== undefined) {
    if (!Array.isArray(o.tools)) {
      errors.push({ severity: 'error', rule: 5, path: 'tools', message: 'must be array' })
    } else {
      o.tools.forEach((t, i) => {
        if (typeof t !== 'string' || !(BUILTIN_TOOL_NAMES as readonly string[]).includes(t)) {
          errors.push({
            severity: 'error',
            rule: 5,
            path: `tools[${i}]`,
            message: `must be one of: ${BUILTIN_TOOL_NAMES.join(', ')}`,
          })
        }
      })
    }
  }

  // RULE 7: subagents.ids[].id 引用已注册 agent
  if (o.subagents !== undefined && o.subagents !== null) {
    if (typeof o.subagents !== 'object' || Array.isArray(o.subagents)) {
      errors.push({ severity: 'error', rule: 7, path: 'subagents', message: 'must be object' })
    } else {
      const sa = o.subagents as Record<string, unknown>
      if (sa.ids !== undefined) {
        if (!Array.isArray(sa.ids)) {
          errors.push({
            severity: 'error',
            rule: 7,
            path: 'subagents.ids',
            message: 'must be array',
          })
        } else {
          sa.ids.forEach((s, i) => {
            if (!s || typeof s !== 'object') {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}]`,
                message: 'must be object',
              })
              return
            }
            const sub = s as Record<string, unknown>
            if (typeof sub.id !== 'string' || !ID_RE.test(sub.id)) {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}].id`,
                message: 'must match /^[a-z0-9_-]+$/',
              })
            } else if (ctx.knownAgentIds && !ctx.knownAgentIds.has(sub.id)) {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}].id`,
                message: `agent "${sub.id}" not found in registry`,
              })
            }
          })
        }
      }
    }
  }

  // RULE 12: skills 是平台 skill name 数组(string[])
  if (o.skills !== undefined) {
    if (!Array.isArray(o.skills)) {
      errors.push({
        severity: 'error',
        rule: 12,
        path: 'skills',
        message: 'must be string[] (platform skill names)',
      })
    } else {
      o.skills.forEach((s, i) => {
        if (typeof s !== 'string' || s.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 12,
            path: `skills[${i}]`,
            message: 'must be a non-empty string (platform skill name)',
          })
        } else if (ctx.knownSkillNames && !ctx.knownSkillNames.has(s)) {
          errors.push({
            severity: 'error',
            rule: 12,
            path: `skills[${i}]`,
            message: `skill "${s}" not found in platform ~/.talor/skills/`,
          })
        }
      })
    }
  }

  // RULE 13: mcpServers 是平台 MCP server name 数组(string[])
  if (o.mcpServers !== undefined) {
    if (!Array.isArray(o.mcpServers)) {
      errors.push({
        severity: 'error',
        rule: 13,
        path: 'mcpServers',
        message: 'must be string[] (platform mcp_servers DB names)',
      })
    } else {
      o.mcpServers.forEach((m, i) => {
        if (typeof m !== 'string' || m.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 13,
            path: `mcpServers[${i}]`,
            message: 'must be a non-empty string (platform MCP server name)',
          })
        } else if (ctx.knownMcpServerNames && !ctx.knownMcpServerNames.has(m)) {
          errors.push({
            severity: 'error',
            rule: 13,
            path: `mcpServers[${i}]`,
            message: `MCP server "${m}" not configured in Settings → MCP Servers`,
          })
        }
      })
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings }

  const profile = o as unknown as AgentProfile
  return { valid: true, profile, warnings }
}
