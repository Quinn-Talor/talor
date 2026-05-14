// src/main/repos/side-effect-ledger.ts —— 基础设施: 副作用日志 repo (v3.6 L4)
//
// 记录所有写操作 / 副作用工具调用,供:
//   - forced summary 内嵌摘要,告知用户"本 turn 已发生 X 个副作用"
//   - 用户审计本 session 改动了什么
//   - 父 session 委托给子 session 时聚合查询 (V1 仅父-子两级,不递归)
//
// 允许依赖: ../db, electron-log, uuid
// 禁止依赖: ipc/*

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { getDb } from '../db'

/**
 * 副作用日志一行。
 *
 * confirmed_by 枚举:
 *   - 'pendingBlock': LLM 主动 emit pending_confirm block, 走 confirm UI
 *   - 'fallback':     LLM 没 emit, 代码 regex 兜底命中, 走 confirm UI
 *   - 'memory':       命中 SessionApprovalMemory, 自动通过 (LLM 曾 emit pending_confirm)
 *   - 'auto-low':     无任何风险信号, 直接通过 (理论上不该进 ledger, 但保留兜底语义)
 *   - 'high-static':  v3.7.2: HIGH 静态工具 (bash/write/edit), 系统生成 summary, 用户 confirm
 */
export interface SideEffectEntry {
  id: string
  session_id: string
  /** 子 session 写副作用时填 root parent_session_id, 供父聚合查询 */
  parent_session_id: string | null
  message_id: string
  tool_call_id: string
  step_index: number
  /** 操作分类标签 (e.g. 'sql:INSERT' | 'file:write' | 'mcp:lark.doc_create') */
  op: string
  /** 操作目标 (e.g. 'game.game' | '/path/file' | doc_id) */
  target: string
  /** 给用户看的操作摘要 (来自 pending_confirm block summary 或 tool input) */
  preview: string
  confirmed_by: 'pendingBlock' | 'fallback' | 'memory' | 'auto-low' | 'high-static'
  user_decision: 'approved' | 'denied' | 'auto'
  created_at: string
}

export class SideEffectLedger {
  /**
   * 记录一条副作用日志。返回完整 entry (含生成的 id + timestamp)。
   *
   * 落库失败时 throw, 由调用方决定是否吞掉 (一般工具执行成功后调用,
   * 落库失败不应阻塞工具结果回流)。
   */
  record(entry: Omit<SideEffectEntry, 'id' | 'created_at'>): SideEffectEntry {
    const full: SideEffectEntry = {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      ...entry,
    }
    try {
      getDb()
        .prepare(
          `INSERT INTO side_effect_log (
            id, session_id, parent_session_id, message_id, tool_call_id,
            step_index, op, target, preview, confirmed_by, user_decision, created_at
          ) VALUES (
            @id, @session_id, @parent_session_id, @message_id, @tool_call_id,
            @step_index, @op, @target, @preview, @confirmed_by, @user_decision, @created_at
          )`,
        )
        .run(full)
    } catch (err) {
      log.error('[SideEffectLedger] record failed:', err)
      throw err
    }
    return full
  }

  /**
   * 列出某 session (作为 root) 的所有副作用,包括其所有子 session。
   *
   * V1 仅父-子两级:
   *   - 直接 session_id 匹配 (本 session 直接调用)
   *   - parent_session_id 匹配 root (子 session 调用,归父)
   *
   * 不递归处理孙级,留 V2 视实际需求。
   *
   * 过滤选项:
   *   - sinceTime (ISO timestamp): 仅取 created_at >= 此值的 entries (本 turn 划界)
   *   - sinceStepIndex: 仅取 step_index >= 此值。注:step_index 跨 turn 重置,
   *     单独不能区分 turn,但同一 turn 内可作"从第 N 步起"过滤
   *
   * 两者都给时为 AND 关系。都不给时返回全部 (历史聚合视图)。
   */
  listByRootSession(
    rootSessionId: string,
    opts?: { sinceTime?: string; sinceStepIndex?: number },
  ): SideEffectEntry[] {
    // 注意 SQL 优先级: AND 高于 OR, 必须给 OR 加括号。
    // 否则 (A OR B AND C) 变成 (A OR (B AND C)), session_id 匹配的不被过滤。
    const filters: string[] = []
    const params: Array<string | number> = [rootSessionId, rootSessionId]
    if (opts?.sinceTime !== undefined) {
      filters.push('created_at >= ?')
      params.push(opts.sinceTime)
    }
    if (opts?.sinceStepIndex !== undefined) {
      filters.push('step_index >= ?')
      params.push(opts.sinceStepIndex)
    }
    const filterClause = filters.length > 0 ? `AND ${filters.join(' AND ')}` : ''
    const rows = getDb()
      .prepare(
        `SELECT * FROM side_effect_log
         WHERE (session_id = ? OR parent_session_id = ?)
         ${filterClause}
         ORDER BY created_at ASC`,
      )
      .all(...params) as SideEffectEntry[]
    return rows
  }

  /**
   * 构造 forced summary 内嵌的副作用摘要 markdown。
   *
   * 空时返回空字符串(forced summary 不附加)。
   *
   * sinceTime 是 ISO timestamp 字符串 — 一般取本 turn 的起始时刻 (loopStartTime),
   * 这样摘要只覆盖本 turn 的副作用,不会把历史 turn 的写操作也再列一遍。
   *
   * 输出示例:
   *   ## Side effects this turn
   *
   *   - ✓ sql:INSERT on game.rule (approved)
   *     preview: INSERT INTO game.rule (...) VALUES (...)
   *   - ✓ sql:INSERT on game.event (auto via approval memory)
   *   - (subagent X) ✓ file:write on /workspace/doc.md (approved)
   */
  buildSummary(rootSessionId: string, sinceTime: string): string {
    const entries = this.listByRootSession(rootSessionId, { sinceTime })
    if (entries.length === 0) return ''

    const lines: string[] = ['', '## Side effects this turn', '']
    for (const e of entries) {
      const isSubagent = e.parent_session_id === rootSessionId && e.session_id !== rootSessionId
      const prefix = isSubagent ? `  - (subagent ${e.session_id.slice(0, 8)}) ` : '- '
      const decisionTag =
        e.user_decision === 'approved'
          ? e.confirmed_by === 'memory'
            ? 'auto via approval memory'
            : 'approved'
          : e.user_decision === 'denied'
            ? 'denied'
            : 'auto'
      lines.push(`${prefix}✓ ${e.op} on ${e.target} (${decisionTag})`)
      if (e.preview && e.preview !== e.target) {
        lines.push(`    preview: ${e.preview.slice(0, 200)}${e.preview.length > 200 ? '…' : ''}`)
      }
    }
    return lines.join('\n')
  }

  /**
   * 清空某 session 的所有副作用日志。
   * 一般由 sessionRepo.delete 通过 FK CASCADE 自动触发, 此方法供手动场景用。
   */
  clearBySession(sessionId: string): void {
    getDb().prepare('DELETE FROM side_effect_log WHERE session_id = ?').run(sessionId)
  }
}

/** 单例 (与其他 repo 一致风格)。 */
export const sideEffectLedger = new SideEffectLedger()
