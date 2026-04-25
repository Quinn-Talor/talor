import type { MemoryModule } from './types'
import type { ProviderContextConfig } from '../prompt/types'
import type { MemoryContext } from './types'

export class LongTermMemory implements MemoryModule {
  // stub: 长期记忆（跨会话持久化），待实现
  async getContext(_sessionId: string, _config: ProviderContextConfig): Promise<MemoryContext> {
    return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
  }
}
