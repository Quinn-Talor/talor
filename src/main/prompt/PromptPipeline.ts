// src/main/prompt/PromptPipeline.ts —— 业务层：Prompt 构建流水线
//
// 允许依赖：store/*（读配置）、memory/*、shared/*
// 禁止依赖：ipc/*
//
// 已知欠款：resolveProviderConfig 直接引用 ConfigStore 单例。后续可改为依赖注入。

import { ConfigStore } from '../store/config-store'
import { MemoryManager } from '../memory/MemoryManager'
import type { PipelineContext, ProviderContextConfig, PromptPlugin, StabilityLayer } from './types'
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

/** append-only 装配:层 rank 越小越靠前(可缓存前缀),volatile 在尾部。 */
const LAYER_RANK: Record<StabilityLayer, number> = {
  system: 0,
  agent: 1,
  tools: 2,
  history: 3,
  volatile: 4,
}

export class PromptPipeline {
  private memoryManager: MemoryManager
  private plugins: PromptPlugin[] | null = null

  constructor(memoryManager: MemoryManager) {
    this.memoryManager = memoryManager
  }

  private async getPlugins(): Promise<PromptPlugin[]> {
    if (this.plugins !== null) return this.plugins
    const { SystemPlugin } = await import('./plugins/SystemPlugin')
    const { AgentPromptPlugin } = await import('./plugins/AgentPromptPlugin')
    const { UiBlockPlugin } = await import('./plugins/UiBlockPlugin')
    const { RuntimeMetaPlugin } = await import('./plugins/RuntimeMetaPlugin')
    const { MemoryPlugin } = await import('./plugins/MemoryPlugin')
    const { MessagePlugin } = await import('./plugins/MessagePlugin')
    const { ToolSelectionPlugin } = await import('./plugins/ToolSelectionPlugin')
    // 装配顺序由 plugin.layer 决定(见 buildLayered),非数组顺序。数组顺序仅决定
    // 同层内的相对次序(确定性)+ tools 收集。append-only 分层:
    //   system → agent(Agent, UiBlock) → tools → history(Memory)
    //   → volatile(RuntimeMeta, Message;当前 turn / 运行时元等易变内容)
    this.plugins = [
      new SystemPlugin(),
      new AgentPromptPlugin(),
      new UiBlockPlugin(),
      new ToolSelectionPlugin(),
      new MemoryPlugin(this.memoryManager),
      new RuntimeMetaPlugin(),
      new MessagePlugin(),
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
  /**
   * append-only 分层装配。每个 plugin 产出归到其 layer;按 LAYER_RANK 稳定排序
   * (同层保 plugin 顺序)→ 稳定层(system/agent/tools/history)连续在前构成可缓存
   * 前缀,volatile 在尾。供 build() 与守护测试消费。
   *
   * Critical plugin 失败抛出;非 critical 失败降级 + 注入 [DEGRADED](volatile)。
   */
  async buildLayered(
    ctx: PipelineContext,
  ): Promise<{
    segments: Array<{ layer: StabilityLayer; messages: ModelMessage[] }>
    tools: ToolMetadata[]
  }> {
    const plugins = await this.getPlugins()
    const collected: Array<{ layer: StabilityLayer; order: number; messages: ModelMessage[] }> = []
    const allTools: ToolMetadata[] = []
    const degraded: string[] = []

    let order = 0
    for (const plugin of plugins) {
      const idx = order++
      try {
        const result = await plugin.build(ctx)
        if (result.messages.length > 0) {
          collected.push({ layer: plugin.layer, order: idx, messages: result.messages })
        }
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
      // 降级告警是易变内容 → 归 volatile 尾部,不污染可缓存前缀。
      collected.push({
        layer: 'volatile',
        order: order++,
        messages: [
          {
            role: 'system',
            content:
              `[DEGRADED] The following prompt plugins failed and were skipped: ${degraded.join(', ')}. ` +
              `Some context may be missing. If the current task depends on them ` +
              `(e.g. tool selection, external knowledge), tell the user and ask whether to retry.`,
          },
        ],
      })
    }

    // 稳定排序:先按 layer rank,再按 emit 顺序 → 确定性、append-only。
    collected.sort((a, b) => LAYER_RANK[a.layer] - LAYER_RANK[b.layer] || a.order - b.order)
    return {
      segments: collected.map((c) => ({ layer: c.layer, messages: c.messages })),
      tools: allTools,
    }
  }

  /** 扁平化 buildLayered 结果。外部签名不变(callers 仍拿 {messages, tools})。 */
  async build(ctx: PipelineContext): Promise<{ messages: ModelMessage[]; tools: ToolMetadata[] }> {
    const { segments, tools } = await this.buildLayered(ctx)
    return { messages: segments.flatMap((s) => s.messages), tools }
  }
}
