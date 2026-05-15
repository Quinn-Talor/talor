// src/main/repos/reflection-ledger.ts —— 基础设施: Reflect 决策审计 repo
//
// 记录每次 Reflector 触发的决策结果, 供:
//   - UI session inspector debug "系统是如何引导 LLM 的"
//   - 数据驱动调优 reflect prompt / agent (看 confidence 分布 / 触发频率)
//   - 跨 reflector 行为对账 (judge 推翻 final 频率 / quote 重写命中率)
//
// 允许依赖: ../db, electron-log, uuid
// 禁止依赖: ipc/*

import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import { getDb } from '../db'

export type ReflectionOutputKind = 'hint' | 'wrap_up' | 'internal_nudge' | 'user_output'

export interface ReflectionEntry {
  id: string
  session_id: string
  step_index: number
  reflector: string
  output_kind: ReflectionOutputKind
  /** judge complete 标记 (judge-completion reflector 才填) */
  judge_complete: number | null
  judge_pending_items: string | null
  /** correction mask 计数 (quote-correction reflector 才填) */
  correction_mask_count: number | null
  /** 用户输出 / 内部纠正的文本 (user_output / internal_nudge 才填) */
  direct_output_text: string | null
  direct_output_label: string | null
  confidence: number
  reason: string | null
  created_at: string
}

interface RecordArgs {
  sessionId: string
  stepIndex: number
  reflector: string
  outputKind: ReflectionOutputKind
  confidence?: number
  reason?: string
  judge?: { complete: boolean; pendingItems: string[] }
  correction?: { totalMask: number }
  direct?: { text: string; label: string }
}

export const reflectionLedger = {
  record(args: RecordArgs): void {
    try {
      const db = getDb()
      db.prepare(
        `INSERT INTO reflection_ledger (
          id, session_id, step_index, reflector, output_kind,
          judge_complete, judge_pending_items,
          correction_mask_count,
          direct_output_text, direct_output_label,
          confidence, reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uuidv4(),
        args.sessionId,
        args.stepIndex,
        args.reflector,
        args.outputKind,
        args.judge ? (args.judge.complete ? 1 : 0) : null,
        args.judge ? JSON.stringify(args.judge.pendingItems) : null,
        args.correction?.totalMask ?? null,
        args.direct?.text ?? null,
        args.direct?.label ?? null,
        args.confidence ?? 0,
        args.reason ?? null,
      )
    } catch (err) {
      log.warn('[ReflectionLedger] record failed:', err)
    }
  },

  listBySession(sessionId: string): ReflectionEntry[] {
    try {
      const db = getDb()
      return db
        .prepare(
          'SELECT * FROM reflection_ledger WHERE session_id = ? ORDER BY step_index ASC, created_at ASC',
        )
        .all(sessionId) as ReflectionEntry[]
    } catch (err) {
      log.warn('[ReflectionLedger] listBySession failed:', err)
      return []
    }
  },
}
