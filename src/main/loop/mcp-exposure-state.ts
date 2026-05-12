// src/main/loop/mcp-exposure-state.ts —— 业务层: MCP 工具暴露策略状态
//
// 收敛主循环散落的 3 个变量 (mcpExpandThisStep / usedMcpToolNames / mcpNameSet 懒缓存)。
//
// 策略 (方案 C "累积可见", 与 ToolSelectionPlugin 配合):
//   - 首步 expand=true (若 agent 有 MCP 工具) — 让模型一次看到全集
//   - 之后 expand=false; 仅 search_tool 调用后下一步再次 expand
//   - usedMcpToolNames 累积 — 已用过的 MCP 工具永远可见, 不收缩
//
// 允许依赖: ./types, ../agent/agent
// 禁止依赖: ipc/*

import type { StepOutcome } from './types'
import type { Agent } from '../agent/agent'

export interface McpExposureFlags {
  /** 下一步是否展开全部 MCP 工具 */
  expand: boolean
  /** 已使用过的 MCP 工具名 (累积) */
  used: string[]
}

export class McpExposureState {
  private expandNext: boolean
  private readonly usedSet = new Set<string>()
  /** MCP 工具名集合的懒缓存; 仅在 outcome 含工具调用时才查询 agent.toolRegistry */
  private mcpNameSet: Set<string> | null = null

  constructor(private readonly agent: Agent) {
    // 首步默认: 若 agent 有 MCP 工具就展开 (避免强制 search_tool 双跳)
    this.expandNext = (agent.toolRegistry?.listMcpTools?.().length ?? 0) > 0
  }

  /** 给主循环用于传给 runReactStep 的当前 flag。 */
  get flags(): McpExposureFlags {
    return {
      expand: this.expandNext,
      used: [...this.usedSet],
    }
  }

  /**
   * 根据 step 结果更新内部状态。
   *
   * 规则:
   *   - 调过 search_tool → 下一步 expand=true (展开全集)
   *   - 调过其他 MCP 工具 → 加入 usedSet (累积可见)
   *   - 其余 → 下一步 expand=false
   */
  update(outcome: StepOutcome): void {
    let nextExpand = false
    if (outcome.toolNames.length > 0) {
      if (!this.mcpNameSet) {
        this.mcpNameSet = new Set(this.agent.toolRegistry.listMcpTools().map((t) => t.name))
      }
      for (const tn of outcome.toolNames) {
        if (tn === 'search_tool') {
          nextExpand = true
        } else if (this.mcpNameSet.has(tn)) {
          this.usedSet.add(tn)
        }
      }
    }
    this.expandNext = nextExpand
  }
}
