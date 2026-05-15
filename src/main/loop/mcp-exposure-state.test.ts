import { describe, it, expect } from 'vitest'
import { McpExposureState } from './mcp-exposure-state'
import type { StepOutcome } from './types'
import type { Agent } from '../agent/agent'

function makeAgent(mcpToolNames: string[]): Agent {
  return {
    toolRegistry: {
      listMcpTools: () => mcpToolNames.map((name) => ({ name, description: '', parameters: {} })),
    },
  } as unknown as Agent
}

function makeOutcome(overrides: Partial<StepOutcome> = {}): StepOutcome {
  return {
    stepText: '',
    wroteAssistantFinal: false,
    shouldContinue: true,
    durationMs: 0,
    toolNames: [],
    signature: '',
    allToolsFailed: null,
    containsSubagentFailure: false,
    ...overrides,
  }
}

describe('McpExposureState', () => {
  it('首步 expand=true (agent 有 MCP 工具)', () => {
    const state = new McpExposureState(makeAgent(['m1', 'm2']))
    expect(state.flags.expand).toBe(true)
    expect(state.flags.used).toEqual([])
  })

  it('首步 expand=false (agent 无 MCP 工具)', () => {
    const state = new McpExposureState(makeAgent([]))
    expect(state.flags.expand).toBe(false)
  })

  it('调过 search_tool → 下一步 expand=true', () => {
    const state = new McpExposureState(makeAgent(['m1']))
    state.update(makeOutcome({ toolNames: ['search_tool'] }))
    expect(state.flags.expand).toBe(true)
  })

  it('调过 MCP 工具 m1 → 加入 used 集合, 下一步 expand=false', () => {
    const state = new McpExposureState(makeAgent(['m1', 'm2']))
    state.update(makeOutcome({ toolNames: ['m1'] }))
    expect(state.flags.expand).toBe(false)
    expect(state.flags.used).toEqual(['m1'])
  })

  it('used 集合累积, 不收缩', () => {
    const state = new McpExposureState(makeAgent(['m1', 'm2']))
    state.update(makeOutcome({ toolNames: ['m1'] }))
    state.update(makeOutcome({ toolNames: ['m2'] }))
    expect(state.flags.used.sort()).toEqual(['m1', 'm2'])
  })

  it('内置工具调用不影响 used 集合', () => {
    const state = new McpExposureState(makeAgent(['m1']))
    state.update(makeOutcome({ toolNames: ['read', 'write'] })) // 内置, 非 MCP
    expect(state.flags.used).toEqual([])
    expect(state.flags.expand).toBe(false)
  })

  it('search_tool + 普通 MCP 同步调用 → 下一步 expand=true + used 加入 m1', () => {
    const state = new McpExposureState(makeAgent(['m1']))
    state.update(makeOutcome({ toolNames: ['search_tool', 'm1'] }))
    expect(state.flags.expand).toBe(true)
    expect(state.flags.used).toEqual(['m1'])
  })

  it('forceExpandNext: 上一步 final 纯文本后调用 → 下一步 expand=true', () => {
    const state = new McpExposureState(makeAgent(['m1']))
    state.update(makeOutcome({ toolNames: [] })) // 纯文本 final → expandNext=false
    expect(state.flags.expand).toBe(false)
    state.forceExpandNext()
    expect(state.flags.expand).toBe(true)
  })

  it('forceExpandNext: agent 无 MCP 工具 → 仍 expand=false', () => {
    const state = new McpExposureState(makeAgent([]))
    state.forceExpandNext()
    expect(state.flags.expand).toBe(false)
  })

  it('search_tool → m1 → m1 链路: 第三步 expand=false 但 used 仍有 m1', () => {
    const state = new McpExposureState(makeAgent(['m1']))
    state.update(makeOutcome({ toolNames: ['search_tool'] }))
    expect(state.flags.expand).toBe(true)
    state.update(makeOutcome({ toolNames: ['m1'] }))
    expect(state.flags.expand).toBe(false)
    expect(state.flags.used).toEqual(['m1'])
    state.update(makeOutcome({ toolNames: ['m1'] }))
    expect(state.flags.expand).toBe(false)
    expect(state.flags.used).toEqual(['m1'])
  })
})
