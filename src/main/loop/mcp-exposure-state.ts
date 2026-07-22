// src/main/loop/mcp-exposure-state.ts —— 业务层: MCP 工具暴露策略状态
//
// 收敛主循环散落的 3 个变量 (mcpExpandThisStep / usedMcpToolNames / mcpNameSet 懒缓存)。
//
// 策略 (方案 C "累积可见", 与 ToolSelectionPlugin 配合):
//   - 系统/内置工具 (base) 常驻;外部 (MCP) 工具**一律经 search_tool 发现**,首步不展开
//     (无 magic number 阈值 — 外部集可达 280+,首步全抛既撑爆 context 又降选择精度)。
//   - search_tool 调用后下一步展开全集 (一次性), 之后收敛回 base + used。
//   - usedMcpToolNames 累积 — 已用过的 MCP 工具永远可见, 不收缩。
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
    // 首步不展开外部工具:系统工具由 base 常驻,MCP 一律经 search_tool 按需发现。
    this.expandNext = false
  }

  /** 给主循环用于传给 runReactStep 的当前 flag。 */
  get flags(): McpExposureFlags {
    return {
      expand: this.expandNext,
      used: [...this.usedSet],
    }
  }

  /**
   * 强制下一步 expand=true。
   *
   * 用于 reflect 推翻 final 并 continue 的场景: 上一步 outcome 为纯文本 final
   * (toolNames=[]), 正常 update 会将 expandNext 设为 false; 若模型此前 search 过、
   * 从历史/搜索结果看到 MCP 工具名却在恢复步拿不到 schema, 会幻觉调用 → tool_use
   * 没有对应 tool_result, 下一步 streamText 校验失败。恢复步重新展开兜底 (罕见路径,
   * 正确性优先于 context)。
   */
  forceExpandNext(): void {
    this.expandNext = (this.agent.toolRegistry?.listMcpTools?.().length ?? 0) > 0
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
