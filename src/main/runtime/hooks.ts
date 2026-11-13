// src/main/runtime/hooks.ts — 业务层：插件 hook 进执行环境（能力架构方案 §3.6、§6 B2）
//
// 引擎 adaptHooks 把 Claude Code 格式的 hook 翻译成须知、权限规则、守卫与强制验收；Talor 在 A3 组装好的
// 执行环境配置上追加：须知接在章程须知之后，权限规则插在工作区沙箱之后，守卫、验收接在已有的之后。
// hook 看到的工具名与输入经 claudeToolView 改成 Claude Code 的形状（Bash、Write、tool_input.file_path），
// 插件里按 Claude Code 写的 matcher 与脚本照样生效。hook 发起的询问带 HOOK_ASK_REASON 标记，
// 审批人据此每次询问、不按已记住的规则放行。没有 hook 时原样返回同一个配置。
//
// 允许依赖: agent-engine、electron-log
// 禁止依赖: ipc/*、repos/*、db/*

import log from 'electron-log'
import {
  adaptHooks,
  type EnvironmentConfig,
  type HookSpec,
  type HookToolView,
  type PermissionRule,
} from '@talor/agent-engine'

/** hook 询问的标记：审批人看到它时直接询问用户，不查已记住的规则、不给"记住"。 */
export const HOOK_ASK_REASON = 'plugin-hook'

const CLAUDE_TOOL_NAMES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
  glob: 'Glob',
  grep: 'Grep',
  ls: 'LS',
}

const FILE_TOOLS = new Set(['read', 'write', 'edit'])
const EDIT_FIELDS: Record<string, string> = {
  old: 'old_string',
  new: 'new_string',
  replaceAll: 'replace_all',
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Talor 内置工具 → Claude Code 的工具名与参数名；其他工具（含 MCP）原样。 */
export function claudeToolView(view: HookToolView): HookToolView {
  const name = CLAUDE_TOOL_NAMES[view.toolName]
  if (!name) return view
  if (!isPlainObject(view.input)) return { toolName: name, input: view.input }
  const input: Record<string, unknown> = { ...view.input }
  if (FILE_TOOLS.has(view.toolName) && 'path' in input) {
    input.file_path = input.path
    delete input.path
  }
  if (view.toolName === 'edit') {
    for (const [from, to] of Object.entries(EDIT_FIELDS)) {
      if (from in input) {
        input[to] = input[from]
        delete input[from]
      }
    }
  }
  return { toolName: name, input }
}

/** 给 hook 权限规则发起的询问加上 HOOK_ASK_REASON。 */
export function markHookAsks(rules: PermissionRule[]): PermissionRule[] {
  return rules.map((rule) => ({
    ...rule,
    async permit(call, run, ctx) {
      const out = await rule.permit(call, run, ctx)
      if (typeof out !== 'object' || out === null || !('ask' in out)) return out
      const reason = [out.ask.detail?.reason, HOOK_ASK_REASON].filter(Boolean).join('；')
      return { ...out, ask: { ...out.ask, detail: { ...out.ask.detail, reason } } }
    },
  }))
}

/** 在执行环境配置上追加 hook 的翻译结果；没有 hook 时返回同一个配置。 */
export function withHooks(config: EnvironmentConfig, hooks: HookSpec[]): EnvironmentConfig {
  if (hooks.length === 0) return config
  const adapted = adaptHooks(hooks, { toolView: claudeToolView })
  const hookRules = markHookAsks(adapted.permissions)
  const existing = config.permissions ?? []
  const i = existing.findIndex((r) => r.id === 'workspace-sandbox')
  const permissions =
    i >= 0
      ? [...existing.slice(0, i + 1), ...hookRules, ...existing.slice(i + 1)]
      : [...hookRules, ...existing]
  if (adapted.notifications.length > 0) {
    log.info(
      '[runtime] 插件 hook 不支持的事件已忽略：' +
        adapted.notifications.map((h) => `${h.event}(${h.source ?? ''})`).join('、'),
    )
  }
  return {
    ...config,
    notice: [...(config.notice ?? []), ...adapted.notice],
    permissions,
    guards: [...(config.guards ?? []), ...adapted.guards],
    checks: [...(config.checks ?? []), ...adapted.checks],
  }
}
