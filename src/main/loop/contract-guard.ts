// src/main/loop/contract-guard.ts — 业务层：Acceptance 验证 + retryPolicy 应用
//
// 在 ReAct loop 自然结束前调 verify(agent.resolvedAcceptance, ctx)。
// 失败时根据 retryPolicy 决定 retry / mark / escalate / abort。
//
// 允许依赖：shared/*、agent/*、prompt/* (naturalize)
// 禁止依赖：ipc/*

import type AjvType from 'ajv'
import log from 'electron-log'
import type {
  AcceptanceCriterion,
  AgentProfile,
  Deliverable,
  ExtractRule,
  RetryPolicy,
} from '@shared/types/agent'
import { naturalize } from '../prompt/naturalize'

export interface ToolEvent {
  toolName: string
  input?: { path?: string } & Record<string, unknown>
  result?: unknown
  error?: boolean
  errorMessage?: string
}

export interface VerifyContext {
  finalText: string
  toolEvents: ToolEvent[]
  agent: {
    profile: AgentProfile
    toolRegistry: { execute: (name: string, input: unknown, ctx: unknown) => Promise<unknown> }
  }
  /** 透传给 verifier-tool 的执行 ctx (sessionId/workspace 等) */
  toolExecuteCtx?: unknown
}

export interface VerifyFailure {
  criterion: AcceptanceCriterion
  reason: string
  details?: unknown
}

export interface VerifyResult {
  passed: boolean
  failures: VerifyFailure[]
}

export type RetryAction = 'retry' | 'mark-failed' | 'escalate' | 'abort'

export interface RetryDecision {
  action: RetryAction
  hint?: string
  metadata?: Record<string, unknown>
}

// Ajv 懒加载(B.4 陷阱:避免渲染端打包/启动期重型库加载)。
// 用 dynamic import 在首次 verify 调用时才装入。
let ajvInstance: AjvType | null = null
async function getAjv(): Promise<AjvType> {
  if (!ajvInstance) {
    const mod = await import('ajv')
    const Ctor = (mod.default ?? mod) as new (opts?: unknown) => AjvType
    ajvInstance = new Ctor({ allErrors: true, strict: false })
  }
  return ajvInstance
}

export async function verify(
  acceptance: AcceptanceCriterion[],
  ctx: VerifyContext,
): Promise<VerifyResult> {
  const failures: VerifyFailure[] = []

  for (const c of acceptance) {
    try {
      switch (c.type) {
        case 'deliverable-present': {
          const target = ctx.agent.profile.delivery.deliverables.find(
            (d) => d.id === c.deliverableId,
          )
          if (!target) {
            failures.push({
              criterion: c,
              reason: `deliverable "${c.deliverableId}" not declared in profile`,
            })
            break
          }
          const extracted = extractDeliverable(ctx.finalText, target, ctx.toolEvents)
          if (extracted === null) {
            failures.push({ criterion: c, reason: 'deliverable not found in output' })
            break
          }
          if (target.schema) {
            const ajv = await getAjv()
            const ok = ajv.validate(target.schema, extracted)
            if (!ok) {
              failures.push({ criterion: c, reason: 'schema mismatch', details: ajv.errors })
            }
          }
          if (target.mustContain && Array.isArray(target.mustContain)) {
            const text = typeof extracted === 'string' ? extracted : ctx.finalText
            for (const pat of target.mustContain) {
              try {
                if (!new RegExp(pat).test(text)) {
                  failures.push({
                    criterion: c,
                    reason: `mustContain pattern "${pat}" not matched`,
                  })
                }
              } catch (e) {
                failures.push({
                  criterion: c,
                  reason: `invalid mustContain regex: ${pat}`,
                  details: e,
                })
              }
            }
          }
          break
        }
        case 'tool-was-used': {
          if (c._implicit && c._knowledgePath) {
            // 严格匹配 read 工具 + path 命中
            const hit = ctx.toolEvents.some(
              (e) =>
                e.toolName === 'read' &&
                typeof e.input?.path === 'string' &&
                e.input.path.includes(c._knowledgePath!),
            )
            if (!hit) {
              failures.push({
                criterion: c,
                reason: `did not read "${c._knowledgePath}" via read tool`,
              })
            }
          } else {
            if (!ctx.toolEvents.some((e) => e.toolName === c.toolName)) {
              failures.push({ criterion: c, reason: `${c.toolName} never called` })
            }
          }
          break
        }
        case 'tool-not-used': {
          if (ctx.toolEvents.some((e) => e.toolName === c.toolName)) {
            failures.push({ criterion: c, reason: `${c.toolName} was called` })
          }
          break
        }
        case 'tool-not-failed': {
          const failed = ctx.toolEvents.filter((e) => e.toolName === c.toolName && e.error)
          if (failed.length > 0) {
            failures.push({
              criterion: c,
              reason: `${c.toolName} errored ${failed.length} time(s)`,
              details: failed.map((f) => f.errorMessage),
            })
          }
          break
        }
        case 'output-matches': {
          if (c.schema) {
            const extracted = extractJsonFromText(ctx.finalText)
            const ajv = await getAjv()
            const ok = ajv.validate(c.schema, extracted)
            if (!ok) {
              failures.push({ criterion: c, reason: 'schema mismatch', details: ajv.errors })
            }
          }
          if (c.pattern) {
            try {
              if (!new RegExp(c.pattern).test(ctx.finalText)) {
                failures.push({ criterion: c, reason: `pattern "${c.pattern}" not matched` })
              }
            } catch (e) {
              failures.push({ criterion: c, reason: `invalid pattern regex`, details: e })
            }
          }
          break
        }
        case 'verifier-tool': {
          try {
            const result = (await ctx.agent.toolRegistry.execute(
              c.toolName,
              c.args ?? {},
              ctx.toolExecuteCtx ?? {},
            )) as Record<string, unknown> | string | undefined
            if (typeof result === 'object' && result !== null) {
              const env = result as Record<string, unknown>
              if (env.__talor_error === true) {
                failures.push({
                  criterion: c,
                  reason: typeof env.message === 'string' ? env.message : 'verifier errored',
                  details: env,
                })
                break
              }
              if (env.pass === false) {
                failures.push({
                  criterion: c,
                  reason: typeof env.reason === 'string' ? env.reason : 'verifier rejected',
                  details: env,
                })
              }
            }
          } catch (e) {
            failures.push({
              criterion: c,
              reason: `verifier "${c.toolName}" threw: ${e instanceof Error ? e.message : String(e)}`,
            })
          }
          break
        }
        case 'llm-judge':
        case 'human-approval': {
          // P0 stub: 不做实际判定,默认通过 + 仅日志
          log.warn(`[contract-guard] ${c.type} not implemented in P0; treated as pass`, {
            type: c.type,
          })
          break
        }
      }
    } catch (e) {
      failures.push({
        criterion: c,
        reason: `internal error: ${e instanceof Error ? e.message : String(e)}`,
      })
    }
  }

  return { passed: failures.length === 0, failures }
}

/**
 * 按 deliverable.extractFrom 规则从 finalText / toolEvents 提取 deliverable 内容。
 * 返回 null = 未找到; 返回非 null = 抽取出的内容(可能是 string 或 parsed JSON object)
 */
export function extractDeliverable(
  text: string,
  deliverable: Deliverable,
  toolEvents: ToolEvent[],
): unknown {
  const rule: ExtractRule =
    deliverable.extractFrom ??
    (deliverable.format === 'json'
      ? { type: 'json-fenced-block', firstOrLast: 'last' }
      : { type: 'last-message' })

  switch (rule.type) {
    case 'last-message':
      return text || null
    case 'json-fenced-block': {
      const re = /```json\s*\n([\s\S]+?)\n```/g
      const matches = [...text.matchAll(re)]
      if (matches.length === 0) return null
      const target = rule.firstOrLast === 'first' ? matches[0] : matches[matches.length - 1]
      try {
        return JSON.parse(target[1])
      } catch {
        return null
      }
    }
    case 'regex-capture': {
      try {
        const m = new RegExp(rule.pattern).exec(text)
        if (!m) return null
        return rule.group !== undefined ? m[rule.group] : m[0]
      } catch {
        return null
      }
    }
    case 'tool-result': {
      const last = [...toolEvents].reverse().find((e) => e.toolName === rule.toolName)
      return last?.result ?? null
    }
  }
}

function extractJsonFromText(text: string): unknown {
  const re = /```json\s*\n([\s\S]+?)\n```/
  const m = re.exec(text)
  if (!m) {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  try {
    return JSON.parse(m[1])
  } catch {
    return null
  }
}

/**
 * 根据 retryPolicy 决定 verify 失败后的处理动作。
 *
 * @param attemptNumber 1-based。1 = 第一次调 verify 失败
 */
export function applyRetryPolicy(
  policy: RetryPolicy,
  failures: VerifyFailure[],
  attemptNumber: number,
): RetryDecision {
  const hasMustFail = failures.some((f) => (f.criterion.severity ?? 'must') === 'must')

  if (!hasMustFail) {
    // 仅 should 失败
    if (policy.onShouldFail === 'mark-only') {
      return {
        action: 'mark-failed',
        metadata: {
          dod_failed: false,
          should_failed: failures.map((f) => ({ criterion: f.criterion, reason: f.reason })),
        },
      }
    }
    if (policy.onShouldFail === 'retry-once' && attemptNumber === 1) {
      return {
        action: 'retry',
        hint: formatHint('quality criteria', failures),
      }
    }
    return {
      action: 'mark-failed',
      metadata: {
        dod_failed: false,
        should_failed: failures.map((f) => ({ criterion: f.criterion, reason: f.reason })),
      },
    }
  }

  // hasMustFail
  if (attemptNumber >= policy.maxAttempts) {
    if (policy.onMustFail === 'abort') {
      return {
        action: 'abort',
        metadata: {
          dod_failed: true,
          failures: failures.map((f) => ({ criterion: f.criterion, reason: f.reason })),
        },
      }
    }
    if (policy.onMustFail === 'retry-then-escalate') {
      return {
        action: 'escalate',
        metadata: {
          dod_failed: true,
          escalateTo: policy.escalateTo,
          failures: failures.map((f) => ({ criterion: f.criterion, reason: f.reason })),
        },
      }
    }
    return {
      action: 'mark-failed',
      metadata: {
        dod_failed: true,
        failures: failures.map((f) => ({ criterion: f.criterion, reason: f.reason })),
      },
    }
  }

  return {
    action: 'retry',
    hint: formatHint('acceptance', failures),
  }
}

function formatHint(label: string, failures: VerifyFailure[]): string {
  const lines = failures.map((f) => `- ${naturalize(f.criterion)} (got: ${f.reason})`)
  return `Acceptance retry — your previous response failed ${label} checks:\n${lines.join('\n')}\n\nPlease re-do this turn to satisfy these criteria.`
}
