// src/main/prompt/plugins/AgentPromptPlugin.ts — 业务层：Agent prompt 模板化拼装 (Schema 2.0)
//
// 把 Agent 实体属性 → 单份模板渲染 → system message。
//
// 允许依赖：prompt/*、agent/*、shared/*
// 禁止依赖：ipc/*

import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { render } from '../render'
import { buildRuntimeContext, type TemplateContext } from '../runtime-context'
import { loadAgentSystemPromptTemplate, _resetTemplateCache } from '../template-loader'

// re-export for backward-compat tests that previously called this from plugin
export { _resetTemplateCache }

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'
  readonly layer = 'agent' as const

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const template = loadAgentSystemPromptTemplate()
    if (!template) {
      // 模板加载失败 fallback: 仅注入 identity
      const fallback = `You are "${ctx.agent.profile.name}". ${ctx.agent.profile.description}`
      return {
        messages: [{ role: 'system', content: fallback }],
        tools: [],
        tokenEstimate: Math.ceil(fallback.length / 3),
      }
    }

    const tplCtx: TemplateContext = buildRuntimeContext(ctx.agent)

    // render 接受通用 Record<string, unknown>;TemplateContext 是其特化输入,
    // 强转是签名兼容必需,非绕过类型系统(编码指南 #4)。
    const content = render(template, tplCtx as unknown as Record<string, unknown>).trimEnd() + '\n'

    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: Math.ceil(content.length / 3),
    }
  }
}
