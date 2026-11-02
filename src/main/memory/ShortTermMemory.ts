// src/main/memory/ShortTermMemory.ts —— 业务层(memory):会话短期记忆(压缩 + 锚点)的旧路径包装
//
// 职责:给 prompt 的 history 层产出"摘要 + 锚点 + recent 原文"。摘要实现已迁到
// history/session-summary.ts(SessionSummaryMemory);这里把原始行转成 SDK 消息(含工具结果指引),
// 并把新摘要回调转成原来的 'memory.compressed' 事件。旧路径的结果与迁移前一致。
//
// 允许依赖:history/*、memory/types、chat/events(类型)
// 禁止依赖:ipc/*

import { SessionSummaryMemory } from '../history/session-summary'
import type { ProviderContextConfig } from '../history/context-config'
import { messagesToCoreMessages, type MemoryContext, type MemoryRequestOptions } from './types'

export { findRecentSplit, splitAnchorsAndCompressible } from '../history/session-summary'

export class ShortTermMemory {
  private core = new SessionSummaryMemory()

  async getContext(
    sessionId: string,
    config: ProviderContextConfig,
    opts: MemoryRequestOptions = {},
  ): Promise<MemoryContext> {
    const r = await this.core.getContextRows(sessionId, config, {
      fixedOverheadTokens: opts.fixedOverheadTokens,
      abortSignal: opts.abortSignal,
      onCompressed: (id) =>
        opts.events?.emit({ type: 'memory.compressed', coveredUntilMessageId: id }),
    })
    return {
      summaryMessage: r.summary === null ? null : { role: 'system', content: r.summary },
      recentMessages: messagesToCoreMessages(r.rows),
      tokenEstimate: r.tokenEstimate,
    }
  }
}
