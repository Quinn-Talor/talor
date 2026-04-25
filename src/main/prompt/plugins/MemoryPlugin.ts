import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { MemoryManager } from '../../memory/MemoryManager'

export class MemoryPlugin implements PromptPlugin {
  name = 'MemoryPlugin'

  constructor(private memoryManager: MemoryManager) {}

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const result = await this.memoryManager.getContext(ctx.sessionId, ctx.providerConfig)
    const messages = []
    if (result.summaryMessage !== null) messages.push(result.summaryMessage)
    messages.push(...result.recentMessages)
    return { messages, tools: [], tokenEstimate: result.tokenEstimate }
  }
}
