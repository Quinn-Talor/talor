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
      `User message: ${ctx.currentMessage.text}\n\n` +
      `Available tools:\n${toolList}\n\n` +
      `From the list above, pick only the tools that are actually needed for this user task. ` +
      `Respond with a JSON array of tool names, e.g. ["tool_name_1", "tool_name_2"]. Do not include extras.`

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
      log.warn('[ToolSelectionPlugin] LLM-based tool selection failed, falling back to first 49 tools', err)
      const fallback = allTools.slice(0, 49)
      return { messages: [], tools: fallback, tokenEstimate: this.estimateTools(fallback) }
    }
  }

  private estimateTools(tools: ToolMetadata[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
