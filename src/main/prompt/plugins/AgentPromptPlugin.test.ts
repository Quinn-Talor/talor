import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentPromptPlugin } from './AgentPromptPlugin'
import { Agent } from '../../agent/agent'
import { BuiltinToolRegistry } from '../../agent/builtin-registry'
import { SkillRegistry } from '../../skills/registry'
import type { PipelineContext } from '../types'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../../tools/types'

function makeTool(name: string): ToolDefinition {
  return {
    name, description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ output: name }),
  }
}

const builtinRegistry = new BuiltinToolRegistry([
  makeTool('read'), makeTool('write'), makeTool('edit'),
  makeTool('bash'), makeTool('glob'), makeTool('grep'),
  makeTool('ls'), makeTool('skill'),
])

function createAgent(profile: AgentProfile, skillRegistry?: SkillRegistry): Agent {
  return new Agent({
    profile,
    source: null,
    builtinRegistry,
    mcpRegistry: null,
    skillRegistry: skillRegistry ?? SkillRegistry.fromDir(null),
  })
}

function createContext(agent?: Agent): PipelineContext {
  return {
    sessionId: 'test-session',
    currentMessage: { text: '帮我看下本周销售数据' },
    provider: { id: 'test', name: 'test', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' },
    providerConfig: {
      provider: { id: 'test', name: 'test', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' },
      context_limit: 8000,
      recent_ratio: 0.7,
      summary_ratio: 0.2,
    },
    workspacePath: '/tmp/test',
    agent,
  }
}

function createSkillDir(baseDir: string, name: string, description: string, whenToUse?: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  const whenLine = whenToUse ? `\nwhen_to_use: "${whenToUse}"` : ''
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: "${description}"${whenLine}
---

# ${name}
content
`)
}

const SALES_PROFILE: AgentProfile = {
  id: 'sales-analyst-001',
  name: '销售分析师',
  description: '自动汇总周度销售数据',
  version: '1.0.0',
  role: {
    capabilities: ['从飞书表格获取销售数据', '生成趋势分析图表', '撰写周报摘要'],
    constraints: ['只处理销售相关数据', '不修改原始数据表'],
    outputFormat: 'Markdown 格式的分析报告',
    personality: '简洁专业',
    language: 'zh-CN',
    sampleConversations: [
      {
        title: '汇总周报',
        messages: [
          { role: 'user', content: '帮我看下本周销售' },
          { role: 'assistant', content: '好的，我来汇总本周销售数据。' },
        ],
      },
    ],
  },
  knowledge: {
    files: [
      {
        path: './knowledge/product-catalog.md',
        description: '产品目录，包含所有产品名称、SKU 和定价',
        required: true,
        format: 'markdown',
      },
    ],
  },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

describe('AgentPromptPlugin', () => {
  const plugin = new AgentPromptPlugin()

  it('returns empty messages when no agent in context', async () => {
    const result = await plugin.build(createContext())
    expect(result.messages).toEqual([])
    expect(result.tokenEstimate).toBe(0)
  })

  it('builds agent prompt from role capabilities and outputFormat', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    expect(result.messages.length).toBeGreaterThan(0)
    const systemMsg = result.messages[0]
    expect(systemMsg.role).toBe('system')
    const content = (systemMsg as { role: string; content: string }).content
    expect(content).toContain('从飞书表格获取销售数据')
    expect(content).toContain('Markdown 格式的分析报告')
  })

  it('includes constraints in agent prompt', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('只处理销售相关数据')
  })

  it('includes knowledge index in agent prompt', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('product-catalog.md')
    expect(content).toContain('产品目录')
  })

  it('includes personality when present', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('简洁专业')
  })

  it('includes few-shot from sampleConversations', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    const userMsg = result.messages.find(
      m => m.role === 'user' && (m as { content: string }).content === '帮我看下本周销售',
    )
    const assistantMsg = result.messages.find(
      m => m.role === 'assistant' && (m as { content: string }).content.includes('汇总本周销售'),
    )
    expect(userMsg).toBeDefined()
    expect(assistantMsg).toBeDefined()
  })

  it('handles empty knowledge files', async () => {
    const agent = createAgent({ ...SALES_PROFILE, knowledge: { files: [] } })
    const result = await plugin.build(createContext(agent))
    expect(result.messages.length).toBeGreaterThan(0)
  })

  it('handles empty sampleConversations', async () => {
    const agent = createAgent({
      ...SALES_PROFILE,
      role: { ...SALES_PROFILE.role, sampleConversations: [] },
    })
    const result = await plugin.build(createContext(agent))
    expect(result.messages).toHaveLength(1)
  })

  it('returns non-zero tokenEstimate', async () => {
    const agent = createAgent(SALES_PROFILE)
    const result = await plugin.build(createContext(agent))
    expect(result.tokenEstimate).toBeGreaterThan(0)
  })

  describe('skill description injection', () => {
    let skillTempDir: string

    beforeEach(() => {
      skillTempDir = mkdtempSync(join(tmpdir(), 'agent-prompt-skill-'))
    })

    afterEach(() => {
      rmSync(skillTempDir, { recursive: true, force: true })
    })

    it('AC-S1-01: injects skill descriptions when agent has skills', async () => {
      createSkillDir(skillTempDir, 'lark-sheets', '飞书电子表格：创建和操作电子表格')
      createSkillDir(skillTempDir, 'lark-shared', '飞书/Lark CLI 共享基础')

      const registry = SkillRegistry.fromDir(skillTempDir)
      const agent = createAgent(SALES_PROFILE, registry)
      const result = await plugin.build(createContext(agent))

      const systemMsgs = result.messages.filter(m => m.role === 'system')
      const content = systemMsgs.map(m => (m as { content: string }).content).join('\n')

      expect(content).toContain('## Available Skills')
      // 新格式: `- <name>\n  <description>`(多行),不再是 `- <name>: <description>`
      expect(content).toMatch(/- lark-sheets\n\s+飞书电子表格/)
      expect(content).toMatch(/- lark-shared\n\s+飞书\/Lark CLI/)
    })

    it('AC-S1-02: does not inject skill listing when registry is empty', async () => {
      const agent = createAgent(SALES_PROFILE)
      const result = await plugin.build(createContext(agent))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).not.toContain('## Available Skills')
    })

    it('当 skill 有 when_to_use 时渲染 "When to use:" 行', async () => {
      createSkillDir(
        skillTempDir,
        'lark-doc',
        '飞书云文档',
        '用户要求写飞书文档时触发。触发短语：飞书文档,lark doc',
      )
      const registry = SkillRegistry.fromDir(skillTempDir)
      const agent = createAgent(SALES_PROFILE, registry)
      const result = await plugin.build(createContext(agent))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).toMatch(/- lark-doc\n\s+飞书云文档/)
      expect(content).toMatch(/When to use: 用户要求写飞书文档时触发/)
      expect(content).toContain('触发短语：飞书文档,lark doc')
    })

    it('当 skill 无 when_to_use 时省略 "When to use:" 行', async () => {
      createSkillDir(skillTempDir, 'plain-skill', '普通 skill')
      const registry = SkillRegistry.fromDir(skillTempDir)
      const agent = createAgent(SALES_PROFILE, registry)
      const result = await plugin.build(createContext(agent))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).toMatch(/- plain-skill\n\s+普通 skill/)
      expect(content).not.toMatch(/When to use:/)
    })

    it('skill listing 顶部说明包含 "When to use" 提示', async () => {
      createSkillDir(skillTempDir, 'lark-doc', '飞书云文档')
      const registry = SkillRegistry.fromDir(skillTempDir)
      const agent = createAgent(SALES_PROFILE, registry)
      const result = await plugin.build(createContext(agent))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).toMatch(/Each entry is an encapsulated capability/)
      expect(content).toContain('Use via `skill` tool')
      expect(content).toContain('When to use')
    })
  })
})
