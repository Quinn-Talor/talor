import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { MemoryManager } from '../../memory/MemoryManager'
import { messageRepo } from '../../repos/session-repo'
import { messagesToCoreMessages } from '../../memory/types'
import log from 'electron-log'

const FALLBACK_RECENT_COUNT = 20

export class MemoryPlugin implements PromptPlugin {
  name = 'MemoryPlugin'

  constructor(private memoryManager: MemoryManager) {}

  async build(ctx: PipelineContext): Promise<PluginResult> {
    try {
      const result = await this.memoryManager.getContext(ctx.sessionId, ctx.providerConfig)
      const messages = []
      if (result.summaryMessage !== null) messages.push(result.summaryMessage)
      messages.push(...result.recentMessages)
      return { messages, tools: [], tokenEstimate: result.tokenEstimate }
    } catch (err) {
      log.warn('[MemoryPlugin] getContext failed, falling back to recent messages:', err)
      try {
        const all = messageRepo.listBySession(ctx.sessionId)
        const recent = all.slice(-FALLBACK_RECENT_COUNT)
        const messages = messagesToCoreMessages(recent)
        return { messages, tools: [], tokenEstimate: 0 }
      } catch (fallbackErr) {
        log.error('[MemoryPlugin] fallback also failed:', fallbackErr)
        return { messages: [], tools: [], tokenEstimate: 0 }
      }
    }
  }
}
