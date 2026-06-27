// src/main/prompt/PromptPipeline.ts —— 业务层：Prompt 构建流水线
//
// 允许依赖：store/*（读配置）、memory/*、shared/*
// 禁止依赖：ipc/*
//
// 已知欠款：resolveProviderConfig 直接引用 ConfigStore 单例。后续可改为依赖注入。

import { ConfigStore } from '../store/config-store'
import { MemoryManager } from '../memory/MemoryManager'
import type { PipelineContext, PluginResult, ProviderContextConfig } from './types'
import type { ToolMetadata } from '../tools/types'
import type { Provider } from '../store/config-store'
import type { ModelMessage } from 'ai'
import log from 'electron-log'

/**
 * 关键插件失败必须抛出——它们提供的信息（用户身份、系统规则、历史记忆、当前 turn）
 * 一旦缺失，模型就会以"空上下文"凭空编造。非关键插件（工具筛选等）失败
 * 只降级 + 注入 [DEGRADED] 告警，让模型感知信息缺口。
 *
 * MessagePlugin 属于关键插件:Memory 已 pop 掉末尾那条,若 MessagePlugin 失败
 * 则 prompt 末尾缺少"当前要推进的那条消息",模型无所依据。
 */
const CRITICAL_PLUGIN_NAMES = new Set([
  'SystemPlugin',
  'AgentPromptPlugin',
  'MemoryPlugin',
  'MessagePlugin',
])

/** Merges provider-level overrides with global defaults from ConfigStore. */
export function resolveProviderConfig(provider: Provider): ProviderContextConfig {
  const configStore = ConfigStore.getInstance()
  const defaultLimit = configStore.get('default_context_limit') as number | undefined
  const defaultRecent = configStore.get('default_recent_ratio') as number | undefined
  const defaultSummary = configStore.get('default_summary_ratio') as number | undefined
  return {
    provider,
    context_limit: provider.context_limit ?? defaultLimit ?? 1_000_000,
    recent_ratio: provider.recent_ratio ?? defaultRecent ?? 0.05,
    summary_ratio: provider.summary_ratio ?? defaultSummary ?? 0.05,
  }
}

export class PromptPipeline {
  private memoryManager: MemoryManager
  private plugins: Array<{
    name: string
    build(ctx: PipelineContext): Promise<PluginResult>
  }> | null = null

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager
  }

  private async getPlugins(): Promise<
    Array<{ name: string; build(ctx: PipelineContext): Promise<PluginResult> }>
  > {
    if (this.plugins !== null) return this.plugins
    const { SystemPlugin } = await import('./plugins/SystemPlugin')
    const { AgentPromptPlugin } = await import('./plugins/AgentPromptPlugin')
    const { UiBlockPlugin } = await import('./plugins/UiBlockPlugin')
    const { MemoryPlugin } = await import('./plugins/MemoryPlugin')
    const { MessagePlugin } = await import('./plugins/MessagePlugin')
    const { ToolSelectionPlugin } = await import('./plugins/ToolSelectionPlugin')
    // 顺序映射到最终 prompt 结构:
    //   System (Layer 1+2) → Agent (Layer 3+4) → UiBlock (Layer 5, block 协议)
    //   → Memory (Layer 6) → Message (Layer 7,当前 turn)
    //   → ToolSelection (仅 ≥50 工具时的 notice)
    // MessagePlugin 必须紧跟 MemoryPlugin:Memory pop 了末尾,Message 把它放回来。
    // UiBlockPlugin 在 AgentPromptPlugin 后:agent 自定义 prompt 之后再给通用 UI
    // 块协议,避免被 agent prompt 的"严格 JSON only"等强势规则覆盖。
    this.plugins = [
      new SystemPlugin(),
      new AgentPromptPlugin(),
      new UiBlockPlugin(),
      new MemoryPlugin(this.memoryManager),
      new MessagePlugin(),
      new ToolSelectionPlugin(),
    ]
    return this.plugins
  }

  /**
   * Runs each plugin in order and concatenates their messages.
   *
   * Critical plugins (see CRITICAL_PLUGIN_NAMES): failure throws — the caller
   * must surface the error instead of silently serving a prompt without the
   * system/agent/memory context.
   *
   * Non-critical plugins: failure is logged and a [DEGRADED] system message is
   * prepended so the model knows some context is missing.
   */
  async build(ctx: PipelineContext): Promise<{ messages: ModelMessage[]; tools: ToolMetadata[] }> {
    const plugins = await this.getPlugins()
    const allMessages: ModelMessage[] = []
    const allTools: ToolMetadata[] = []
    const degraded: string[] = []

    for (const plugin of plugins) {
      try {
        const result = await plugin.build(ctx)
        allMessages.push(...result.messages)
        allTools.push(...result.tools)
      } catch (err) {
        if (CRITICAL_PLUGIN_NAMES.has(plugin.name)) {
          log.error(`[PromptPipeline] Critical plugin ${plugin.name} failed:`, err)
          throw new Error(
            `Critical prompt plugin "${plugin.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
        log.warn(
          `[PromptPipeline] Non-critical plugin ${plugin.name} failed, marking as degraded:`,
          err,
        )
        degraded.push(plugin.name)
      }
    }

    if (degraded.length > 0) {
      allMessages.unshift({
        role: 'system',
        content:
          `[DEGRADED] The following prompt plugins failed and were skipped: ${degraded.join(', ')}. ` +
          `Some context may be missing. If the current task depends on them ` +
          `(e.g. tool selection, external knowledge), tell the user and ask whether to retry.`,
      })
    }

    return { messages: allMessages, tools: allTools }
  }
}
