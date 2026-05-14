// src/main/tools/risk-gate.ts —— 业务层: L3 风险 Gate (v4)
//
// 拦截工具调用 → 判断是否高危 → 弹 confirmTool 让用户决定。
//
// 评估优先级:
//   1. 静态 riskLevel='HIGH' (builtin bash/write/edit) → 系统生成 summary + 必须 confirm
//   2. SessionApprovalMemory 命中 (基于 input 派生 patternKey) → 自动通过
//   3. 代码通用 regex 扫 input 兜底 → confirm (DROP/INSERT/rm -rf/sudo 等关键字)
//   4. 都没命中 → 直接通过
//
// 设计原则: 系统执行管控 + 通用兜底, 不绑业务名。LLM 不再 emit pending_confirm
// fenced JSON (v4 协议瘦身)。业务级判断由 SessionApprovalMemory pattern 复用 +
// fallback regex 配合处理;复杂业务规则未来通过 tool({ needsApproval }) 函数表达。
//
// 允许依赖: ./session-approval-memory, ./input-diagnostics,
//          ../repos/side-effect-ledger, ../ipc/tool-confirm (类型)
// 禁止依赖: ipc/* 的实现 (端口注入)

import log from 'electron-log'
import type { ToolDefinition, ToolExecuteContext } from './types'
import type { ToolConfirmPort } from '../ipc/tool-confirm'
import { SessionApprovalMemory } from './session-approval-memory'
import { SideEffectLedger } from '../repos/side-effect-ledger'
import { diagnoseInputMismatch } from './input-diagnostics'

/**
 * Gate 决策。
 *
 *   - pass: 允许执行 (via 标记走哪条路径,Ledger 用)
 *   - deny: 拒绝执行 (返 USER_DENIED 类 envelope)
 *
 * 同时 deny 可携带 summary(向 LLM 解释失败原因,比如缺必填字段的诊断)。
 */
export interface GateDecision {
  action: 'pass' | 'deny'
  /** 通过路径,给 Ledger 记账用。
   *  - high-static:  HIGH 静态工具 (bash/write/edit),系统生成 summary + 用户 confirm
   *  - fallback:     代码 regex 兜底命中 + 用户 confirm
   *  - memory:       命中 SessionApprovalMemory pattern,自动通过
   *  - auto-low:     无风险信号,直通(不进 ledger)
   */
  via: 'fallback' | 'memory' | 'auto-low' | 'high-static'
  /** confirm 弹窗用的 summary / deny 时的诊断信息 */
  summary?: string
  /** patternKey (走 memory 路径时填) */
  patternKey?: string
}

/**
 * HIGH 静态工具的 input summary 生成器。
 *
 * v3.7.2 从 buildTools 内移入 RiskGate 内部。对 LLM 来说,bash 命令 / write 文件
 * 内容 / edit old_str 是模型自己写的,系统不需要 LLM 再额外声明 — 系统直接从 input
 * 提取一份摘要弹给用户 confirm。
 *
 * MAX 500 字符截断,跟其他 confirm preview 一致。
 */
function buildHighStaticSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = (input ?? {}) as Record<string, unknown>
  if (toolName === 'bash')
    return String(obj.command ?? '')
      .trim()
      .slice(0, MAX)
  if (toolName === 'write') {
    const lines = String(obj.content ?? '')
      .split('\n')
      .slice(0, 20)
      .map((l) => l.slice(0, 80))
    return `File: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '')
      .split('\n')
      .slice(0, 10)
      .map((l) => l.slice(0, 80))
    return `File: ${obj.path}\nOld content:\n${lines.join('\n')}`.slice(0, MAX)
  }
  // 其他 HIGH 工具(未来扩展):JSON 摘要。空对象给可读提示。
  const json = JSON.stringify(input ?? {})
  return json === '{}' ? `Call ${toolName} (no arguments)` : json.slice(0, MAX)
}

/**
 * 代码兜底通用危险关键字 — 不绑业务名,只识别"操作类型"层。
 *
 * 命中 → 视为高危, 弹 confirm 让用户决定。
 * 业务层判断 (production schema / 关键表名 / 等) 由 tool 自身的 needsApproval
 * 函数表达 (v4 Phase 2),不在此处。
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
   * @param memory  session 级 approval memory(记忆用户对同 patternKey 的"记住"选择)
   * @param ledger  副作用日志 — Gate 内部决定通过后立即 record,buildTools 不必再调一次。
   */
  constructor(
    private readonly memory: SessionApprovalMemory,
    private readonly ledger: SideEffectLedger,
  ) {}

  /**
   * 评估某工具调用的风险等级 + 决定执行策略。
   *
   * 顺序很重要:
   *   1. 静态 high riskLevel (HIGH static) → 系统生成 summary + 必须 confirm
   *   2. 代码兜底 regex → fallback confirm
   *   3. 默认 pass
   *
   * 通过 (action='pass' 且 via ∈ fallback/memory/high-static) 时,
   * Gate 内部直接 record ledger,buildTools 不必再调一次。
   * auto-low 路径不记账 (无风险信号,记账只会噪声化日志)。
   */
  async gate(
    tool: ToolDefinition,
    input: unknown,
    ctx: ToolExecuteContext,
    confirmTool: ToolConfirmPort,
  ): Promise<GateDecision> {
    // 路径 1 (v3.7.2): HIGH 静态工具 (bash/write/edit) → 系统生成 summary,必须 confirm。
    // 替代旧 pass-to-legacy 路径 (buildTools 嵌入 confirm 逻辑) — 现在统一回 Gate 内。
    if (tool.riskLevel === 'HIGH') {
      const summary = buildHighStaticSummary(tool.name, input)
      if (!summary.trim()) {
        // 输入异常 — 用 diagnoseInputMismatch 给 LLM 一份可读诊断
        const params = (tool.parameters ?? {}) as {
          required?: string[]
          properties?: Record<string, { type?: string; description?: string }>
        }
        const inputObj =
          input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
        const missing = (params.required ?? []).filter(
          (f) => inputObj[f] === undefined || inputObj[f] === null,
        )
        const diagMsg =
          missing.length > 0
            ? diagnoseInputMismatch(tool.name, params, input, missing)
            : `Invalid input for tool "${tool.name}": could not build a summary. Provided fields: [${Object.keys(inputObj).join(', ') || 'none'}].`
        return {
          action: 'deny',
          via: 'high-static',
          summary: diagMsg,
        }
      }
      const decision = await this.callConfirm(confirmTool, {
        sessionId: ctx.sessionId,
        messageId: ctx.parentMessageIdForLedger,
        toolCallId: extractToolCallId(ctx),
        toolName: tool.name,
        summary: `Run ${tool.name}`,
        preview: summary,
        inputSummary: summary, // 兼容 legacy ToolConfirmRequest 字段
        inputFull: input,
        allowRemember: false, // HIGH 静态工具不记忆 (与旧 legacy 行为一致, 每次都 confirm)
        patternKey: undefined,
        riskLevel: 'high',
      })
      this.recordLedger(
        tool.name,
        ctx,
        'high-static',
        `Run ${tool.name}`,
        input,
        decision.approved ? 'approved' : 'denied',
      )
      return decision.approved
        ? { action: 'pass', via: 'high-static', summary: `Run ${tool.name}` }
        : { action: 'deny', via: 'high-static', summary: `Run ${tool.name}` }
    }

    // 路径 2: 代码兜底 regex (input 含通用危险关键字)
    const fallback = detectFallbackRisk(input)
    if (fallback) {
      log.warn(`[RiskGate] fallback risk detected for tool ${tool.name}: ${fallback.reason}`)
      const decision = await this.callConfirm(confirmTool, {
        sessionId: ctx.sessionId,
        toolCallId: extractToolCallId(ctx),
        toolName: tool.name,
        summary: `⚠️ ${fallback.reason}`,
        preview: safeStringify(input).slice(0, 500),
        allowRemember: false, // 兜底路径不允许记忆 (regex 命中是粗粒度,不应永久放行)
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

    // 路径 3: 无风险信号 → 直接通过, 不记账
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
    via: 'fallback' | 'memory' | 'high-static',
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
export const __TEST__ = { stripSqlNoise, detectFallbackRisk }
