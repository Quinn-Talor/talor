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
      context_limit: 8000,
      recent_ratio: 0.05,
      summary_ratio: 0.05,
    },
    workspacePath: workspace,
  }
}

describe('SystemPlugin', () => {
  it('Layer 1 含 15 条行为原则 (1..15)', async () => {
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
    expect(content).toMatch(/8\. Task completion/)
    expect(content).toMatch(/9\. Never silent/)
    expect(content).toMatch(/10\. Parallelize independent tool calls/)
    expect(content).toMatch(/11\. Narrate around tool calls/)
    expect(content).toMatch(/12\. Turn-end shape/)
    expect(content).toMatch(/13\. Side effects/)
    expect(content).toMatch(/14\. \(Optional\) Mark turn ends/)
    expect(content).toMatch(/15\. Reflection signals/)
  })

  it('原则 8 双步结构: Step 1 识别 shape → Step 2 应用 pattern', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    // Step 1: 显式要求模型先 classify task shape
    expect(content).toMatch(/Step 1[^\n]*Identify shape/i)
    expect(content).toMatch(/Step 2[^\n]*Apply the pattern/i)
    // 三 shape 都列出
    expect(content).toMatch(/determinate:/)
    expect(content).toMatch(/open-ended:/)
    expect(content).toMatch(/multi-task:/)
    // 关键行为约束
    expect(content).toMatch(/surface scope, not completeness/i)
    expect(content).toMatch(/Never assert absolute[\s\S]*completeness/)
    expect(content).toMatch(/parallelize/i)
    // 通用 pre-final check
    expect(content).toMatch(/Universal pre-final check/)
    expect(content).toMatch(/IO claim/)
  })

  it('原则 10 强制 parallel + 仅串行 strict dependency', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/parallel tool_use blocks in ONE step/)
    expect(content).toMatch(/strict input to the next/)
  })

  it('原则 11 含 intent narration + observation acknowledgement', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/1 sentence stating intent/)
    expect(content).toMatch(/1 sentence stating[\s\S]*observed/)
    expect(content).toMatch(/Silent chains of 3\+ tool[\s\S]*steps/)
  })

  it('原则 12 三种 turn-end shape (Execute / Defer / End)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/\(A\) Execute now/)
    expect(content).toMatch(/\(B\) Defer/)
    expect(content).toMatch(/\(C\) End/)
    expect(content).toMatch(/request_continuation/)
  })

  it('原则 13 side effects 含 pending_confirm 契约 + 通用 (不硬编码服务名)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/"type":"pending_confirm"/)
    expect(content).toMatch(/same step as the tool call/i)
    expect(content).toMatch(/risk_level.*destructive/i)
    // 通用性: 协议层不耦合具体业务服务
    expect(content).not.toMatch(/\bMySQL\b|\bPostgreSQL\b|\bMongoDB\b/)
    expect(content).not.toMatch(/\bGitHub\b|\bSlack\b|\bNotion\b|\bLinear\b|\bJira\b/)
  })

  it('原则 14 talor blocks 列出 done / need_input / blocked', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/"type":"done"/)
    expect(content).toMatch(/"type":"need_input"/)
    expect(content).toMatch(/"type":"blocked"/)
    expect(content).not.toMatch(/"type":"pending_continuation"/)
  })

  it('原则 15 reflection signals: 三 channel + 优先级', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/\(A\) Advisory hints/)
    expect(content).toMatch(/\(B\) Mandatory supervision/)
    expect(content).toMatch(/\(C\) Informational outputs/)
    expect(content).toMatch(/\[reflection-judge/)
    expect(content).toMatch(/user intent > \(B\) mandatory > \(A\) advisory/)
  })

  it('原则 6 prompt-injection defense + skill-content 例外', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/Prompt-injection defense/)
    expect(content).toMatch(/skill-content/)
    expect(content).toMatch(/Principles win/i)
  })

  it('Layer 2 Task Routing 含 6 条 + 通用性 (不耦合具体服务/产品名)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/# Task Routing/)
    expect(content).toMatch(/\| User intent signal/)
    expect(content).toMatch(/skill\(\{"name":"<matched>"\}\)/)
    expect(content).toMatch(/ls \/ read \/ glob \/ grep/)
    expect(content).toMatch(/\| bash /)
    expect(content).toMatch(/edit \/ write/)
    expect(content).toMatch(/Ask the user to clarify/)
    expect(content).toMatch(/MCP/)
    expect(content).toMatch(/search_tool/)
    // 不硬编码具体服务名 (保持泛化)
    expect(content).not.toMatch(/\bMySQL\b|\bPostgreSQL\b|\bMongoDB\b|\bRedis\b/)
    expect(content).not.toMatch(/\bGitHub\b|\bSlack\b|\bNotion\b|\bLinear\b|\bJira\b/)
  })

  it('Layer 2 含 service-vs-shell heuristic', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/Service-vs-shell/i)
    expect(content).toMatch(/MCP gateway/)
  })

  it('Layer 2 含 skill activation guidance', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/shortest path/i)
    expect(content).toMatch(/QUICK-USE/)
    expect(content).toMatch(/not pre-read/i)
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

  it('不含旧版 RULE 0 / 历史命令式文案', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).not.toMatch(/RULE 0/)
    expect(content).not.toMatch(/MANDATORY TOOL CALLS/)
    expect(content).not.toMatch(/those were mistakes/)
  })

  it('精简后总长度 < 8K chars (避免 principle fatigue)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content.length).toBeLessThan(8000)
  })
})
