// src/main/agent/delegate-agent.ts — 业务层：delegate_agent 内置 Tool
//
// 委托子 Agent 执行任务。创建子 session，在子 Agent 的 runtime 下独立执行。
// 只回传最终结果，中间过程留在子 session。
//
// 允许依赖：agent/*、repos/*
// 禁止依赖：ipc/*

import type { ToolDefinition } from '../tools/types'
import type { AgentManager } from './agent-manager'

export function createDelegateAgentTool(agentManager: AgentManager): ToolDefinition {
  return {
    name: 'delegate_agent',
    description: '委托另一个 Agent 执行任务。创建子 session 独立执行，返回最终结果。',
    parameters: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent ID' },
        instruction: { type: 'string', description: '任务指令' },
        context: { type: 'string', description: '上下文信息（由 LLM 构造）' },
      },
      required: ['agent_id', 'instruction'],
    },
    riskLevel: 'LOW',
    execute: async (input) => {
      const { agent_id, instruction, context } = input as {
        agent_id: string
        instruction: string
        context?: string
      }

      const agent = agentManager.getAgent(agent_id)
      if (!agent) {
        return { output: `Agent not found: ${agent_id}` }
      }

      const userContent = context
        ? `${context}\n\n${instruction}`
        : instruction

      // Phase 4 简化实现：返回子 Agent 信息 + 指令
      // 完整实现需要创建子 session + 独立 React Loop（需要 sessionRepo + runReactLoop 注入）
      return {
        output: JSON.stringify({
          delegated_to: agent_id,
          agent_name: agent.name,
          instruction: userContent,
          status: 'delegated',
          note: 'Sub-session execution will be implemented with full React Loop integration',
        }),
      }
    },
  }
}
