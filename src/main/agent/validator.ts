// src/main/agent/validator.ts — 业务层: AgentProfile Schema 2.0 校验
//
// 9 条规则: 8 hard + 1 warn。详见 docs/superpowers/plans/2026-05-11-agent-schema-2-0.md §III.
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*、repos/*

import { existsSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { valid as semverValid } from 'semver'
import type {
  AgentProfile,
  ValidateProfileResult,
  ValidatorIssue,
  ReferenceFile,
} from '@shared/types/agent'
import { BUILTIN_TOOL_NAMES } from '@shared/types/agent'
import { extractEntities } from './entity-extractor'

export interface ValidatorContext {
  /** 已注册工具名集合,不传时跳过 rule 5 严格匹配 */
  knownToolNames?: Set<string>
  /** 已注册模型 id 集合,不传时跳过 rule 8 */
  knownModelIds?: Set<string>
  /** 已注册 agent id 集合,不传时跳过 rule 7 */
  knownAgentIds?: Set<string>
  /** agent 根目录,用于 references[].path 存在性检查 */
  agentRoot?: string
  /**
   * 宽松模式 — 把 rule 11(env 凭据嫌疑)从 error 降为 warning。
   * 仅用于 AgentLoader 加载存量 agent,避免误伤已存在的凭据写法导致 agent 加载失败;
   * write 路径(agents:update / agents:create-from-draft)不应传此标志。
   */
  lenientCredentialScan?: boolean
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
  if (o.minAppVersion !== undefined && o.minAppVersion !== null) {
    if (typeof o.minAppVersion !== 'string' || !semverValid(o.minAppVersion)) {
      errors.push({
        severity: 'error',
        rule: 4,
        path: 'minAppVersion',
        message: 'must be valid semver',
      })
    }
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

  // RULE 10 + 11: MCP stdio 凭据机制
  if (Array.isArray(o.mcpServers)) {
    o.mcpServers.forEach((m, i) => {
      if (!m || typeof m !== 'object') return
      const mcp = m as Record<string, unknown>
      const transport = mcp.transport as Record<string, unknown> | undefined
      if (!transport || transport.type !== 'stdio') return

      // RULE 10: envFromAccount key/value 格式
      const efa = transport.envFromAccount as Record<string, unknown> | undefined
      if (efa !== undefined) {
        if (typeof efa !== 'object' || Array.isArray(efa) || efa === null) {
          errors.push({
            severity: 'error',
            rule: 10,
            path: `mcpServers[${i}].transport.envFromAccount`,
            message: 'must be object mapping subprocess var name → Account envVar name',
          })
        } else {
          for (const [subprocVar, accountVar] of Object.entries(efa)) {
            if (!ENV_VAR_NAME_RE.test(subprocVar)) {
              errors.push({
                severity: 'error',
                rule: 10,
                path: `mcpServers[${i}].transport.envFromAccount`,
                message: `key "${subprocVar}" must match ${ENV_VAR_NAME_RE} (uppercase env var)`,
              })
            }
            if (typeof accountVar !== 'string' || !ENV_VAR_NAME_RE.test(accountVar)) {
              errors.push({
                severity: 'error',
                rule: 10,
                path: `mcpServers[${i}].transport.envFromAccount.${subprocVar}`,
                message: `Account envVar reference must match ${ENV_VAR_NAME_RE}`,
              })
            }
          }
        }
      }

      // RULE 11: env 凭据嫌疑扫描(防止字面凭据被打包/泄露)
      // lenientCredentialScan 模式下降为 warning,避免误伤存量 agent 加载
      const env = transport.env as Record<string, unknown> | undefined
      if (env && typeof env === 'object') {
        for (const [key, value] of Object.entries(env)) {
          if (typeof value !== 'string') continue
          if (looksLikeCredential(value)) {
            const issue: ValidatorIssue = {
              severity: ctx.lenientCredentialScan ? 'warn' : 'error',
              rule: 11,
              path: `mcpServers[${i}].transport.env.${key}`,
              message:
                'value looks like a credential — use transport.envFromAccount to reference an Account envVar instead',
            }
            if (ctx.lenientCredentialScan) warnings.push(issue)
            else errors.push(issue)
          }
        }
      }
    })
  }

  if (errors.length > 0) return { valid: false, errors, warnings }

  const profile = o as unknown as AgentProfile

  // W1 (rule 9): 实体污染
  validateNoSpecificEntities(profile, warnings)

  return { valid: true, profile, warnings }
}

const ENV_VAR_NAME_RE = /^[A-Z_][A-Z0-9_]*$/
const CREDENTIAL_VALUE_PREFIX_RE = /^(sk-|ghp_|gho_|ghs_|ghr_|pk_|api_|token_|Bearer\s|Basic\s)/i
const NON_CREDENTIAL_LITERAL_RE =
  /^(true|false|debug|info|warn|error|production|development|test|0|1)$/i

function looksLikeCredential(value: string): boolean {
  if (value.length < 8) return false
  if (NON_CREDENTIAL_LITERAL_RE.test(value)) return false
  return CREDENTIAL_VALUE_PREFIX_RE.test(value)
}

// ─── W1 (rule 9): description / agentPrompt / references.description 不含具体实体 ──

function validateNoSpecificEntities(profile: AgentProfile, warnings: ValidatorIssue[]): void {
  const checks: Array<{ path: string; text: string }> = [
    { path: 'description', text: profile.description },
    { path: 'agentPrompt', text: profile.agentPrompt },
  ]
  ;(profile.references ?? []).forEach((r: ReferenceFile, i) => {
    checks.push({ path: `references[${i}].description`, text: r.description })
  })

  for (const { path, text } of checks) {
    if (!text) continue
    const entities = extractEntities(text)
    const flagged = entities.filter((e) => {
      if (e.category === 'ticker' || e.category === 'stock-code' || e.category === 'path')
        return true
      if (e.category === 'cn-name' && e.text.length >= 4) return true
      return false
    })
    if (flagged.length === 0) continue
    const sample = flagged
      .slice(0, 3)
      .map((e) => e.text)
      .join(', ')
    warnings.push({
      severity: 'warn',
      rule: 9,
      path,
      message:
        `contains specific entities [${sample}${flagged.length > 3 ? ', ...' : ''}] — ` +
        `prompt-rendered fields should use generic language. ` +
        `Specific entities bias all delegations regardless of user intent.`,
    })
  }
}
