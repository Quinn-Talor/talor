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
import type { CoreMessage } from 'ai'
import log from 'electron-log'

/** Merges provider-level overrides with global defaults from ConfigStore. */
export function resolveProviderConfig(provider: Provider): ProviderContextConfig {
  const configStore = ConfigStore.getInstance()
  const defaultLimit = configStore.get('default_context_limit') as number | undefined
  return {
    provider,
    context_limit: provider.context_limit ?? defaultLimit ?? 8000,
    recent_ratio:  provider.recent_ratio  ?? 0.05,
    summary_ratio: provider.summary_ratio ?? 0.10,
  }
}

export class PromptPipeline {
  private memoryManager: MemoryManager
  private plugins: Array<{ name: string; build(ctx: PipelineContext): Promise<PluginResult> }> | null = null

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager
  }

  private async getPlugins(): Promise<Array<{ name: string; build(ctx: PipelineContext): Promise<PluginResult> }>> {
    if (this.plugins !== null) return this.plugins
    const { SystemPlugin } = await import('./plugins/SystemPlugin')
    const { AgentPromptPlugin } = await import('./plugins/AgentPromptPlugin')
    const { MemoryPlugin } = await import('./plugins/MemoryPlugin')
    const { ToolSelectionPlugin } = await import('./plugins/ToolSelectionPlugin')
    this.plugins = [
      new SystemPlugin(),
      new AgentPromptPlugin(),
      new MemoryPlugin(this.memoryManager),
      new ToolSelectionPlugin(),
    ]
    return this.plugins
  }

  /**
   * Runs each plugin in order and concatenates their messages.
   * Plugin failures are logged and skipped so one bad plugin never blocks the whole pipeline.
   */
  async build(ctx: PipelineContext): Promise<{ messages: CoreMessage[]; tools: ToolMetadata[] }> {
    const plugins = await this.getPlugins()
    const allMessages: CoreMessage[] = []
    const allTools: ToolMetadata[] = []

    for (const plugin of plugins) {
      try {
        const result = await plugin.build(ctx)
        allMessages.push(...result.messages)
        allTools.push(...result.tools)
      } catch (err) {
        log.warn(`[PromptPipeline] Plugin ${plugin.name} failed, skipping:`, err)
      }
    }

    return { messages: allMessages, tools: allTools }
  }
}
