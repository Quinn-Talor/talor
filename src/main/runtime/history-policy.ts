// src/main/runtime/history-policy.ts — 业务层：会话 → 引擎 history（含跨轮摘要）
//
// 与旧路径用同一份摘要实现（history/session-summary：阈值、recent 比例、锚点、增量、失败冷却），结果写同一张
// session_summaries。摘要（或"上下文缺口"提示）作为一条 system 消息放在最前，其余原始行经 historyOf 转换。
// 调用前本轮用户消息必须已落库：摘要实现把会话最后一条消息当作本轮输入去掉。
//
// 允许依赖: agent-engine（类型）、history/*、runtime/task
// 禁止依赖: ipc/*、memory/*、prompt/*、loop/*、chat/orchestrator

import type { ModelMessage } from 'agent-engine'
import type { ProviderContextConfig } from '../history/context-config'
import { SessionSummaryMemory } from '../history/session-summary'
import { historyOf } from './task'

const memory = new SessionSummaryMemory()

export async function historyFor(input: {
  sessionId: string
  config: ProviderContextConfig
  signal: AbortSignal
}): Promise<ModelMessage[]> {
  const r = await memory.getContextRows(input.sessionId, input.config, {
    abortSignal: input.signal,
  })
  const rest = historyOf(r.rows)
  return r.summary === null ? rest : [{ role: 'system', content: r.summary }, ...rest]
}
