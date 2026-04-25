import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { estimate } from '../../memory/types'

export class SystemPlugin implements PromptPlugin {
  name = 'SystemPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const lines = [
      `当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
      `操作系统：${process.platform}`,
      `Workspace：${ctx.workspacePath ?? '未设置'}`,
    ]
    const content = lines.join('\n')
    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: estimate(content),
    }
  }
}
