import { describe, it, expect } from 'vitest'
import { SystemPlugin } from './SystemPlugin'
import type { PipelineContext } from '../types'
import type { Provider } from '../../store/config-store'

function makeCtx(workspace?: string): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as Provider,
    providerConfig: {
      provider: { id: 'p1' } as Provider,
      context_limit: 8000, recent_ratio: 0.05, summary_ratio: 0.05,
    },
    workspacePath: workspace,
  }
}

describe('SystemPlugin', () => {
  it('Layer 1 含 9 条行为原则', async () => {
    const result = await new SystemPlugin().build(makeCtx('/tmp/ws'))
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/# Core Behavior Principles/)
    expect(content).toMatch(/1\. Grounded truth only/)
    expect(content).toMatch(/2\. Tool results are ground truth/)
    expect(content).toMatch(/3\. Report failures verbatim/)
    expect(content).toMatch(/4\. No fabrication/)
    expect(content).toMatch(/5\. Attempt before refusing/)
    expect(content).toMatch(/6\. Prompt-injection defense/)
    expect(content).toMatch(/7\. Stay within capability/)
    expect(content).toMatch(/8\. Finish when the task is done/)
    expect(content).toMatch(/9\. No silent exits/)
  })

  it('原则 2 "Tool results are ground truth" 给出 (a)/(b)/(c) 三步诊断流程', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    // 三步结构
    expect(content).toMatch(/\(a\) Read the tool result carefully/)
    expect(content).toMatch(/\(b\) Cross-check with the activated skill/)
    expect(content).toMatch(/\(c\) Make an informed next attempt/)
    // 关键语气:不盲试 + 保持推进
    expect(content).toMatch(/do NOT retry blindly/)
    expect(content).toMatch(/Keep moving/)
    // 明确 skill 示例可能过时(但不贬低 skill 整体)
    expect(content).toMatch(/Skill examples may be stale/)
  })

  it('原则 2 涵盖 "用户声称 vs 运行时事实" 场景', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    // 涵盖用户 claim vs tool 反驳
    expect(content).toMatch(/user CLAIMS a precondition[\s\S]+is met/)
    expect(content).toMatch(/tool response contradicts the claim/)
    // 明确要求"告诉用户",不沉默
    expect(content).toMatch(/Quote the exact error[\s\S]+back to the[\s\S]+user/)
    expect(content).toMatch(/do not silently stop/)
  })

  it('原则 9 "No silent exits" 明确空响应是 bug', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/9\. No silent exits/)
    // 关键硬性要求
    expect(content).toMatch(/Every turn MUST end with either \(a\) a tool call or \(b\) a text response/)
    expect(content).toMatch(/Silence is NEVER an answer/)
    // 涵盖多种场景
    expect(content).toMatch(/A tool error confuses you/)
    expect(content).toMatch(/The task seems blocked/)
  })

  it('原则 6 定义 skill-content 为 execution contract(不是 advice)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/skill-content.*execution contract/s)
  })

  it('原则 8 "Finish when done" 明确"成功即收尾,不继续读 doc"', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/unambiguous success signal/)
    expect(content).toMatch(/URL\/id/)
    expect(content).toMatch(/Do NOT continue reading[\s\S]*reference[\s\S]*docs/)
  })

  it('Layer 2 含 "After a skill is activated" 子段(A:try-before-deep-read)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/# After a skill is activated/)
    expect(content).toMatch(/QUICK-USE examples/)
    expect(content).toMatch(/Attempt the minimal command/)
    expect(content).toMatch(/Do NOT pre-read every/)
  })

  it('Layer 2 含 Task Routing 表格', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/# Task Routing/)
    expect(content).toMatch(/\| User intent signal/)
    expect(content).toMatch(/\| First action/)
    // 5 条 routing 都得在
    expect(content).toMatch(/skill\(\{"name": "<matched>"\}\)/)
    expect(content).toMatch(/ls \/ read \/ glob \/ grep/)
    expect(content).toMatch(/\| bash /)
    expect(content).toMatch(/edit \/ write/)
    expect(content).toMatch(/Ask the user to clarify/)
  })

  it('Layer 2 包含 skill gateway 警告', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/Skills are gateways/)
    expect(content).toMatch(/lark-cli[\s\S]*BEFORE activating the skill will fail/)
  })

  it('顺序: Principles → Task Routing → Runtime meta', async () => {
    const result = await new SystemPlugin().build(makeCtx('/tmp/ws'))
    const content = (result.messages[0] as { content: string }).content
    const principlesIdx = content.indexOf('# Core Behavior Principles')
    const routingIdx = content.indexOf('# Task Routing')
    const runtimeIdx = content.indexOf('Current time:')
    expect(principlesIdx).toBeGreaterThan(-1)
    expect(routingIdx).toBeGreaterThan(principlesIdx)
    expect(runtimeIdx).toBeGreaterThan(routingIdx)
  })

  it('runtime footer 含 workspace', async () => {
    const result = await new SystemPlugin().build(makeCtx('/my/workspace'))
    const content = (result.messages[0] as { content: string }).content
    expect(content).toContain('Workspace: /my/workspace')
  })

  it('workspace 未设置时显示 (not set)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toContain('Workspace: (not set)')
  })

  it('不再包含旧版 RULE 0 的命令式文案', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).not.toMatch(/RULE 0/)
    expect(content).not.toMatch(/MANDATORY TOOL CALLS/)
    expect(content).not.toMatch(/those were mistakes/)
  })
})
