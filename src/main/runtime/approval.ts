// src/main/runtime/approval.ts — 业务层：审批人 v2（agent-engine 的 Approver）
//
// 执行环境只有一个审批人；它按运行的 task.subject（会话 id）找这一轮登记的授权端口（渲染端的
// chat:permission-request 往返），没有登记就拒绝。引擎把一次调用的多个询问合并成一次请求，这里拆成
// 审批目标：越界路径若干、高风险目标至多一个（高风险工具、命中危险模式、hook 询问）。
//   - skill 目录只读免询问；
//   - 越界路径的拒绝规则对所有情况生效（匹配时兼顾规则的字面路径与真实路径）；
//   - 有高风险目标时每次询问、只给"允许一次"、不按规则放行也不写规则（与旧路径 RiskGate 一致）；
//   - 插件 hook 的询问（detail.reason 含 HOOK_ASK_REASON）同样作为高风险目标每次询问；
//   - 只有越界路径时先查授权规则，不命中再询问，用户选"记住"时写回规则（复用 createPermissionPort）。
// 审批人不设超时，由执行环境的 approvalTimeoutMs 判定（引擎记 APPROVAL_TIMEOUT）。
// 委托的子运行沿用父会话（task.subject）的授权端口；请求说明前加"子 agent <名字>："，用户看得出是谁发起的。
//
// 允许依赖: agent-engine（类型）、permissions/*、tools/path-guard、tools/types（类型）、runtime/agents、electron-log、uuid
// 禁止依赖: ipc/*、repos/*、db/*

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import type { Approver, AskRequest } from '@talor/agent-engine'
import { matchRules } from '../permissions/matcher'
import { permissionStore } from '../permissions/permission-store'
import { createPermissionPort, type PermissionUIPrompt } from '../permissions/port'
import { isWithin, realpathOrNearest, SKILL_ROOTS } from '../tools/path-guard'
import { HOOK_ASK_REASON } from './hooks'
import { pluginSkillRoots } from './plugins'
import type { PermissionRequestInput } from '../tools/types'
import { agentNameOf } from './agents'

const SUMMARY_CHARS = 500

const prompts = new Map<string, PermissionUIPrompt>()

/** 登记会话的授权端口；返回的注销函数只删除仍是这个端口的登记。 */
export function registerApprovalPort(sessionId: string, prompt: PermissionUIPrompt): () => void {
  prompts.set(sessionId, prompt)
  return () => {
    if (prompts.get(sessionId) === prompt) prompts.delete(sessionId)
  }
}

const clip = (text: string) => text.slice(0, SUMMARY_CHARS)

/** bash 的输入预览里取 command 原文；预览被截断或不是这个形状时返回 undefined。 */
function commandOf(preview: string): string | undefined {
  const m = /"command":"((?:[^"\\]|\\.)*)"/.exec(preview)
  if (!m) return undefined
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return undefined
  }
}

export function approvalTargetsOf(req: AskRequest & { callId: string; toolName: string }): {
  paths: PermissionRequestInput[]
  risk?: PermissionRequestInput
} {
  const paths: PermissionRequestInput[] = (req.detail?.paths ?? []).map((p) => ({
    toolName: req.toolName,
    reason: 'path_outside_workspace',
    absPath: p,
    inputSummary: clip(`${req.summary}\n${p}`),
  }))
  const input = req.detail?.input
  const hookAsk = req.detail?.reason?.includes(HOOK_ASK_REASON) ?? false
  // 只有沙箱的越界询问（hook 的询问总要单独问一次，不按已记住的规则放行）
  if (input === undefined && paths.length > 0 && !hookAsk) return { paths }
  // bash 取到命令原文时只显示命令：摘要里的 JSON 预览与它重复
  const command = req.toolName === 'bash' && input !== undefined ? commandOf(input) : undefined
  const shown = command ?? input
  const summary = command !== undefined ? req.toolName : req.summary
  const risk: PermissionRequestInput = {
    toolName: req.toolName,
    reason: 'high_risk_tool',
    ...(paths[0]?.absPath ? { absPath: paths[0].absPath } : {}),
    inputSummary: clip(
      [summary, req.detail?.reason, ...(req.detail?.paths ?? []), shown].filter(Boolean).join('\n'),
    ),
  }
  return { paths, risk }
}

/**
 * 越界路径的规则匹配：先按请求路径匹配；不命中时，旧规则存的是规范化后的字面路径、请求给的是真实路径，
 * 把规则 pattern 取真实路径再比一次（拒绝优先）。
 */
export function matchPathRule(
  workspace: string,
  toolName: string,
  absPath: string,
): 'allow' | 'deny' | 'unknown' {
  const direct = matchRules({ workspacePath: workspace, toolName, absPath })
  if (direct.decision !== 'unknown') return direct.decision
  const rules = permissionStore.allRulesFor(workspace).filter((rule) => rule.tool === toolName)
  for (const effect of ['deny', 'allow'] as const) {
    for (const rule of rules) {
      if (rule.effect !== effect) continue
      const prefix = rule.argPattern.endsWith('/')
      const base = prefix ? rule.argPattern.slice(0, -1) : rule.argPattern
      const real = realpathOrNearest(base) ?? base
      if (prefix ? isWithin(absPath, real) : absPath === real) {
        log.info(`[runtime] ${effect} by rule ${rule.id}（真实路径）: ${toolName}`)
        return effect
      }
    }
  }
  return 'unknown'
}

/** 直接询问一次，只给"允许一次"；窗口出错按拒绝处理。 */
async function askOnce(
  prompt: PermissionUIPrompt,
  target: PermissionRequestInput,
): Promise<boolean> {
  try {
    const resp = await prompt({
      requestId: uuidv4(),
      toolName: target.toolName,
      reason: target.reason,
      inputSummary: target.inputSummary,
      ...(target.absPath ? { absPath: target.absPath } : {}),
      suggestedPatterns: [],
    })
    return resp.decision === 'approved'
  } catch (err) {
    log.warn('[runtime] 授权窗口出错，按拒绝处理', target.toolName, err)
    return false
  }
}

export function createSessionApprover(
  opts: { skillRoots?: readonly string[] | (() => readonly string[]) } = {},
): Approver {
  const rootsOf =
    typeof opts.skillRoots === 'function' ? opts.skillRoots : () => opts.skillRoots ?? SKILL_ROOTS
  return {
    async approve(req, run) {
      const subject = run.task.subject
      const prompt = subject ? prompts.get(subject) : undefined
      if (!subject || !prompt) {
        log.warn(`[runtime] 会话 ${subject ?? '(无)'} 没有登记授权端口，拒绝 ${req.toolName}`)
        return { approved: false }
      }
      const workspace = run.task.scope?.workspace
      const targets = approvalTargetsOf(req)
      if (run.parentRunId !== undefined) {
        const prefix = `子 agent ${agentNameOf(run.agent.id) ?? run.agent.id}：\n`
        for (const t of [...targets.paths, ...(targets.risk ? [targets.risk] : [])]) {
          t.inputSummary = clip(prefix + t.inputSummary)
        }
      }
      const { paths, risk } = targets

      // skill 目录只读免询问
      const realRoots = (rootsOf() as readonly string[]).map(
        (root) => realpathOrNearest(root) ?? root,
      )
      if (
        !risk &&
        req.risk === 'low' &&
        paths.length > 0 &&
        paths.every((p) => realRoots.some((root) => isWithin(p.absPath!, root)))
      ) {
        return { approved: true }
      }

      // 越界路径的拒绝规则对所有情况生效
      if (workspace) {
        for (const p of paths) {
          if (matchPathRule(workspace, p.toolName, p.absPath!) === 'deny')
            return { approved: false }
        }
      }

      // 高风险：每次询问，不按规则放行、不给记住、不写规则
      if (risk) return { approved: await askOnce(prompt, risk) }

      // 只有越界路径
      if (workspace) {
        const port = createPermissionPort({ workspacePath: workspace, promptUI: prompt })
        for (const p of paths) {
          if (matchPathRule(workspace, p.toolName, p.absPath!) === 'allow') continue
          if (!(await port(p))) return { approved: false }
        }
        return { approved: true }
      }
      for (const p of paths) {
        if (!(await askOnce(prompt, p))) return { approved: false }
      }
      return { approved: true }
    },
  }
}

/** 会话审批人：只读免询问的根为 SKILL_ROOTS 加上启用插件的 skills 目录（插件重载后立即生效）。 */
export const sessionApprover: Approver = createSessionApprover({
  skillRoots: () => [...SKILL_ROOTS, ...pluginSkillRoots()],
})
