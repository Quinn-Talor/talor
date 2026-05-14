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
  it('Layer 1 含 14 条行为原则', async () => {
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
    expect(content).toMatch(/10\. Parallel tool calls/)
    expect(content).toMatch(/11\. Always state intent/)
    expect(content).toMatch(/12\. Promise then call/)
    expect(content).toMatch(/13\. \(Optional\) Mark turn-ending decisions/)
    expect(content).toMatch(/14\. Declare side effects before invoking/)
  })

  it('原则 12 "Promise then call" 明确"宣布行动必须同步执行"', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    // prompt 有换行 + 缩进排版,断言用空白归一化避免跨行误判
    const norm = content.replace(/\s+/g, ' ')

    expect(norm).toContain('12. Promise then call')
    // 触发:同一 turn 内必须配 tool_call
    expect(norm).toContain('SAME turn MUST include the actual tool call')
    // 触发:点名常见意图短语(中英双语,覆盖中文模型场景)
    expect(norm).toContain('I will create X')
    expect(norm).toContain('现在创建')
    // 触发:与 Rule 9 的区分要说清楚
    expect(norm.toLowerCase()).toContain('different from rule 9')
    // 触发:阻塞时应 ASK 或 REPORT,不应宣布
    expect(norm).toContain('ASK the user')
    expect(norm).toContain('REPORT what you found')
    // v3.7: wait-for-user dual case 简化 —— 没有 marker 要求,只需 "drop the tool calls, end the turn"
    expect(norm).toContain('do NOT call any tool in the SAME turn')
    expect(norm).toContain('Truly wait')
    expect(norm).toContain('Truly proceed')
    // 触发: pending_confirm 引导(side-effect 工具配 confirm,不是矛盾的"等"+"做")
    expect(norm).toContain('pending_confirm')
    // 不触发:不应硬编码具体服务名(保持通用)
    expect(content).not.toMatch(/MySQL|GitHub|Slack/i)
  })

  it('原则 13 "(Optional) Mark turn-ending decisions with talor blocks" 退化为可选 UI 增强', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    const norm = content.replace(/\s+/g, ' ')

    // v3.7: Rule 13 退化为可选段
    expect(norm).toContain('13. (Optional) Mark turn-ending decisions with talor blocks')
    // 触发: 强调 turn end 由"无 tool call"决定,不需要 marker
    expect(norm).toContain('no tool call this step')
    expect(norm).toContain("don't need any marker")
    // 触发: UI 推断说明
    expect(norm).toContain('UI will infer your intent')
    expect(norm).toContain('need_input card')
    expect(norm).toContain('blocked card')
    expect(norm).toContain('done card')
    // 触发: 可选用法 — fenced talor block 仍可主动 emit
    expect(content).toMatch(/```talor/)
    expect(content).toMatch(/"type":"done"/)
    expect(content).toMatch(/"type":"need_input"/)
    expect(content).toMatch(/"type":"blocked"/)
    // 触发: streaming detection 规则
    expect(norm).toContain('FIRST key')
    // 触发: Rule 14 引用 (mid-turn pending_confirm)
    expect(norm).toContain('Rule 14')
    // 触发: 整体定位 "nice-to-have, not required"
    expect(norm).toContain('nice-to-have')
  })

  it('原则 14 "Declare side effects before invoking" 定义 pending_confirm 契约', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    const norm = content.replace(/\s+/g, ' ')

    expect(norm).toContain('14. Declare side effects before invoking')
    // 触发: pending_confirm block 出现在示例中
    expect(content).toMatch(/"type":\s*"pending_confirm"/)
    // 触发: 必须在 SAME step 与 tool call 一起 emit
    expect(norm).toContain('SAME step as the')
    // 触发: 副作用 vs 只读 分类
    expect(content).toMatch(/INSERT.*UPDATE.*DELETE/s)
    expect(norm).toContain('SELECT / GET / list')
    // 触发: pattern key 格式
    expect(norm).toContain('<tool>:<op>:<target>')
    // 触发: destructive 不可记忆
    expect(norm).toContain('Destructive operations cannot be remembered')
    // 触发: fallback 兜底机制提示
    expect(norm).toContain("framework's fallback")
    // 不触发: 不应硬编码具体业务名 (保持通用性) - 注: 示例里 mysql/lark 是格式范例,允许出现
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
    expect(content).toMatch(
      /Every turn MUST end with either \(a\) a tool call or \(b\) a text response/,
    )
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

  it('Layer 2 含 Task Routing 表格 (6 条 routing)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/# Task Routing/)
    expect(content).toMatch(/\| User intent signal/)
    expect(content).toMatch(/\| First action/)
    // 6 条 routing 都得在
    expect(content).toMatch(/skill\(\{"name": "<matched>"\}\)/)
    expect(content).toMatch(/ls \/ read \/ glob \/ grep/)
    expect(content).toMatch(/\| bash /)
    expect(content).toMatch(/edit \/ write/)
    expect(content).toMatch(/Ask the user to clarify/)
    // 新增第 6 条:外部系统/MCP 入口
    expect(content).toMatch(/outside this machine/i)
    expect(content).toMatch(/search_tool/)
  })

  it('Layer 2 含 external-system routing,引导到 MCP (通用,不硬编码服务名)', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    // 触发:存在通用 "outside / remote / external" 表述 + MCP 引导
    expect(content).toMatch(/outside this machine|remote service|external data store/i)
    expect(content).toMatch(/MCP tools/)
    expect(content).toMatch(/search_tool/)
    // 不触发:不应硬编码具体服务/产品名,保证泛化能力
    expect(content).not.toMatch(/MySQL|PostgreSQL|MongoDB|Redis|SQLite/i)
    expect(content).not.toMatch(/GitHub|Slack|Notion|Linear|Jira/i)
  })

  it('Layer 2 含 service-vs-shell heuristic,警告 `which X` 反模式', async () => {
    const result = await new SystemPlugin().build(makeCtx())
    const content = (result.messages[0] as { content: string }).content
    expect(content).toMatch(/Service-vs-shell heuristic/)
    // 反模式被明确点名
    expect(content).toMatch(/which X/)
    // 强调"missing local binary != 不可用"
    expect(content).toMatch(/missing local binary.*does NOT mean/i)
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
