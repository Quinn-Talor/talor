// src/shared/intents.ts — 主进程与渲染端共用：引擎的意图工具名单
//
// 意图工具（agent-engine `intents()`）是引擎与委托人沟通的 4 个工具，在引擎路径上取代旧路径的 talor 块。
//
// 无 Node / DOM 依赖。

export const INTENT_TOOLS: readonly string[] = ['finish', 'ask_user', 'propose', 'report_blocked']

export function isIntentCall(name: string): boolean {
  return INTENT_TOOLS.includes(name)
}
