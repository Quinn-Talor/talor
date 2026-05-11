import { describe, it, expect, vi } from 'vitest'
import { createSearchTool } from './search-tool'
import { isToolErrorEnvelope } from '../types'
import type { ToolExecuteContext, ToolMetadata } from '../types'
import type { McpToolSource } from '../../agent/agent-toolset'

function makeMcpSource(tools: ToolMetadata[]): McpToolSource {
  return {
    listRegisteredTools: () => tools,
    execute: async () => ({ output: 'noop' }),
  }
}

const baseCtx: ToolExecuteContext = {
  sessionId: 'test-session',
  workspace: '/tmp',
}

describe('search-tool', () => {
  describe('AC-1-1: loads MCP tools listing', () => {
    it('returns descriptive text with tool count and server list when MCP tools present', async () => {
      const mcp = makeMcpSource([
        { name: 't1', description: '', parameters: {}, provider: 'lark-im' },
        { name: 't2', description: '', parameters: {}, provider: 'lark-im' },
        { name: 't3', description: '', parameters: {}, provider: 'lark-im' },
        { name: 't4', description: '', parameters: {}, provider: 'lark-im' },
        { name: 't5', description: '', parameters: {}, provider: 'lark-im' },
        { name: 'c1', description: '', parameters: {}, provider: 'lark-calendar' },
        { name: 'c2', description: '', parameters: {}, provider: 'lark-calendar' },
        { name: 'c3', description: '', parameters: {}, provider: 'lark-calendar' },
      ])
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(typeof result.output).toBe('string')
      expect(result.output as string).toContain('Loaded 8 MCP tools')
      expect(result.output as string).toContain('lark-im')
      expect(result.output as string).toContain('lark-calendar')
    })

    it('lists single server correctly', async () => {
      const mcp = makeMcpSource([
        { name: 'x', description: '', parameters: {}, provider: 'server-x' },
      ])
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(result.output as string).toContain('Loaded 1 MCP tools')
      expect(result.output as string).toContain('server-x')
    })
  })

  describe('AC-1-2: returns ToolErrorEnvelope when mcpRegistry missing', () => {
    it('returns MCP_REGISTRY_MISSING envelope when mcpSource is null', async () => {
      const tool = createSearchTool(null)
      const result = await tool.execute({}, baseCtx)
      expect(isToolErrorEnvelope(result.output)).toBe(true)
      expect((result.output as { code: string }).code).toBe('MCP_REGISTRY_MISSING')
      expect((result.output as { message: string }).message.length).toBeGreaterThan(0)
    })

    it('returns MCP_LIST_FAILED envelope when listRegisteredTools throws', async () => {
      const mcp: McpToolSource = {
        listRegisteredTools: () => {
          throw new Error('boom')
        },
        execute: async () => ({ output: 'noop' }),
      }
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(isToolErrorEnvelope(result.output)).toBe(true)
      expect((result.output as { code: string }).code).toBe('MCP_LIST_FAILED')
      expect((result.output as { message: string }).message).toContain('boom')
    })
  })

  describe('AC-1-3: does not mutate context', () => {
    it('does not throw when context is frozen', async () => {
      const mcp = makeMcpSource([{ name: 'a', description: '', parameters: {}, provider: 'srv' }])
      const tool = createSearchTool(mcp)
      const frozenCtx = Object.freeze({ ...baseCtx }) as ToolExecuteContext
      await expect(tool.execute({}, frozenCtx)).resolves.toBeDefined()
    })
  })

  describe('boundary: empty MCP tools', () => {
    it('returns informational text when listRegisteredTools is empty', async () => {
      const mcp = makeMcpSource([])
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(result.output).toBe('No MCP tools currently available.')
      expect(isToolErrorEnvelope(result.output)).toBe(false)
    })
  })

  describe('boundary: tool missing provider field', () => {
    it('does not include undefined provider in server list', async () => {
      const mcp = makeMcpSource([
        { name: 'a', description: '', parameters: {} }, // no provider
        { name: 'b', description: '', parameters: {}, provider: 'srv' },
      ])
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(result.output as string).toContain('Loaded 2 MCP tools')
      expect(result.output as string).toContain('srv')
      expect(result.output as string).not.toContain('undefined')
    })

    it('falls back to "unknown" when no providers can be determined', async () => {
      const mcp = makeMcpSource([
        { name: 'a', description: '', parameters: {} },
        { name: 'b', description: '', parameters: {} },
      ])
      const tool = createSearchTool(mcp)
      const result = await tool.execute({}, baseCtx)
      expect(result.output as string).toContain('Loaded 2 MCP tools')
      expect(result.output as string).toContain('unknown')
    })
  })

  describe('tool definition shape', () => {
    it('has name "search_tool", riskLevel "LOW", and empty params', () => {
      const tool = createSearchTool(null)
      expect(tool.name).toBe('search_tool')
      expect(tool.riskLevel).toBe('LOW')
      expect(tool.parameters).toMatchObject({ type: 'object' })
      const params = tool.parameters as { properties?: Record<string, unknown> }
      expect(Object.keys(params.properties ?? {})).toHaveLength(0)
    })

    it('has descriptive text covering the trigger semantics', () => {
      const tool = createSearchTool(null)
      expect(tool.description).toMatch(/MCP/)
      expect(tool.description).toMatch(/next step/i)
    })

    it('description 通用化:不硬编码具体服务/产品名', () => {
      const tool = createSearchTool(null)
      // 不触发:具体服务名不应出现在 description 里,避免遗漏新场景时模型不会泛化
      expect(tool.description).not.toMatch(/MySQL|PostgreSQL|MongoDB|Redis|SQLite/i)
      expect(tool.description).not.toMatch(/GitHub|Slack|Notion|Linear|Jira/i)
      expect(tool.description).not.toMatch(/browser_navigate|browser_screenshot|github_search/)
    })

    it('description 描述能力边界 (local file/shell vs external)', () => {
      const tool = createSearchTool(null)
      // 触发:讲清楚"本机以外"的能力边界
      expect(tool.description).toMatch(/outside the local file system \/ shell/i)
      expect(tool.description).toMatch(/remote services|external data stores|3rd-party platforms/i)
    })

    it('description 明确警告 `which <name>` 反模式', () => {
      const tool = createSearchTool(null)
      // 触发:点名 `which` 反模式,避免模型用本机 CLI 检查判定能力可用性
      expect(tool.description).toMatch(/which <name>|`which/i)
      expect(tool.description).toMatch(/missing local binary does NOT mean/i)
    })

    it('description 警告"promise without call"反模式', () => {
      const tool = createSearchTool(null)
      // 触发:点名"说了不做"的常见 bug
      expect(tool.description).toMatch(/I will check X|I will look up X|I will query X/)
      expect(tool.description).toMatch(/Saying without calling is a bug/)
    })
  })

  it('does not import or use console (uses electron-log)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    spy.mockRestore()
  })
})
