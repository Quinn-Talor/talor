import { describe, it, expect } from 'vitest'
import { ToolSelectionPlugin } from './ToolSelectionPlugin'
import type { PipelineContext } from '../types'
import type { Provider } from '../../store/config-store'
import type { ToolMetadata } from '../../tools/types'

function makeTool(name: string): ToolMetadata {
  return { name, description: `desc:${name}`, parameters: {} }
}

function makeAgentMock(builtinTools: ToolMetadata[], mcpTools: ToolMetadata[]) {
  return {
    toolRegistry: {
      listBuiltinTools: () => builtinTools,
      listMcpTools: () => mcpTools,
      listTools: () => [...builtinTools, ...mcpTools],
    },
  } as unknown as import('../../agent/agent').Agent
}

function makeCtx(opts: {
  builtinTools?: ToolMetadata[]
  mcpTools?: ToolMetadata[]
  mcpExpandThisStep?: boolean
  usedMcpToolNames?: string[]
  noAgent?: boolean
}): PipelineContext {
  const ctx: PipelineContext = {
    sessionId: 's1',
    currentMessage: { text: 'test' },
    provider: { id: 'p1' } as Provider,
    providerConfig: {
      provider: { id: 'p1' } as Provider,
      context_limit: 8000,
      recent_ratio: 0.05,
      summary_ratio: 0.1,
    },
    workspacePath: undefined,
  }
  if (!opts.noAgent) {
    ctx.agent = makeAgentMock(opts.builtinTools ?? [], opts.mcpTools ?? [])
  }
  if (opts.mcpExpandThisStep !== undefined) ctx.mcpExpandThisStep = opts.mcpExpandThisStep
  if (opts.usedMcpToolNames !== undefined) ctx.usedMcpToolNames = opts.usedMcpToolNames
  return ctx
}

const BUILTIN_8 = [
  makeTool('read'),
  makeTool('write'),
  makeTool('edit'),
  makeTool('bash'),
  makeTool('glob'),
  makeTool('grep'),
  makeTool('ls'),
  makeTool('skill'),
]
const BUILTIN_9_WITH_SEARCH = [...BUILTIN_8, makeTool('search_tool')]
const MCP_3 = [makeTool('m1'), makeTool('m2'), makeTool('m3')]

describe('ToolSelectionPlugin (Plan C: cumulative-used)', () => {
  describe('AC-5-1: no MCP tools returns base only', () => {
    it('returns base tools when listMcpTools is empty', async () => {
      const ctx = makeCtx({ builtinTools: BUILTIN_8, mcpTools: [] })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(8)
      expect(result.tools.map((t) => t.name)).toEqual(BUILTIN_8.map((t) => t.name))
      expect(result.messages).toEqual([])
    })
  })

  describe('AC-5-2: initial state — no expand, no used MCP → base only', () => {
    it('returns base when MCP available but never invoked yet', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: false,
        usedMcpToolNames: [],
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(9)
      const names = result.tools.map((t) => t.name)
      expect(names).toContain('search_tool')
      expect(names).not.toContain('m1')
    })

    it('treats undefined fields as initial state', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(9)
    })
  })

  describe('AC-5-3a: mcpExpandThisStep=true → base + ALL MCP (one-shot)', () => {
    it('exposes all MCP tools when expand flag is set', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: true,
        usedMcpToolNames: [],
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(12)
      const names = result.tools.map((t) => t.name)
      expect(names).toContain('m1')
      expect(names).toContain('m2')
      expect(names).toContain('m3')
    })

    it('expand overrides used set (still shows all)', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: true,
        usedMcpToolNames: ['m1'], // even with used set, expand wins
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(12)
    })
  })

  describe('AC-5-3b: cumulative used → base + only used MCP', () => {
    it('exposes only used MCP tools when expand=false', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: false,
        usedMcpToolNames: ['m1'],
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(10)
      const names = result.tools.map((t) => t.name)
      expect(names).toContain('m1')
      expect(names).not.toContain('m2')
      expect(names).not.toContain('m3')
    })

    it('exposes multiple used MCP tools', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: false,
        usedMcpToolNames: ['m1', 'm3'],
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(11)
      const names = result.tools.map((t) => t.name)
      expect(names).toContain('m1')
      expect(names).toContain('m3')
      expect(names).not.toContain('m2')
    })

    it('ignores unknown names in used set (defensive)', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: false,
        usedMcpToolNames: ['m1', 'unknown_tool'],
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      expect(result.tools).toHaveLength(10) // only m1 added
      expect(result.tools.map((t) => t.name)).toContain('m1')
    })
  })

  describe('AC-5-4: messages always empty', () => {
    it('no system notices in any scenario', async () => {
      const scenarios: Array<{ desc: string; ctx: PipelineContext }> = [
        { desc: 'no MCP', ctx: makeCtx({ builtinTools: BUILTIN_8, mcpTools: [] }) },
        {
          desc: 'initial',
          ctx: makeCtx({ builtinTools: BUILTIN_9_WITH_SEARCH, mcpTools: MCP_3 }),
        },
        {
          desc: 'expand',
          ctx: makeCtx({
            builtinTools: BUILTIN_9_WITH_SEARCH,
            mcpTools: MCP_3,
            mcpExpandThisStep: true,
          }),
        },
        {
          desc: 'cumulative',
          ctx: makeCtx({
            builtinTools: BUILTIN_9_WITH_SEARCH,
            mcpTools: MCP_3,
            usedMcpToolNames: ['m1'],
          }),
        },
        { desc: 'no agent', ctx: makeCtx({ noAgent: true }) },
      ]
      for (const s of scenarios) {
        const result = await new ToolSelectionPlugin().build(s.ctx)
        expect(result.messages, `messages should be empty for: ${s.desc}`).toEqual([])
      }
    })
  })

  describe('boundary cases', () => {
    it('no agent → empty tools', async () => {
      const result = await new ToolSelectionPlugin().build(makeCtx({ noAgent: true }))
      expect(result.tools).toEqual([])
      expect(result.tokenEstimate).toBe(0)
    })

    it('preserves order: builtin first, MCP after', async () => {
      const ctx = makeCtx({
        builtinTools: BUILTIN_9_WITH_SEARCH,
        mcpTools: MCP_3,
        mcpExpandThisStep: true,
      })
      const result = await new ToolSelectionPlugin().build(ctx)
      const names = result.tools.map((t) => t.name)
      expect(names.slice(0, 9)).toEqual(BUILTIN_9_WITH_SEARCH.map((t) => t.name))
      expect(names.slice(9)).toEqual(MCP_3.map((t) => t.name))
    })

    it('tokenEstimate scales with exposed MCP', async () => {
      const initial = await new ToolSelectionPlugin().build(
        makeCtx({ builtinTools: BUILTIN_9_WITH_SEARCH, mcpTools: MCP_3 }),
      )
      const cumulative = await new ToolSelectionPlugin().build(
        makeCtx({
          builtinTools: BUILTIN_9_WITH_SEARCH,
          mcpTools: MCP_3,
          usedMcpToolNames: ['m1'],
        }),
      )
      const expand = await new ToolSelectionPlugin().build(
        makeCtx({
          builtinTools: BUILTIN_9_WITH_SEARCH,
          mcpTools: MCP_3,
          mcpExpandThisStep: true,
        }),
      )
      expect(cumulative.tokenEstimate).toBeGreaterThan(initial.tokenEstimate)
      expect(expand.tokenEstimate).toBeGreaterThan(cumulative.tokenEstimate)
    })
  })
})
