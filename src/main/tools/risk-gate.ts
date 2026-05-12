// src/main/tools/risk-gate.ts —— 业务层: v3.6 L3 风险 Gate
//
// 拦截工具调用 → 判断是否高危 → 弹 confirmTool 让用户决定。
//
// 评估优先级 (LLM 主控 + 代码兜底):
//   1. 静态 riskLevel='HIGH' (builtin bash/write/edit) → 走 legacy confirm 路径
//      (buildTools 已实现, 此 Gate 不介入, 返回 'pass-to-legacy')
//   2. LLM 主动在 stepText emit pending_confirm block → confirm + 可记忆 (主路径)
//   3. 代码通用 regex 扫 input 兜底 → confirm (无主动声明时的安全网)
//   4. 都没命中 → 直接通过
//
// 设计原则 #6: 业务/语义判断交给 LLM (通过 pending_confirm block),
// 代码只做执行管控 + 通用兜底, 不绑业务名 (regex 仅识别 DROP/INSERT/rm -rf 等
// 通用语法层关键字)。
//
// 允许依赖: ./session-approval-memory, ../repos/side-effect-ledger,
//          @shared/talor-blocks/talor-block-schema, ../ipc/tool-confirm (类型)
// 禁止依赖: ipc/* 的实现 (端口注入)

import log from 'electron-log'
import type { PendingConfirmBlock, TalorBlock } from '@shared/talor-blocks/talor-block-schema'
import type { ToolDefinition, ToolExecuteContext } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { SessionApprovalMemory } from './session-approval-memory'
import { SideEffectLedger } from '../repos/side-effect-ledger'

/**
 * Gate 决策:
 *   - pass:           允许执行
 *   - deny:           拒绝执行 (返 USER_DENIED envelope)
 *   - pass-to-legacy: 跳过 Gate, 由 buildTools 走旧 high-risk confirm 路径
 *                     (仅静态 riskLevel='HIGH' 的 builtin 工具适用)
 */
export interface GateDecision {
  action: 'pass' | 'deny' | 'pass-to-legacy'
  /** 通过路径: 给 Ledger 记账用 */
  via: 'pendingBlock' | 'fallback' | 'memory' | 'auto-low' | 'legacy'
  /** confirm 弹窗用的 summary (LLM 提供 or 代码生成) */
  summary?: string
  /** patternKey (走 memory 路径时填) */
  patternKey?: string
  /** 用户是否选择 remember (走 pendingBlock + memory=false 路径时填) */
  rememberRequested?: boolean
}

/**
 * 代码兜底通用危险关键字 — 不绑业务名,只识别"操作类型"层。
 *
 * 命中 → 视为高危, 弹 confirm 让用户决定。
 * 业务层判断 (production schema / 关键表名 / 等) 由 LLM 通过 pending_confirm
 * 主动声明, 不在此处。
 */
const FALLBACK_DANGER_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: 'SQL DDL: DROP/TRUNCATE' },
  { pattern: /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE)\b/i, reason: 'SQL DML' },
  { pattern: /\brm\s+-rf?\s+\//, reason: 'rm -rf' },
  { pattern: /\bsudo\b/, reason: 'sudo' },
  { pattern: />\s*\/etc\//, reason: 'redirect to /etc' },
  { pattern: /chmod\s+777/, reason: 'chmod 777' },
]

/**
 * SQL 噪声剥离 — 避免误报字符串字面量 / 注释中的关键字。
 *
 * 通用化原则: 不针对特定 mysql/postgres 方言, 标准 SQL 注释 + 字符串字面量即可。
 */
function stripSqlNoise(text: string): string {
  return text
    .replace(/--[^\n]*/g, '') // 行注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/'(?:[^']|'')*'/g, "''") // 单引号字符串
    .replace(/"(?:[^"]|"")*"/g, '""') // 双引号字符串
}

export class RiskGate {
  /**
   * @param memory  session 级 approval memory (走 pendingBlock + remember 路径用)
   * @param ledger  副作用日志 — Gate 内部决定通过后立即 record,buildTools 不必
   *                再调一次。匹配方案 §5.2 的双注入契约。
   */
  constructor(
    private readonly memory: SessionApprovalMemory,
    private readonly ledger: SideEffectLedger,
  ) {}

  /**
   * 评估某工具调用的风险等级 + 决定执行策略。
   *
   * 顺序很重要:
   *   1. 静态 high riskLevel → pass-to-legacy (旧路径接管)
   *   2. LLM 主动声明 pending_confirm block → 主路径 confirm
   *   3. 代码兜底 regex → fallback confirm
   *   4. 默认 pass
   *
   * 通过 (action='pass' 且 via ∈ pendingBlock/fallback/memory) 时,Gate 内部
   * 直接 record ledger — buildTools 不必再调一次,匹配方案 §5.2 的双注入契约。
   * auto-low 路径不记账 (无风险信号,记账只会噪声化日志)。
   */
  async gate(
    tool: ToolDefinition,
    input: unknown,
    ctx: ToolExecuteContext,
    confirmTool: ToolConfirmPort,
  ): Promise<GateDecision> {
    // 路径 1: 静态高危 builtin 工具 (bash/write/edit) → legacy 路径
    // 不在此处弹 confirm, 避免与现有路径双重弹窗
    if (tool.riskLevel === 'HIGH') {
      return { action: 'pass-to-legacy', via: 'legacy' }
    }

    // 路径 2: LLM 主动声明 pending_confirm block (主路径)
    const pendingBlock = findPendingConfirmBlock(ctx.currentStepBlocks)
    if (pendingBlock) {
      // 检查 memory: 同 patternKey 已批准 → 自动通过
      if (
        pendingBlock.pattern &&
        pendingBlock.risk_level !== 'destructive' &&
        this.memory.isApproved(ctx.sessionId, pendingBlock.pattern)
      ) {
        this.recordLedger(tool.name, ctx, 'memory', pendingBlock.summary, input, 'auto')
        return {
          action: 'pass',
          via: 'memory',
          summary: pendingBlock.summary,
          patternKey: pendingBlock.pattern,
        }
      }

      // 走 confirm UI
      const allowRemember = !!pendingBlock.pattern && pendingBlock.risk_level !== 'destructive'
      const decision = await this.callConfirm(confirmTool, {
        sessionId: ctx.sessionId,
        toolCallId: extractToolCallId(ctx),
        toolName: tool.name,
        summary: pendingBlock.summary,
        preview: pendingBlock.preview ?? safeStringify(input).slice(0, 500),
        allowRemember,
        patternKey: pendingBlock.pattern,
        riskLevel: pendingBlock.risk_level ?? 'high',
      })

      if (decision.approved) {
        if (decision.remember && allowRemember && pendingBlock.pattern) {
          this.memory.approve(ctx.sessionId, pendingBlock.pattern)
        }
        this.recordLedger(tool.name, ctx, 'pendingBlock', pendingBlock.summary, input, 'approved')
        return {
          action: 'pass',
          via: 'pendingBlock',
          summary: pendingBlock.summary,
          patternKey: pendingBlock.pattern,
          rememberRequested: decision.remember,
        }
      }
      this.recordLedger(tool.name, ctx, 'pendingBlock', pendingBlock.summary, input, 'denied')
      return { action: 'deny', via: 'pendingBlock', summary: pendingBlock.summary }
    }

    // 路径 3: 代码兜底 regex (LLM 没主动声明但 input 含危险关键字)
    const fallback = detectFallbackRisk(input)
    if (fallback) {
      log.warn(`[RiskGate] fallback risk detected for tool ${tool.name}: ${fallback.reason}`)
      const decision = await this.callConfirm(confirmTool, {
        sessionId: ctx.sessionId,
        toolCallId: extractToolCallId(ctx),
        toolName: tool.name,
        summary: `⚠️ Model did not declare ✋: ${fallback.reason}`,
        preview: safeStringify(input).slice(0, 500),
        allowRemember: false, // 兜底路径不允许记忆, 鼓励 LLM 主动声明
        patternKey: undefined,
        riskLevel: 'high',
      })
      this.recordLedger(
        tool.name,
        ctx,
        'fallback',
        fallback.reason,
        input,
        decision.approved ? 'approved' : 'denied',
      )
      return {
        action: decision.approved ? 'pass' : 'deny',
        via: 'fallback',
        summary: fallback.reason,
      }
    }

    // 路径 4: 无风险信号 → 直接通过, 不记账 (auto-low 仅返决策, 不污染 ledger)
    return { action: 'pass', via: 'auto-low' }
  }

  /**
   * 内部 ledger 写入封装。失败仅日志, 不影响 gate 决策返回。
   *
   * preview 不带 ANSI / 长串截断: ledger 是审计日志,过长 preview 反而影响读
   * 体验 — buildInputSummary-style 截断 500 字符即够用 (与 buildTools 旧路径
   * 一致行为)。
   */
  private recordLedger(
    toolName: string,
    ctx: ToolExecuteContext,
    via: 'pendingBlock' | 'fallback' | 'memory',
    summary: string | undefined,
    input: unknown,
    userDecision: 'approved' | 'denied' | 'auto',
  ): void {
    try {
      this.ledger.record({
        session_id: ctx.sessionId,
        parent_session_id: ctx.rootSessionId ?? null,
        message_id: ctx.parentMessageIdForLedger ?? '',
        tool_call_id: extractToolCallId(ctx),
        step_index: ctx.stepIndex ?? 0,
        op: `${toolName}:invoke`,
        target: summary?.slice(0, 200) ?? toolName,
        preview: safeStringify(input).slice(0, 500),
        confirmed_by: via,
        user_decision: userDecision,
      })
    } catch (err) {
      log.warn('[RiskGate] ledger.record failed (non-fatal):', err)
    }
  }

  /**
   * 包装 ToolConfirmPort 调用,兼容现有 boolean 返回 + 提取 remember 信号。
   *
   * V3.6 扩展: confirmTool 可能返:
   *   - boolean (旧路径,无 remember 概念)
   *   - { approved, remember } (新路径,RiskGate 才用)
   * 这里统一为 { approved, remember }。
   */
  private async callConfirm(
    confirmTool: ToolConfirmPort,
    req: import('@shared/types/message').ToolConfirmRequest,
  ): Promise<{ approved: boolean; remember: boolean }> {
    const result = await confirmTool(req)
    if (typeof result === 'boolean') {
      return { approved: result, remember: false }
    }
    return {
      approved: result.approved,
      remember: !!result.remember,
    }
  }
}

// ─── helpers ───────────────────────────────────────────────────────────

function findPendingConfirmBlock(blocks: TalorBlock[] | undefined): PendingConfirmBlock | null {
  if (!blocks || blocks.length === 0) return null
  for (const b of blocks) {
    if (b.type === 'pending_confirm') return b
  }
  return null
}

export function detectFallbackRisk(input: unknown): { reason: string } | null {
  // 扁平化提取所有字符串字段后再 stripSqlNoise + regex。
  // 不能直接 JSON.stringify(input) — stripSqlNoise 的双引号字面量剥离规则会把
  // JSON 内的 "key":"value" 整段剥光,导致漏检。
  const text = stripSqlNoise(flattenStringValues(input))
  for (const { pattern, reason } of FALLBACK_DANGER_PATTERNS) {
    if (pattern.test(text)) return { reason }
  }
  return null
}

/**
 * 递归提取 input 中所有 string 字段, 用空格连接为一个字符串供 regex 扫描。
 * 数组/对象逐项处理; 非 string 值忽略。
 */
function flattenStringValues(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(flattenStringValues).join(' ')
  if (typeof v === 'object') {
    return Object.values(v).map(flattenStringValues).join(' ')
  }
  return ''
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function extractToolCallId(ctx: ToolExecuteContext): string {
  // ToolExecuteContext 没有标准的 toolCallId 字段;
  // V1: 用 ctx.sessionId 拼一个临时 ID, 不影响功能 (confirm 协议靠 toolCallId 路由响应)
  // V2: ctx 应当携带 toolCallId
  return (ctx as { toolCallId?: string }).toolCallId ?? `risk-gate-${ctx.sessionId}-${Date.now()}`
}

/** 测试用 export (内部 helper) */
export const __TEST__ = { stripSqlNoise, detectFallbackRisk, findPendingConfirmBlock }
