import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ToolSelectionPlugin } from './ToolSelectionPlugin'
import type { PipelineContext } from '../types'
import type { Provider } from '../../store/config-store'

vi.mock('../../tools/registry', () => ({
  toolRegistry: { getAllSchemas: vi.fn() },
}))
vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('../../providers/llm-provider', () => ({ createModel: vi.fn(() => ({})) }))
vi.mock('electron-log', () => ({ default: { warn: vi.fn() } }))

import { toolRegistry } from '../../tools/registry'
import { generateText } from 'ai'
import log from 'electron-log'

function makeCtx(text = 'test'): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text },
    provider: { id: 'p1' } as Provider,
    providerConfig: { provider: { id: 'p1' } as Provider, context_limit: 8000, recent_ratio: 0.05, summary_ratio: 0.10 },
    workspacePath: undefined,
  }
}

function makeTools(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i + 1}`,
    description: `Tool ${i + 1}`,
    parameters: {},
  }))
}

describe('ToolSelectionPlugin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-004-04: < 20 个工具直接返回，不调用 LLM', async () => {
    vi.mocked(toolRegistry.getAllSchemas).mockReturnValue(makeTools(15))
    const result = await new ToolSelectionPlugin().build(makeCtx())
    expect(result.tools).toHaveLength(15)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('AC-004-02: >= 20 个工具时调用 LLM 选择', async () => {
    vi.mocked(toolRegistry.getAllSchemas).mockReturnValue(makeTools(25))
    vi.mocked(generateText).mockResolvedValue({ text: '["tool_2","tool_5","tool_10"]' } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never)
    const result = await new ToolSelectionPlugin().build(makeCtx())
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(result.tools.map(t => t.name)).toEqual(['tool_2', 'tool_5', 'tool_10'])
  })

  it('AC-004-03: LLM 失败时降级到前 19 个工具', async () => {
    vi.mocked(toolRegistry.getAllSchemas).mockReturnValue(makeTools(25))
    vi.mocked(generateText).mockRejectedValue(new Error('timeout'))
    const result = await new ToolSelectionPlugin().build(makeCtx())
    expect(result.tools).toHaveLength(19)
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('LLM 动态选择失败'),
      expect.any(Error)
    )
  })

  it('generateText 调用携带 abortSignal 超时', async () => {
    vi.mocked(toolRegistry.getAllSchemas).mockReturnValue(makeTools(25))
    vi.mocked(generateText).mockResolvedValue({ text: '["tool_1"]' } as ReturnType<typeof generateText> extends Promise<infer T> ? T : never)
    await new ToolSelectionPlugin().build(makeCtx())
    const callArg = vi.mocked(generateText).mock.calls[0][0]
    expect(callArg).toHaveProperty('abortSignal')
    expect(callArg.abortSignal).toBeInstanceOf(AbortSignal)
  })
})
