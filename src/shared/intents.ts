// src/shared/intents.ts — 主进程与渲染端共用：引擎的意图工具名单
//
// 意图工具（agent-engine `intents()`）是引擎与委托人沟通的工具，在引擎路径上取代旧路径的 talor 块。
// 引擎现在只提供 ask_user / propose / report_blocked：完成时直接给出答复，不再调用 finish。
// finish 留在名单里，只为显示会话日志里旧运行的 finish 调用。
//
// 无 Node / DOM 依赖。

export const INTENT_TOOLS: readonly string[] = ['finish', 'ask_user', 'propose', 'report_blocked']

export function isIntentCall(name: string): boolean {
  return INTENT_TOOLS.includes(name)
}
