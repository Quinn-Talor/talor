import type { PromptPlugin, PipelineContext, PluginResult } from '../types'

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  // stub: 员工契约系统待 Phase 3 实现
  async build(_ctx: PipelineContext): Promise<PluginResult> {
    return { messages: [], tools: [], tokenEstimate: 0 }
  }
}
