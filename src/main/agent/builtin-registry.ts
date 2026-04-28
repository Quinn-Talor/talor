// src/main/agent/builtin-registry.ts — 基础设施层：内置工具只读注册表
//
// 全局单例，存放 8 个内置工具（read/write/edit/bash/glob/grep/ls/skill）。
// 构造后不可修改。所有 Agent 共享引用。
//
// 允许依赖：tools/types
// 禁止依赖：ipc/*、repos/*

import type { ToolDefinition, ToolExecuteContext, ToolMetadata } from '../tools/types'

export class BuiltinToolRegistry {
  private readonly tools: ReadonlyMap<string, ToolDefinition>

  constructor(tools: ToolDefinition[]) {
    const map = new Map<string, ToolDefinition>()
    for (const tool of tools) {
      if (map.has(tool.name)) continue
      map.set(tool.name, tool)
    }
    this.tools = map
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  listAll(): ToolMetadata[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      schema: t.schema,
      riskLevel: t.riskLevel,
    }))
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get size(): number {
    return this.tools.size
  }

  async execute(name: string, input: unknown, context: ToolExecuteContext): Promise<{ output: unknown }> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Builtin tool not found: ${name}`)
    return tool.execute(input, context)
  }
}
