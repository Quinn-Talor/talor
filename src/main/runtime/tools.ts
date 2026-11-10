// src/main/runtime/tools.ts — 业务层：内置工具适配为 agent-engine 的 ToolDef
//
// 路径与风险按引擎的机制把关：每个工具声明本次调用要读写的路径（safety.access），交给执行环境的
// workspaceSandbox；高风险工具交给 riskApproval 询问委托人。工具内部的 resolveToolPath 仍然硬拒绝
// 敏感路径；它对工作区外路径的越界确认只放行本次调用声明过的路径（引擎已经把关过），其余拒绝。
// 工具以字符串或信封返回的失败转成确定性的引擎错误，执行抛异常转成 TOOL_EXCEPTION。
//
// 允许依赖: agent-engine、tools/*
// 禁止依赖: ipc/*、repos/*、db/*

import { isAbsolute, resolve } from 'path'
import { toolContent, toolError, type ToolAccess, type ToolDef } from 'agent-engine'
import {
  HOME_SENSITIVE_ENTRIES,
  SYSTEM_SENSITIVE_ROOTS,
  isWithin,
  realpathOrNearest,
} from '../tools/path-guard'
import { runToolPipeline } from '../tools/registry'
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  isErrorOutput,
  isToolErrorEnvelope,
  isToolImageOutput,
  type PermissionPort,
  type ToolDefinition,
  type ToolResult,
} from '../tools/types'

/** 追加给引擎沙箱的敏感路径（引擎的内置名单之外）。 */
export const TALOR_SENSITIVE_PATHS: readonly string[] = Object.freeze([
  ...SYSTEM_SENSITIVE_ROOTS,
  ...HOME_SENSITIVE_ENTRIES.map((entry) => `~/${entry}`),
])

/** 引擎的超时比工具自己的多留 5 秒，让 bash 等工具先报出自己的超时信息。 */
const ENGINE_TOOL_TIMEOUT_GRACE_MS = 5_000

function stringField(input: unknown, key: string): string | undefined {
  if (input === null || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/** 工具本次调用要读写的路径；bash 不声明，一律走风险审批。 */
export function accessOf(toolName: string, input: unknown): ToolAccess | undefined {
  switch (toolName) {
    case 'read':
      return { read: [stringField(input, 'path') ?? ''] }
    case 'ls':
    case 'grep':
      return { read: [stringField(input, 'path') ?? '.'] }
    case 'glob':
      return { read: ['.'] }
    case 'write':
    case 'edit':
      return { write: [stringField(input, 'path') ?? ''] }
    default:
      return undefined
  }
}

const realPath = (path: string) => realpathOrNearest(path) ?? path

/** 工具内部越界确认的实现：只放行本次调用声明过、按真实路径落在其内的路径。 */
export function declaredPathPermission(
  access: ToolAccess | undefined,
  workspace: string,
): PermissionPort {
  const declared = [...(access?.read ?? []), ...(access?.write ?? [])]
    .filter((path) => path !== '')
    .map((path) => realPath(isAbsolute(path) ? path : resolve(workspace, path)))
  return async (req) => {
    if (req.reason !== 'path_outside_workspace' || !req.absPath) return false
    const target = realPath(req.absPath)
    return declared.some((root) => target === root || isWithin(target, root))
  }
}

const deterministic = (code: string, message: string, hint?: string) => ({
  ...toolError(code, message, hint),
  errorClass: 'deterministic' as const,
})

export function toEngineOutput(result: ToolResult): unknown {
  if (result.error !== undefined) return toolError('TOOL_EXCEPTION', String(result.error))
  const out = result.output
  if (isToolImageOutput(out)) {
    return toolContent([
      { type: 'text', text: out.label },
      { type: 'image', image: out.base64, mediaType: out.mediaType },
    ])
  }
  if (isToolErrorEnvelope(out)) return deterministic(out.code, out.message, out.hint)
  // 字符串失败（bash 非零退出、超时等）依赖环境，下次可能不同：不强加类别，由引擎按错误码判为瞬时（F25）
  if (isErrorOutput(out)) {
    return toolError('TOOL_FAILED', typeof out === 'string' ? out : JSON.stringify(out))
  }
  return typeof out === 'string' ? out : JSON.stringify(out)
}

export function toEngineTool(def: ToolDefinition): ToolDef {
  const highRisk = def.riskLevel === 'HIGH'
  const validate = def.validate
  const toolTimeoutMs = def.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.zodSchema ?? def.parameters,
    execution: {
      effect: highRisk ? 'side_effect' : 'none',
      timeoutMs: toolTimeoutMs + ENGINE_TOOL_TIMEOUT_GRACE_MS,
    },
    safety: {
      risk: highRisk ? 'high' : 'low',
      ...(accessOf(def.name, {}) !== undefined
        ? { access: (input: unknown) => accessOf(def.name, input) ?? {} }
        : {}),
    },
    ...(validate
      ? {
          validate: (input, ctx) => {
            const result = validate(input, {
              workspace: ctx.scope.workspace ?? '',
              sessionId: ctx.task.subject ?? '',
            })
            return result.ok
              ? { ok: true as const }
              : { error: toolError('INVALID_INPUT', result.error ?? '输入不合法') }
          },
        }
      : {}),
    async execute(input, ctx) {
      const workspace = ctx.scope.workspace ?? ''
      const result = await runToolPipeline(def, input, {
        workspace,
        sessionId: ctx.task.subject ?? '',
        abortSignal: ctx.signal,
        toolCallId: ctx.callId,
        toolTimeoutMs,
        requestPermission: declaredPathPermission(accessOf(def.name, input), workspace),
      })
      return toEngineOutput(result)
    },
  }
}
