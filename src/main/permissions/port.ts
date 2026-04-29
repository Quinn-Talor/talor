// src/main/permissions/port.ts — 业务层：PermissionPort 组装器
//
// 把 matchRules + permissionStore + UI prompt 回调 组合成一个
// (toolName, args) → Promise<boolean> 的端口，注入到 ToolExecuteContext。
//
// 端口的调用方式（在工具 execute 内部）：
//   const ok = await ctx.requestPermission?.({
//     toolName: 'read',
//     reason: 'path_outside_workspace',
//     absPath: guard.absPath,
//     inputSummary: params.path,
//   })
//   if (!ok) return { output: 'User denied access.' }
//
// 允许依赖：permissions/*、shared/*
// 禁止依赖：ipc/*（UI 回调由入口层注入）

import log from 'electron-log'
import { v4 as uuidv4 } from 'uuid'
import { matchRules } from './matcher'
import { permissionStore } from './permission-store'
import { suggestBashPatterns, suggestPathPatterns } from './pattern-suggestions'
import type { PermissionPort, PermissionRequestInput } from '../tools/types'
import type {
  PermissionRequest,
  PermissionResponse,
  PatternSuggestion,
} from '@shared/types/permissions'

/**
 * UI 回调：把 PermissionRequest 发给渲染层，等用户点击后解析成 PermissionResponse。
 * 由入口层实现（ipc/permission.ts），业务层只依赖这个签名。
 */
export type PermissionUIPrompt = (req: PermissionRequest) => Promise<PermissionResponse>

/** 构造参数：需要知道 workspacePath 和 UI prompt 回调。 */
export interface CreatePermissionPortOpts {
  workspacePath: string
  promptUI: PermissionUIPrompt
  /** 只读 file 工具组，用于批量授权勾选框。默认值见下方 DEFAULT_READONLY_FILE_GROUP。 */
  readonlyFileGroup?: string[]
}

const DEFAULT_READONLY_FILE_GROUP = ['read', 'ls', 'glob', 'grep']

/**
 * 组装一个 PermissionPort。
 *
 * 执行顺序：
 *   1. matchRules → deny/allow/unknown
 *      - deny: 立即返回 false
 *      - allow: 立即返回 true
 *      - unknown: 继续
 *   2. unknown → 调 promptUI 让用户选择
 *   3. 用户选了 pattern → 写规则（session 或 persisted）
 *   4. 若是只读 file 工具且用户勾选了 bulk grant → 同 pattern 批量写入多条规则
 *   5. 返回 true/false
 */
export function createPermissionPort(opts: CreatePermissionPortOpts): PermissionPort {
  const { workspacePath, promptUI } = opts
  const readonlyGroup = opts.readonlyFileGroup ?? DEFAULT_READONLY_FILE_GROUP

  return async function requestPermission(input: PermissionRequestInput): Promise<boolean> {
    // Step 1: matcher
    const match = matchRules({
      workspacePath,
      toolName: input.toolName,
      absPath: input.absPath,
      bashCommand: input.bashCommand,
    })

    if (match.decision === 'allow') {
      log.info(`[PermissionPort] allow by rule ${match.ruleId}: ${input.toolName}`)
      return true
    }
    if (match.decision === 'deny') {
      log.info(`[PermissionPort] deny by rule ${match.ruleId}: ${input.toolName}`)
      return false
    }

    // Step 2: prompt UI
    const suggestions = buildSuggestions(input)
    const isReadonlyFileTool =
      input.reason === 'path_outside_workspace' && readonlyGroup.includes(input.toolName)
    const bulkGroup = isReadonlyFileTool ? readonlyGroup : undefined

    const req: PermissionRequest = {
      requestId: uuidv4(),
      toolName: input.toolName,
      reason: input.reason,
      inputSummary: input.inputSummary,
      absPath: input.absPath,
      suggestedPatterns: suggestions,
      bulkGrantGroup: bulkGroup,
    }

    let response: PermissionResponse
    try {
      response = await promptUI(req)
    } catch (err) {
      log.warn('[PermissionPort] promptUI failed, treating as denied:', err)
      return false
    }

    if (response.decision !== 'approved') {
      return false
    }

    // Step 3: 写规则（仅当用户选了 pattern，而非 "Allow once"）
    if (response.grantPatternId) {
      const chosen = suggestions.find(s => s.id === response.grantPatternId)
      if (chosen) {
        writeRuleForGrant({
          workspacePath,
          toolName: input.toolName,
          pattern: chosen.pattern,
          persist: !!response.rememberAcrossSessions,
        })

        // Step 4: 批量授权：同 pattern 应用到用户勾选的工具组
        const bulk = response.bulkGrantTools ?? []
        for (const tool of bulk) {
          if (tool === input.toolName) continue   // 主工具已写过
          if (!readonlyGroup.includes(tool)) continue   // 防御性过滤
          writeRuleForGrant({
            workspacePath,
            toolName: tool,
            pattern: chosen.pattern,
            persist: !!response.rememberAcrossSessions,
          })
        }
      }
    }

    return true
  }
}

function buildSuggestions(input: PermissionRequestInput): PatternSuggestion[] {
  if (input.toolName === 'bash' && input.bashCommand) {
    return suggestBashPatterns(input.bashCommand)
  }
  if (input.absPath) {
    return suggestPathPatterns(input.absPath)
  }
  return []
}

function writeRuleForGrant(opts: {
  workspacePath: string
  toolName: string
  pattern: string
  persist: boolean
}): void {
  const rule = {
    tool: opts.toolName,
    argPattern: opts.pattern,
    effect: 'allow' as const,
  }
  if (opts.persist) {
    permissionStore.addPersistedRule(opts.workspacePath, rule)
  } else {
    permissionStore.addSessionRule(opts.workspacePath, rule)
  }
}
