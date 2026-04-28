import { generateText } from 'ai'
import { createModel } from '../../providers/llm-provider'
import log from 'electron-log'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { ToolMetadata } from '../../tools/types'
import { estimate, extractJsonArray } from '../../memory/types'

export class ToolSelectionPlugin implements PromptPlugin {
  name = 'ToolSelectionPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const allTools: ToolMetadata[] = ctx.agent
      ? ctx.agent.toolRegistry.listTools().map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          schema: t.schema,
          riskLevel: t.riskLevel,
        }))
      : []

    if (allTools.length < 50) {
      return { messages: [], tools: allTools, tokenEstimate: this.estimateTools(allTools) }
    }

    const toolList = allTools.map(t => `- ${t.name}: ${t.description}`).join('\n')
    const selectionPrompt =
      `用户消息：${ctx.currentMessage.text}\n\n` +
      `可用工具列表：\n${toolList}\n\n` +
      `请从上述工具中选出完成用户任务所需的工具，` +
      `返回 JSON 数组，格式：["tool_name_1", "tool_name_2"]。只选必要的工具。`

    try {
      const model = createModel(ctx.provider, undefined)
      const { text } = await generateText({
        model,
        messages: [{ role: 'user', content: selectionPrompt }],
        maxTokens: 256,
        abortSignal: AbortSignal.timeout(5_000),
      })
      const selectedNames = extractJsonArray(text)
      const selected = allTools.filter(t => selectedNames.includes(t.name))
      if (selected.length === 0) {
        throw new Error('LLM returned empty tool selection')
      }
      return { messages: [], tools: selected, tokenEstimate: this.estimateTools(selected) }
    } catch (err) {
      log.warn('[ToolSelectionPlugin] LLM 动态选择失败，降级到前 19 个工具', err)
      const fallback = allTools.slice(0, 49)
      return { messages: [], tools: fallback, tokenEstimate: this.estimateTools(fallback) }
    }
  }

  private estimateTools(tools: ToolMetadata[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
