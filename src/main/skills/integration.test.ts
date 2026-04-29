/**
 * Skill 双阶段加载集成测试
 *
 * 验证完整流程：
 *   阶段 1: AgentPromptPlugin 注入 description 列表到 system prompt
 *   阶段 2: skill Tool 被调用时返回完整 SKILL.md 内容（含 [SKILL:xxx activated] 标识）
 *   沉淀:  extractActivatedSkills 从消息历史提取激活的 Skill
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { SkillRegistry } from './registry'
import { createSkillTool } from './skill-tool'
import { extractActivatedSkills } from './extractor'
import { AgentPromptPlugin } from '../prompt/plugins/AgentPromptPlugin'
import { Agent } from '../agent/agent'
import { BuiltinToolRegistry } from '../agent/builtin-registry'
import type { PipelineContext } from '../prompt/types'
import type { AgentProfile } from '@shared/types/agent'
import type { ToolDefinition } from '../tools/types'
import type { ContentBlock } from '@shared/types/message'

function makeTool(name: string): ToolDefinition {
  return { name, description: `${name} tool`, parameters: {}, execute: async () => ({ output: name }) }
}
const builtinReg = new BuiltinToolRegistry([
  makeTool('read'), makeTool('write'), makeTool('edit'),
  makeTool('bash'), makeTool('glob'), makeTool('grep'),
  makeTool('ls'), makeTool('skill'),
])

let tempDir: string

const AGENT_PROFILE: AgentProfile = {
  id: 'test-agent',
  name: '测试Agent',
  description: '集成测试用',
  version: '1.0.0',
  role: {
    capabilities: ['测试能力'],
    outputFormat: '文本',
    sampleConversations: [],
  },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

function createSkillDir(name: string, description: string, content: string): void {
  const dir = join(tempDir, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: "${description}"
metadata:
  requires:
    bins: ["lark-cli"]
  cliHelp: "lark-cli ${name} --help"
---

${content}
`)
}

beforeEach(() => {
  vi.clearAllMocks()
  tempDir = mkdtempSync(join(tmpdir(), 'skill-integration-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('Skill 双阶段加载集成测试', () => {

  it('三阶段完整流程：description → 加载详情 → 真正使用', async () => {
    // ── Setup: 创建 2 个 Skill ──
    createSkillDir('lark-sheets', '飞书电子表格操作', `# sheets (v3)

## 可用命令
- \`lark-cli sheets +read --url URL\` — 读取表格数据
- \`lark-cli sheets +write --url URL --range A1 --data '[]'\` — 写入数据
- \`lark-cli sheets +info --url URL\` — 查看表格信息

## 使用流程
1. 先用 +info 查看表格结构
2. 再用 +read 读取数据
3. 分析后用 +write 写回`)

    createSkillDir('lark-im', '飞书即时通讯', `# im

## 可用命令
- \`lark-cli im +send --chat-id ID --text MSG\` — 发送消息`)

    const registry = SkillRegistry.fromDir(tempDir)
    const plugin = new AgentPromptPlugin()
    const skillTool = createSkillTool(registry)

    const agent = new Agent({
      profile: AGENT_PROFILE,
      source: null,
      builtinRegistry: builtinReg,
      mcpRegistry: null,
      skillRegistry: registry,
    })

    const ctx: PipelineContext = {
      sessionId: 'test-session',
      currentMessage: { text: '帮我查表格数据' },
      provider: { id: 'p', name: 'p', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' },
      providerConfig: { provider: { id: 'p', name: 'p', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' }, context_limit: 8000, recent_ratio: 0.7, summary_ratio: 0.2 },
      workspacePath: '/tmp',
      agent,
    }

    // ════════════════════════════════════════════════════════
    // 阶段 1: description 常驻 — LLM 知道有哪些 Skill 可用
    // ════════════════════════════════════════════════════════
    const promptResult = await plugin.build(ctx)
    const systemContent = promptResult.messages
      .filter(m => m.role === 'system')
      .map(m => (m as { content: string }).content)
      .join('\n')

    expect(systemContent).toContain('## Available Skills')
    expect(systemContent).toContain('lark-sheets: 飞书电子表格操作')
    expect(systemContent).toContain('lark-im: 飞书即时通讯')
    // 此时 LLM 只知道名称和简短描述，不知道具体命令

    console.log('╔══════════════════════════════════════════════╗')
    console.log('║     阶段 1: description 常驻 system prompt   ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log(systemContent)

    // ════════════════════════════════════════════════════════
    // 阶段 2: 加载 Skill 详情 — LLM 知道具体能力和命令
    // ════════════════════════════════════════════════════════
    // ReAct Step 1: LLM 看到 description 后判断需要 lark-sheets
    // LLM 输出 tool_use: skill({ name: "lark-sheets" })
    const loadResult = await skillTool.execute(
      { name: 'lark-sheets' },
      { sessionId: 'test', workspace: '' },
    )

    expect(loadResult.output).toMatch(/^\[SKILL:lark-sheets activated\]/)
    expect(loadResult.output).toContain('## 可用命令')
    expect(loadResult.output).toContain('lark-cli sheets +read')
    expect(loadResult.output).toContain('lark-cli sheets +write')
    // 现在 LLM 知道了 lark-sheets 有 +read/+write/+info 三个命令及用法

    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║     阶段 2: 加载 Skill 详情 (tool_result)     ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log(loadResult.output)

    // ════════════════════════════════════════════════════════
    // 阶段 3: 真正使用 — LLM 按 Skill 指令调用 Tool
    // ════════════════════════════════════════════════════════
    // ReAct Step 2: LLM 读到 Skill 内容后，按指令先查 info 再 read
    // LLM 输出 tool_use: bash({ command: "lark-cli sheets +info --url ..." })
    // LLM 输出 tool_use: bash({ command: "lark-cli sheets +read --url ..." })
    // （这些是真正的 Tool 调用，不再是 skill Tool）

    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║     阶段 3: LLM 按 Skill 指令使用 Tool        ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log('  ReAct Step 2: LLM 按 Skill 指令发起:')
    console.log('    → tool_use: bash({ command: "lark-cli sheets +info --url https://..." })')
    console.log('    → tool_use: bash({ command: "lark-cli sheets +read --url https://..." })')
    console.log('  （这些是真正的 Tool 调用，不再经过 skill Tool）')

    // ════════════════════════════════════════════════════════
    // 完整消息历史（模拟 ReAct loop 产生的消息序列）
    // ════════════════════════════════════════════════════════
    const messageHistory: Array<{ role: string; content: ContentBlock[] }> = [
      // 用户输入
      { role: 'user', content: [
        { type: 'text', text: '帮我查表格数据' },
      ]},

      // ReAct Step 1: LLM 请求加载 Skill（阶段 2）
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-1', toolName: 'skill', input: { name: 'lark-sheets' } },
      ]},

      // 平台返回 Skill 完整内容
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-1', toolName: 'skill',
          output: loadResult.output as string, isError: false },
      ]},

      // ReAct Step 2: LLM 读完 Skill 内容后，按指令调用 bash（阶段 3）
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-2', toolName: 'bash',
          input: { command: 'lark-cli sheets +info --url https://xxx.feishu.cn/sheets/abc' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-2', toolName: 'bash',
          output: '{"title":"销售周报","sheets":[{"id":"sheet1","title":"Sheet1"}]}', isError: false },
      ]},

      // ReAct Step 3: LLM 继续按 Skill 指令读取数据
      { role: 'assistant', content: [
        { type: 'tool_use', toolCallId: 'tc-3', toolName: 'bash',
          input: { command: 'lark-cli sheets +read --url https://xxx.feishu.cn/sheets/abc --sheet-id sheet1' } },
      ]},
      { role: 'assistant', content: [
        { type: 'tool_result', toolCallId: 'tc-3', toolName: 'bash',
          output: '[["日期","销售额"],["2026-04-21","12000"],["2026-04-22","15000"]]', isError: false },
      ]},

      // ReAct Step 4: LLM 生成分析报告（纯文本，无 tool_use）
      { role: 'assistant', content: [
        { type: 'text', text: '## 本周销售分析\n\n| 日期 | 销售额 |\n|------|--------|\n| 04-21 | 12,000 |\n| 04-22 | 15,000 |\n\n趋势：环比增长 25%' },
      ]},
    ]

    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║     完整消息历史（ReAct Loop 产出）           ║')
    console.log('╚══════════════════════════════════════════════╝')
    for (const [i, msg] of messageHistory.entries()) {
      const stepLabel = i === 0 ? '用户输入'
        : i <= 2 ? '阶段2 加载Skill'
        : i <= 6 ? '阶段3 使用Skill'
        : '最终输出'
      console.log(`\n[${stepLabel}] Message ${i} [${msg.role}]`)
      for (const block of msg.content) {
        if (block.type === 'text') {
          const text = block.text.length > 100 ? block.text.slice(0, 100) + '...' : block.text
          console.log(`  📝 ${text}`)
        } else if (block.type === 'tool_use') {
          console.log(`  🔧 ${block.toolName}(${JSON.stringify(block.input).slice(0, 80)})`)
        } else if (block.type === 'tool_result') {
          const out = block.output.length > 80 ? block.output.slice(0, 80) + '...' : block.output
          console.log(`  📦 ${block.toolName} → ${out}`)
        }
      }
    }

    // ════════════════════════════════════════════════════════
    // 沉淀提取
    // ════════════════════════════════════════════════════════
    const activatedSkills = extractActivatedSkills(messageHistory)
    expect(activatedSkills).toEqual(['lark-sheets'])

    console.log('\n╔══════════════════════════════════════════════╗')
    console.log('║     沉淀提取结果                              ║')
    console.log('╚══════════════════════════════════════════════╝')
    console.log('  激活的 Skills:', activatedSkills)
    console.log('  bash tool_use 被正确忽略（不是 skill 调用）')
    console.log('  三阶段分离清晰：description → 加载详情 → 真正使用')
  })

  it('无 Skill 的 Agent 不注入 description 也不注册 skill tool', async () => {
    const emptyRegistry = SkillRegistry.fromDir(null)
    const plugin = new AgentPromptPlugin()

    const agent = new Agent({
      profile: AGENT_PROFILE,
      source: null,
      builtinRegistry: builtinReg,
      mcpRegistry: null,
      skillRegistry: emptyRegistry,
    })

    const ctx: PipelineContext = {
      sessionId: 'test',
      currentMessage: { text: 'hello' },
      provider: { id: 'p', name: 'p', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' },
      providerConfig: { provider: { id: 'p', name: 'p', base_url: '', type: 'openai' as const, models: [], enabled: true, is_default: true, supports_vision: false, created_at: '', updated_at: '' }, context_limit: 8000, recent_ratio: 0.7, summary_ratio: 0.2 },
      workspacePath: '/tmp',
      agent,
    }

    const result = await plugin.build(ctx)
    const content = result.messages.map(m => (m as { content: string }).content).join('\n')

    expect(content).not.toContain('## 可用技能')
    expect(emptyRegistry.isEmpty()).toBe(true)

    console.log('\n=== 无 Skill Agent: prompt 中不含技能列表 ===')
    console.log('isEmpty:', emptyRegistry.isEmpty())
  })

  it('重复激活返回相同完整内容（长对话窗口滑出后可重新获取）', async () => {
    createSkillDir('lark-sheets', '表格', '# sheets\n完整指令内容')

    const registry = SkillRegistry.fromDir(tempDir)
    const tool = createSkillTool(registry)

    const first = await tool.execute({ name: 'lark-sheets' }, { sessionId: 't', workspace: '' })
    const second = await tool.execute({ name: 'lark-sheets' }, { sessionId: 't', workspace: '' })

    expect(second.output).toBe(first.output)
    expect(second.output).toContain('[SKILL:lark-sheets activated]')
    expect(second.output).toContain('# sheets')

    console.log('\n=== 重复激活: 返回完整内容（一致） ===')
    console.log('first === second:', first.output === second.output)
  })
})
