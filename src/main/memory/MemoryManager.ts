import { ShortTermMemory } from './ShortTermMemory'
import type { MemoryContext, MemoryRequestOptions } from './types'
import type { ProviderContextConfig } from '../prompt/types'

export class MemoryManager {
  private shortTerm: ShortTermMemory

  constructor() {
    this.shortTerm = new ShortTermMemory()
  }

  async getContext(
    sessionId: string,
    config: ProviderContextConfig,
    opts: MemoryRequestOptions = {},
  ): Promise<MemoryContext> {
    return this.shortTerm.getContext(sessionId, config, opts)
  }
}
