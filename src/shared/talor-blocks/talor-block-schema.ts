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
export type TalorBlock = DoneBlock | NeedInputBlock | BlockedBlock | WarningBlock | PlanBlock

export type TalorBlockType = TalorBlock['type']

/** V1 框架处理的 block 类型。
 *
 * v4 协议瘦身后:仅 4 个 UI 装饰类 block + plan(V2)。
 * 系统消费 block 数:0(全部协议行为改用 SDK tool({ needsApproval }) + request_continuation)
 */
export const V1_BLOCK_TYPES = [
  'done',
  'need_input',
  'blocked',
  'warning',
] as const satisfies readonly TalorBlockType[]
