import { generateText } from 'ai'
import { createModel } from '../../providers/llm-provider'
import { toolRegistry } from '../../tools/registry'
import log from 'electron-log'
import type { PromptPlugin, PipelineContext, PluginResult, ToolSchema } from '../types'
import { estimate, extractJsonArray } from '../../memory/types'

export class ToolSelectionPlugin implements PromptPlugin {
  name = 'ToolSelectionPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const allTools: ToolSchema[] = toolRegistry.getAllSchemas()

    // Phase 3: filter by agent capability tools from ctx (AgentPromptPlugin stub for now)
    const allowed = allTools

    if (allowed.length < 20) {
      return { messages: [], tools: allowed, tokenEstimate: this.estimateTools(allowed) }
    }

    // LLM two-step dynamic selection
    const toolList = allowed.map(t => `- ${t.name}: ${t.description}`).join('\n')
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
      const selected = allowed.filter(t => selectedNames.includes(t.name))
      if (selected.length === 0) {
        throw new Error('LLM returned empty tool selection')
      }
      return { messages: [], tools: selected, tokenEstimate: this.estimateTools(selected) }
    } catch (err) {
      log.warn('[ToolSelectionPlugin] LLM 动态选择失败，降级到前 19 个工具', err)
      const fallback = allowed.slice(0, 19)
      return { messages: [], tools: fallback, tokenEstimate: this.estimateTools(fallback) }
    }
  }

  private estimateTools(tools: ToolSchema[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
