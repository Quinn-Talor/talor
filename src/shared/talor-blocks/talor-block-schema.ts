// src/shared/talor-blocks/talor-block-schema.ts —— 业务层: Talor Block 协议类型定义
//
// Talor Block 是一种结构化的"决策点声明",由 LLM 在 stepText 内 emit 为 fenced
// JSONC 块,统一格式:
//
//   ```talor
//   {
//     "type": "<block-type>",
//     ...fields...
//   }
//   ```
//
// 设计原则 (详见 docs/superpowers/plans/2026-05-12-talor-block-protocol.md):
//   - 统一 fence tag `talor`, 类型由 JSON `type` 字段 discriminated
//   - `type` 必须是 JSON 的第一个 key (让流式提取早期生效)
//   - 字段化 100%, Detector 不靠 regex 启发判定
//   - 弱模型可退到文本 marker (✓/❓/⏸/✋) 作为兜底
//
// V1 实施 5 个 block 类型: done / need_input / blocked / pending_confirm / warning
// V2 预留: plan / diagram / checkpoint / ref
//
// 允许依赖: 无
// 禁止依赖: ipc/*

/**
 * 完成态 — 任务成功结束, turn 终止。
 *
 * 用法: 作为 step text 最后一个 talor block, 同 step 不调工具。
 */
export interface DoneBlock {
  type: 'done'
  /** 必填: 一句话总结 (≤80 字符建议) */
  summary: string
  /** 选填: 结构化结果数据,供下次会话或外部消费 */
  result?: unknown
}

/**
 * 等待用户输入 — 需要用户提供决策或信息才能继续。
 *
 * 用法: 作为 step text 最后一个 talor block, 同 step 不调工具。
 * 与 Rule 12 "wait-for-user dual case" 配套: 想等就只 emit 这个 block,
 * 同 step 调工具会被 WaitAndActConflict detector 兜底拦截。
 */
export interface NeedInputBlock {
  type: 'need_input'
  /** 必填: 给用户的问题 */
  question: string
  /** 选填: 候选答案,UI 渲染为按钮 */
  choices?: string[]
  /** 选填: 为什么需要这个输入 */
  reason?: string
}

/**
 * 阻塞 — 任务暂时无法继续,等外部环境变化。
 */
export interface BlockedBlock {
  type: 'blocked'
  /** 必填: 阻塞原因 (原样引用 tool 错误更可信) */
  reason: string
  /** 选填: 用户改变环境后是否可重试 */
  can_retry?: boolean
  /** 选填: 重试建议 */
  retry_hint?: string
}

// v4 Phase 4b 删除: PendingConfirmBlock。替代方案: SDK tool({ needsApproval })。
// LLM 不再 emit fenced JSON 声明副作用 — 直接调工具,系统通过 needsApproval 函数读取
// 工具 input + 历史 messages 决定是否需要审批。

/**
 * 警告 — 中途提醒用户关注重要信息,不终止 turn。
 */
export interface WarningBlock {
  type: 'warning'
  /** 必填: 警告内容 */
  message: string
  /** 选填: 严重度,影响 UI 视觉强度。默认 'medium' */
  severity?: 'low' | 'medium' | 'high'
}

/**
 * 用户可一键确认的动作提议 — 任意 tool + args + label。
 *
 * 用法: 任何"提议执行一个动作并由用户确认"的场景统一使用 (发邮件 / 创建会议 /
 * 保存配置 / 调用外部 API ...)。取代 v3 时期的 draft_detected (只能用于
 * agent profile 保存)。
 *
 * 设计原则:
 *   - UI 不感知 tool 业务概念,仅渲染 summary + preview + CTA
 *   - 用户点 CTA 时 Talor 用 toolRegistry.invoke(action.tool, action.args)
 *     走标准 tool 调用链路 (含权限校验)
 *   - secondary_actions 不直接调工具,而是把 emit 字符串塞回 LLM 上下文 (让 LLM
 *     进入修改流程)
 */
export interface ProposalBlock {
  type: 'proposal'
  /** 必填: 一行摘要 — 描述将要发生什么 */
  summary: string
  /** 选填: markdown preview,给用户看完整内容 */
  preview?: string
  /** 必填: 主动作 */
  action: {
    /** 按钮文字 */
    label: string
    /** 必须是 registry 注册的 tool name */
    tool: string
    /** 工具参数,由对应 tool 的 schema 校验 */
    args: Record<string, unknown>
  }
  /** 选填: 二级动作 — 不触发 tool,将 emit 字符串塞回 LLM 上下文 */
  secondary_actions?: Array<{
    label: string
    emit: string
  }>
}

// v4 Phase 4a 删除: PendingContinuationBlock。替代方案: request_continuation virtual tool。

/**
 * 实施计划 — V2 预留,V1 不消费。
 */
export interface PlanBlock {
  type: 'plan'
  steps: Array<{ step: number; action: string; target?: string }>
}

/**
 * Talor Block 联合类型。
 *
 * Discriminated by `type` field, TypeScript 自动 narrowing:
 *
 *   function handle(b: TalorBlock) {
 *     if (b.type === 'done') {
 *       // b.summary 已 narrow 为 string
 *     }
 *   }
 */
export type TalorBlock =
  | DoneBlock
  | NeedInputBlock
  | BlockedBlock
  | WarningBlock
  | ProposalBlock
  | PlanBlock

export type TalorBlockType = TalorBlock['type']

/** V1 框架处理的 block 类型。
 *
 * 5 个 UI block + plan(V2 预留)。
 * 系统消费 block 数:0(协议行为改用 SDK tool({ needsApproval }) + request_continuation);
 * UI 渲染消费 5 个 (done / need_input / blocked / warning / proposal)。
 */
export const V1_BLOCK_TYPES = [
  'done',
  'need_input',
  'blocked',
  'warning',
  'proposal',
] as const satisfies readonly TalorBlockType[]
