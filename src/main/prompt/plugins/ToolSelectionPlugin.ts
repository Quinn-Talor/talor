import { generateText, type CoreMessage } from 'ai'
import { getAdapter } from '../../providers/model-adapter'
import log from 'electron-log'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { ToolMetadata } from '../../tools/types'
import { estimate, extractJsonArray } from '../../memory/types'

const SELECTION_THRESHOLD = 50
const FALLBACK_TOOL_COUNT = 49

export class ToolSelectionPlugin implements PromptPlugin {
  name = 'ToolSelectionPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const allTools: ToolMetadata[] = ctx.agent
      ? ctx.agent.toolRegistry.listTools().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          schema: t.schema,
          riskLevel: t.riskLevel,
        }))
      : []

    if (allTools.length < SELECTION_THRESHOLD) {
      return { messages: [], tools: allTools, tokenEstimate: this.estimateTools(allTools) }
    }

    const toolList = allTools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
    const selectionPrompt =
      `User message: ${ctx.currentMessage.text}\n\n` +
      `Available tools:\n${toolList}\n\n` +
      `From the list above, pick only the tools that are actually needed for this user task. ` +
      `Respond with a JSON array of tool names, e.g. ["tool_name_1", "tool_name_2"]. Do not include extras.`

    try {
      const model = getAdapter(ctx.provider.type).createModel(ctx.provider, 'default')
      const { text } = await generateText({
        model,
        messages: [{ role: 'user', content: selectionPrompt }],
        maxTokens: 256,
        abortSignal: AbortSignal.timeout(5_000),
      })
      const selectedNames = extractJsonArray(text)
      const selected = allTools.filter((t) => selectedNames.includes(t.name))
      if (selected.length === 0) {
        throw new Error('LLM returned empty tool selection')
      }
      const notice = this.buildSelectionNotice(selected.length, allTools.length)
      return {
        messages: [notice],
        tools: selected,
        tokenEstimate: this.estimateTools(selected) + estimate(notice.content as string),
      }
    } catch (err) {
      log.warn(
        '[ToolSelectionPlugin] LLM-based tool selection failed, falling back to first 49 tools',
        err,
      )
      const fallback = allTools.slice(0, FALLBACK_TOOL_COUNT)
      const notice = this.buildDegradedNotice(fallback.length, allTools)
      return {
        messages: [notice],
        tools: fallback,
        tokenEstimate: this.estimateTools(fallback) + estimate(notice.content as string),
      }
    }
  }

  private buildSelectionNotice(selected: number, total: number): CoreMessage {
    return {
      role: 'system',
      content:
        `[Tool list was pre-filtered to ${selected}/${total} tools relevant to this request. ` +
        `If you believe a needed tool is missing, tell the user and ask them to retry; ` +
        `the list is re-selected each turn.]`,
    }
  }

  private buildDegradedNotice(fallbackCount: number, allTools: ToolMetadata[]): CoreMessage {
    return {
      role: 'system',
      content:
        `[DEGRADED] Tool selection failed; exposing first ${fallbackCount} of ${allTools.length} tools. ` +
        `Some tools may be missing from this turn. Full tool names: ${allTools.map((t) => t.name).join(', ')}. ` +
        `If the task needs a tool not in the exposed list, tell the user and ask whether to retry.`,
    }
  }

  private estimateTools(tools: ToolMetadata[]): number {
    return tools.reduce((s, t) => s + estimate(t.name + (t.description ?? '')), 0)
  }
}
