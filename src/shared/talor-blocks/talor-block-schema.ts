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

/**
 * 高危操作确认 — 即将执行副作用操作,等用户批准。
 *
 * 用法: 作为 step text 末尾 block,同 step 紧接着调要执行的工具。
 * Risk Gate 检测到此 block 后弹 confirmTool 让用户决定。
 */
export interface PendingConfirmBlock {
  type: 'pending_confirm'
  /** 必填: 一句话操作描述 (给用户的 UI 看) */
  summary: string
  /**
   * 选填: approval memory key, 用于 session-level 自动批准。
   * 建议格式: <tool>:<op>:<target>
   *   - 'sql:INSERT:game.rule_param_config'
   *   - 'bash:rm:/tmp'
   *   - 'mcp:lark:doc_create:/workspace'
   * 缺时框架用 summary 自身作 key (精确但不可宽匹配)。
   */
  pattern?: string
  /** 选填: 详细预览 (如完整 SQL), UI 折叠展示 */
  preview?: string
  /**
   * 选填: 风险级别。默认 'high'。
   * - 'high': 走 confirm,可 remember
   * - 'destructive': 走 confirm,但不允许 remember (强制每次都问)
   */
  risk_level?: 'high' | 'destructive'
}

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
 * 续做声明 (v3.7.3) — LLM 完成了一部分但承诺下一步还有动作,框架据此续 loop。
 *
 * 设计:零必填字段。`type` 本身就是全部语义信号。
 *
 * 为什么不要 next_action 字段:
 *   - LLM emit 此 block 之前的 text 已经说了"现在写入文档:"——这是单一事实源
 *   - 强制 next_action 是字面重复,LLM 配合阻力↑,paraphrase 漂移风险↑
 *   - 续做 hint 直接引用前文 ("look back at your last response"),不需 LLM 二次表达
 *
 * 与 Principle 12 "Promise then call" 配对,四种 turn-end 形态:
 *   A. 执行    — 同 turn 调 tool (不需要本 block)
 *   B. 延后    — emit pending_continuation,系统续做
 *   C. 结束    — emit done/need_input/blocked
 *   D. ❌      — 说要做但没动手也没 block — JudgePolicy 二审兜底
 *
 * 防滥用:连续 3 次 emit pending_continuation 而不调工具 → ContinuationChainDetector 强制 break。
 */
export interface PendingContinuationBlock {
  type: 'pending_continuation'
  /** 选填: 为什么 turn 在这里断 (UI 显示 + 日志 reviewer 用,框架不消费做决策) */
  reason?: string
}

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
  | PendingConfirmBlock
  | WarningBlock
  | PendingContinuationBlock
  | PlanBlock

export type TalorBlockType = TalorBlock['type']

/** V1 框架处理的 block 类型 (plan 暂留 V2)。 */
export const V1_BLOCK_TYPES = [
  'done',
  'need_input',
  'blocked',
  'pending_confirm',
  'warning',
  'pending_continuation',
] as const satisfies readonly TalorBlockType[]
