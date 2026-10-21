import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { MemoryManager } from '../../memory/MemoryManager'
import { messageRepo } from '../../repos/session-repo'
import { messagesToCoreMessages } from '../../memory/types'
import log from 'electron-log'

const FALLBACK_RECENT_COUNT = 20

export class MemoryPlugin implements PromptPlugin {
  name = 'MemoryPlugin'
  readonly layer = 'history' as const

  constructor(private memoryManager: MemoryManager) {}

  async build(ctx: PipelineContext): Promise<PluginResult> {
    try {
      const result = await this.memoryManager.getContext(ctx.sessionId, ctx.providerConfig, {
        events: ctx.events,
        fixedOverheadTokens: ctx.fixedOverheadTokens,
        abortSignal: ctx.abortSignal,
      })
      const messages = []
      if (result.summaryMessage !== null) messages.push(result.summaryMessage)
      messages.push(...result.recentMessages)
      return { messages, tools: [], tokenEstimate: result.tokenEstimate }
    } catch (err) {
      // 用户中止压缩时同样走这里:降级路径不调 LLM,本轮随后在 streamText 处随中止结束。
      log.warn('[MemoryPlugin] getContext failed, falling back to recent messages:', err)
      try {
        // 与正常路径同口径:末条消息由 MessagePlugin 注入,这里只取其之前的历史;
        // 截取窗口后去掉开头失去 assistant(tool_use) 的孤立 tool 消息。
        const history = messageRepo.listBySession(ctx.sessionId).slice(0, -1)
        const recent = history.slice(-FALLBACK_RECENT_COUNT)
        let start = 0
        while (start < recent.length && recent[start].role === 'tool') start++
        const messages = messagesToCoreMessages(recent.slice(start))
        return { messages, tools: [], tokenEstimate: 0 }
      } catch (fallbackErr) {
        log.error('[MemoryPlugin] fallback also failed:', fallbackErr)
        return { messages: [], tools: [], tokenEstimate: 0 }
      }
    }
  }
}
