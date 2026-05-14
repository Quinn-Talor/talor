// src/shared/ui-rendering/text-heuristics.ts —— 仅 UI 渲染层使用的文本启发式
//
// v3.7.1: 从 src/main/loop/outcome-facts.ts 切出。这些 helper 服务 UI 卡片渲染
// (MessageBubble + InferredIntentCard),**不参与 react-loop 控制流**。
//
// 协作原则 (见 docs/superpowers/plans/2026-05-13-talor-v3.7.1-collaboration-model.md):
//   - 系统不用 regex 判断 LLM 意图来纠正 LLM (反模式)
//   - 但 UI 渲染层可以用启发式分类,以决定显示哪种卡片样式 (正模式 — 仅 UI,不回馈 loop)
//
// 调用方:
//   - MessageBubble.tsx → 调 inferIntent (intent-classifier.ts) 推断意图
//   - intent-classifier.ts 内部不直接用本文件 (它自己有更精细的多信号 voting),
//     但当外部代码需要"是否含收尾标记 / 是否像问句"的简单判定时, 使用本文件 helper

/**
 * Rule 13 旧版的三种 legacy 终止 marker (强模型 + 历史会话仍可能输出)。
 *
 * v3.7 后 react-loop 不再用 marker 判终止 (无 tool = 自然 final),
 * 这些 marker 仅作为 UI 渲染层"模型显式声明了意图"的强信号。
 */
export const TERMINATION_MARKERS = ['✓ Done', '❓ Need input', '⏸ Blocked'] as const

/** 检测 text 是否含 Rule 13 三种 legacy marker 之一。 */
export function hasTerminationMarker(text: string): boolean {
  if (!text) return false
  for (const marker of TERMINATION_MARKERS) {
    if (text.includes(marker)) return true
  }
  return false
}

/**
 * v3.6 遗留 helper: 合并的"显式收尾"信号 — talor block (done/need_input/blocked) OR
 * legacy 文字 marker (✓/❓/⏸)。
 *
 * 现在(v3.7.1)仅 UI 渲染层备用 — react-loop 不再调用本函数(无 tool = 自然 final,
 * 不需要"显式收尾"判定)。
 *
 * 由于本文件不能依赖 main/loop, 改用 lightweight regex 直接扫 talor fence 内 type
 * 字段, 而非完整 parseTalorBlocks。够 UI 用。
 */
export function hasTerminationInText(text: string): boolean {
  if (!text) return false
  if (hasTerminationMarker(text)) return true
  // 直接扫 type 字段: 比完整 parser 轻量, UI 渲染对召回足够
  const m = text.match(/```talor[\s\S]*?"type"\s*:\s*"(done|need_input|blocked)"[\s\S]*?```/)
  return m !== null
}

/**
 * 隐式 "我在问用户" 启发式 — 弱模型经常忘了 emit need_input block 也忘了写
 * legacy `❓` marker, 只是直接抛问题。UI 渲染层据此推断渲染 need_input 卡片样式。
 *
 * v3.7.1 后: 不再影响 loop 控制。仅 inferIntent 作"need_input"信号源之一。
 *
 * 触发任一条:
 *   - 文本含 `?` 或 `？`
 *   - 列举选项 "X / Y / Z" (至少 3 项, 斜杠两侧必须有空白)
 */
export function looksLikeOpenQuestion(text: string): boolean {
  if (!text) return false
  if (/[?？]/.test(text)) return true
  // 斜杠两侧必须有空白, 避免 `/etc/foo/bar.conf` 误命中
  if (/\S+\s+\/\s+\S+\s+\/\s+\S+/.test(text)) return true
  return false
}
