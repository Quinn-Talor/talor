import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { AgentPromptPlugin } from './AgentPromptPlugin'
import { SkillRegistry } from '../../skills/registry'
import type { PipelineContext } from '../types'
import type { AgentManifest } from '@shared/types/agent'

function createContext(agent?: AgentManifest, skillRegistry?: SkillRegistry): PipelineContext {
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
    skillRegistry,
  }
}

function createSkillDir(baseDir: string, name: string, description: string): void {
  const dir = join(baseDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: "${description}"
---

# ${name}
content
`)
}

const SALES_MANIFEST: AgentManifest = {
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
  dependencies: { tools: [], skills: [], cli: [] },
}

describe('AgentPromptPlugin', () => {
  const plugin = new AgentPromptPlugin()

  it('returns empty messages when no agent in context', async () => {
    const result = await plugin.build(createContext())
    expect(result.messages).toEqual([])
    expect(result.tokenEstimate).toBe(0)
  })

  it('builds agent prompt from role capabilities and outputFormat', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
    expect(result.messages.length).toBeGreaterThan(0)
    const systemMsg = result.messages[0]
    expect(systemMsg.role).toBe('system')
    const content = (systemMsg as { role: string; content: string }).content
    expect(content).toContain('从飞书表格获取销售数据')
    expect(content).toContain('Markdown 格式的分析报告')
  })

  it('includes constraints in agent prompt', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('只处理销售相关数据')
  })

  it('includes knowledge index in agent prompt', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('product-catalog.md')
    expect(content).toContain('产品目录')
  })

  it('includes personality when present', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
    const content = (result.messages[0] as { role: string; content: string }).content
    expect(content).toContain('简洁专业')
  })

  it('includes few-shot from sampleConversations', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
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
    const manifest: AgentManifest = {
      ...SALES_MANIFEST,
      knowledge: { files: [] },
    }
    const result = await plugin.build(createContext(manifest))
    expect(result.messages.length).toBeGreaterThan(0)
  })

  it('handles empty sampleConversations', async () => {
    const manifest: AgentManifest = {
      ...SALES_MANIFEST,
      role: { ...SALES_MANIFEST.role, sampleConversations: [] },
    }
    const result = await plugin.build(createContext(manifest))
    expect(result.messages).toHaveLength(1)
  })

  it('returns non-zero tokenEstimate', async () => {
    const result = await plugin.build(createContext(SALES_MANIFEST))
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

    it('AC-S1-01: injects skill descriptions when skillRegistry has skills', async () => {
      createSkillDir(skillTempDir, 'lark-sheets', '飞书电子表格：创建和操作电子表格')
      createSkillDir(skillTempDir, 'lark-shared', '飞书/Lark CLI 共享基础')

      const registry = SkillRegistry.fromDir(skillTempDir)
      const result = await plugin.build(createContext(SALES_MANIFEST, registry))

      const systemMsgs = result.messages.filter(m => m.role === 'system')
      const content = systemMsgs.map(m => (m as { content: string }).content).join('\n')

      expect(content).toContain('你有以下技能可用')
      expect(content).toContain('lark-sheets: 飞书电子表格')
      expect(content).toContain('lark-shared:')
    })

    it('AC-S1-02: does not inject skill listing when registry is empty', async () => {
      const registry = SkillRegistry.fromDir(null)
      const result = await plugin.build(createContext(SALES_MANIFEST, registry))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).not.toContain('你有以下技能可用')
    })

    it('does not inject skill listing when no skillRegistry in context', async () => {
      const result = await plugin.build(createContext(SALES_MANIFEST))

      const content = result.messages
        .filter(m => m.role === 'system')
        .map(m => (m as { content: string }).content)
        .join('\n')

      expect(content).not.toContain('你有以下技能可用')
    })
  })
})
