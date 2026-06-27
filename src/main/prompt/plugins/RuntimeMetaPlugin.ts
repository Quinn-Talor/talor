// src/main/prompt/plugins/RuntimeMetaPlugin.ts —— 业务层(prompt): 运行时元信息(L4 volatile)
//
// date / os / workspace 这类"每轮可能变"的运行时上下文。append-only 设计要求
// 易变内容只进 volatile 尾部,绝不混入可缓存的稳定前缀(否则破坏 prompt 缓存)。
// 历史教训:曾把毫秒级 `Current time` 放在 SystemPlugin(L0),每轮改变前缀字节,
// 把 deepseek 前缀缓存命中率打到 ~14%;移出后回升到 ~99%。
//
// 允许依赖: prompt/types
// 禁止依赖: ipc/*

import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { estimate } from '../../memory/types'

export class RuntimeMetaPlugin implements PromptPlugin {
  name = 'RuntimeMetaPlugin'
  readonly layer = 'volatile' as const

  async build(ctx: PipelineContext): Promise<PluginResult> {
    // 日期级(非毫秒),即便日期变化也只影响 volatile 尾部, 不动稳定前缀。
    const content = [
      `Current date: ${new Date().toISOString().slice(0, 10)}`,
      `Operating system: ${process.platform}`,
      `Workspace: ${ctx.workspacePath ?? '(not set)'}`,
    ].join('\n')

    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: estimate(content),
    }
  }
}
