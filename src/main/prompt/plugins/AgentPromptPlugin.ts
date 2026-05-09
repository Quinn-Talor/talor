// src/main/prompt/plugins/AgentPromptPlugin.ts — 业务层：Agent prompt 模板化拼装 (Schema 1.0)
//
// 把 Agent 实体属性 + iteration 状态 → 单份模板渲染 → system message。
// 6 个语义锁定增强已嵌入模板:
//   ① mission 按 priority 分组 (CORE / AUXILIARY)
//   ② workflow 显示 inputs
//   ③ acceptance ⚠️ REJECTED 强语气
//   ④ rubric 升格为独立 Quality Pledges 段
//   ⑤ self-check 加步定位
//   ⑥ implicit acceptance (knowledge.required → tool-was-used) 由 Agent 装配阶段注入
//
// 允许依赖：prompt/*、agent/*、shared/*
// 禁止依赖：ipc/*

import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import { render } from '../render'
import { naturalize, joinNaturalize, schemaToBullets } from '../naturalize'
import { buildRuntimeContext, type TemplateContext } from '../runtime-context'
import { loadAgentSystemPromptTemplate, _resetTemplateCache } from '../template-loader'

// re-export for backward-compat tests that previously called this from plugin
export { _resetTemplateCache }

const helpers = {
  joinNaturalize: (criteria: unknown) => {
    if (!Array.isArray(criteria)) return ''
    return joinNaturalize(criteria as Parameters<typeof joinNaturalize>[0])
  },
  naturalize: (criterion: unknown) => {
    if (!criterion || typeof criterion !== 'object') return ''
    return naturalize(criterion as Parameters<typeof naturalize>[0])
  },
  joinBackticks: (arr: unknown, sep: unknown = ' · ') => {
    if (!Array.isArray(arr)) return ''
    const s = typeof sep === 'string' ? sep : ' · '
    return arr.map((x) => '`' + String(x) + '`').join(s)
  },
  joinComma: (arr: unknown) => {
    if (!Array.isArray(arr)) return ''
    return arr.map(String).join(', ')
  },
  schemaToBullets: (schema: unknown) => {
    return schemaToBullets(schema)
  },
}

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const template = loadAgentSystemPromptTemplate()
    if (!template) {
      // 模板加载失败 fallback: 仅注入 identity
      const fallback = `You are "${ctx.agent.profile.identity.name}". ${ctx.agent.profile.identity.description}`
      return {
        messages: [{ role: 'system', content: fallback }],
        tools: [],
        tokenEstimate: Math.ceil(fallback.length / 3),
      }
    }

    // PipelineContext 不携带 iterationNumber/tokensUsed (TASK-8 接入 react-loop 后再传);
    // 此处用启发式默认: ON-DEMAND 段按"首次进入"渲染。
    // 这两个字段是 PromptPipelineContext 的可选扩展字段(orchestrator 显式注入时才有),
    // 用类型断言访问而不是绕过类型系统。
    const ctxWithIteration = ctx as PipelineContext & {
      iterationNumber?: number
      tokensUsed?: number
    }
    const iterationNumber = ctxWithIteration.iterationNumber ?? 0
    const tokensUsed = ctxWithIteration.tokensUsed ?? 0

    const tplCtx: TemplateContext = buildRuntimeContext(ctx.agent, { iterationNumber, tokensUsed })

    // render 接受通用 Record<string, unknown>;TemplateContext 是其特化输入,
    // 强转是签名兼容必需,非绕过类型系统(编码指南 #4)。
    const content =
      render(template, tplCtx as unknown as Record<string, unknown>, helpers).trimEnd() + '\n'

    return {
      messages: [{ role: 'system', content }],
      tools: [],
      tokenEstimate: Math.ceil(content.length / 3),
    }
  }
}
