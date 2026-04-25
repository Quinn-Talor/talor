import type { MemoryModule } from './types'
import type { ProviderContextConfig } from '../prompt/types'
import type { MemoryContext } from './types'

export class KnowledgeBase implements MemoryModule {
  // stub: 知识库 / RAG，待实现
  async getContext(_sessionId: string, _config: ProviderContextConfig): Promise<MemoryContext> {
    return { summaryMessage: null, recentMessages: [], tokenEstimate: 0 }
  }
}
