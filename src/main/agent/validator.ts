// src/main/agent/validator.ts — 业务层: AgentProfile Schema 2.0 校验
//
// 9 条规则: 8 hard + 1 warn。详见 docs/superpowers/plans/2026-05-11-agent-schema-2-0.md §III.
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*、repos/*

import { existsSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { valid as semverValid } from 'semver'
import type { AgentProfile, ValidateProfileResult, ValidatorIssue } from '@shared/types/agent'
import { BUILTIN_TOOL_NAMES } from '@shared/types/agent'

export interface ValidatorContext {
  /** 已注册工具名集合,不传时跳过 rule 5 严格匹配 */
  knownToolNames?: Set<string>
  /** 已注册模型 id 集合,不传时跳过 rule 8 */
  knownModelIds?: Set<string>
  /** 已注册 agent id 集合,不传时跳过 rule 7 */
  knownAgentIds?: Set<string>
  /** 已配置的平台 skill 名集合(~/.claude/skills),不传时跳过 rule 12 */
  knownSkillNames?: Set<string>
  /** 已配置的平台 MCP server name 集合(mcp_servers DB),不传时跳过 rule 13 */
  knownMcpServerNames?: Set<string>
  /** agent 根目录,用于 references[].path 存在性检查 */
  agentRoot?: string
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

  // RULE 1: schemaVersion
  if (o.schemaVersion !== '2.0') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'schemaVersion',
      message: `must be "2.0", got ${JSON.stringify(o.schemaVersion)}`,
    })
    return { valid: false, errors, warnings }
  }

  // RULE 2: 必填字段类型 + 非空
  for (const f of ['id', 'name', 'description', 'version', 'agentPrompt'] as const) {
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

  // 后续规则依赖结构完整;有 rule 2 错误就停
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

  // RULE 4: semver
  if (typeof o.version === 'string' && !semverValid(o.version)) {
    errors.push({ severity: 'error', rule: 4, path: 'version', message: 'must be valid semver' })
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

  // RULE 6: references
  if (o.references !== undefined) {
    if (!Array.isArray(o.references)) {
      errors.push({ severity: 'error', rule: 6, path: 'references', message: 'must be array' })
    } else {
      const seen = new Set<string>()
      o.references.forEach((r, i) => {
        if (!r || typeof r !== 'object') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}]`,
            message: 'must be object',
          })
          return
        }
        const ref = r as Record<string, unknown>
        if (typeof ref.id !== 'string' || !ID_RE.test(ref.id)) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].id`,
            message: 'must match /^[a-z0-9_-]+$/',
          })
        } else if (seen.has(ref.id)) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].id`,
            message: `duplicate reference id "${ref.id}"`,
          })
        } else {
          seen.add(ref.id)
        }
        if (typeof ref.path !== 'string' || ref.path.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].path`,
            message: 'must be non-empty string',
          })
        } else if (
          ref.path.includes('\\') ||
          isAbsolute(ref.path) ||
          normalize(ref.path).startsWith('..')
        ) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].path`,
            message:
              'must be a relative path within agent dir (no .., absolute paths, or backslashes)',
          })
        } else if (ctx.agentRoot) {
          const full = resolve(ctx.agentRoot, ref.path)
          if (!existsSync(full)) {
            errors.push({
              severity: 'error',
              rule: 6,
              path: `references[${i}].path`,
              message: `file does not exist: ${ref.path}`,
            })
          }
        }
        if (typeof ref.description !== 'string' || ref.description.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].description`,
            message: 'must be non-empty string',
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

  // RULE 8: preferences.modelId 已注册
  if (o.preferences !== undefined && o.preferences !== null) {
    if (typeof o.preferences !== 'object' || Array.isArray(o.preferences)) {
      errors.push({ severity: 'error', rule: 8, path: 'preferences', message: 'must be object' })
    } else {
      const p = o.preferences as Record<string, unknown>
      if (typeof p.modelId === 'string' && ctx.knownModelIds && !ctx.knownModelIds.has(p.modelId)) {
        errors.push({
          severity: 'error',
          rule: 8,
          path: 'preferences.modelId',
          message: `unknown model "${p.modelId}"`,
        })
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
            message: `skill "${s}" not found in platform ~/.claude/skills/`,
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

  // RULE 14: cli 是 command name 数组(string[])
  if (o.cli !== undefined) {
    if (!Array.isArray(o.cli)) {
      errors.push({
        severity: 'error',
        rule: 14,
        path: 'cli',
        message: 'must be string[] (CLI command names)',
      })
    } else {
      o.cli.forEach((c, i) => {
        if (typeof c !== 'string' || c.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 14,
            path: `cli[${i}]`,
            message: 'must be a non-empty string (CLI command name)',
          })
        }
      })
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings }

  const profile = o as unknown as AgentProfile
  return { valid: true, profile, warnings }
}
