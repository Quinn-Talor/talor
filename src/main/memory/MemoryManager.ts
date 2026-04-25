import { ShortTermMemory } from './ShortTermMemory'
import type { MemoryContext } from './types'
import type { ProviderContextConfig } from '../prompt/types'

export class MemoryManager {
  private shortTerm: ShortTermMemory

  constructor() {
    this.shortTerm = new ShortTermMemory()
  }

  async getContext(sessionId: string, config: ProviderContextConfig): Promise<MemoryContext> {
    return this.shortTerm.getContext(sessionId, config)
  }
}
