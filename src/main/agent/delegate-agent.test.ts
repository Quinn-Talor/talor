import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))

import { createDelegateAgentTool, clearLimiter, __TEST__ } from './delegate-agent'
import type { DelegationConfig, DelegationRuntime, RunReactLoopFn } from './delegate-agent'
import { messageRepo, sessionRepo } from '../repos/session-repo'
import type { AgentManager } from './agent-manager'
import type { Agent } from './agent'
import type { ToolDefinition, ToolExecuteContext, ToolErrorEnvelope } from '../tools/types'
import type { ReactLoopOptions } from '../loop/types'
import { v4 as uuidv4 } from 'uuid'

const CREATE_SESSIONS_FULL = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('running', 'completed', 'aborted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const CREATE_MESSAGES = `
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'blocks',
  agent_id     TEXT NOT NULL DEFAULT '__chat__',
  created_at   TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`

function makeAgent(id: string, name: string): Agent {
  return {
    id,
    name,
    profile: { id, name } as Agent['profile'],
    source: null,
    toolRegistry: {} as Agent['toolRegistry'],
    mcpRegistry: null,
    skillRegistry: {} as Agent['skillRegistry'],
    skillsDir: null,
    knowledgeDir: null,
  } as unknown as Agent
}

function makeAgentManager(agents: Map<string, Agent>): AgentManager {
  return {
    getAgent: (id: string) => agents.get(id) ?? null,
    listBusinessAgentIds: () => Array.from(agents.keys()),
  } as unknown as AgentManager
}

function makeRuntime(opts: {
  runReactLoop: RunReactLoopFn
  agents: Map<string, Agent>
  config?: Partial<DelegationConfig>
}): DelegationRuntime {
  return {
    agentManager: makeAgentManager(opts.agents),
    runReactLoop: opts.runReactLoop,
    sessionRepo: sessionRepo as unknown as DelegationRuntime['sessionRepo'],
    pipeline: {} as DelegationRuntime['pipeline'],
    config: {
      maxConcurrencyPerSession: 10,
      queueTimeoutMs: 5_000,
      executionTimeoutMs: 10_000,
      maxInvocationsPerAgentPerSession: 100, // 测试默认大值,避免 budget 干扰其他用例
      ...opts.config,
    },
    providerContextProvider: () =>
      ({
        model: { modelId: 'mock-model' },
        provider: { id: 'mock-provider', name: 'mock', type: 'openai' },
        providerConfig: {},
        streamOptions: undefined,
      }) as ReturnType<DelegationRuntime['providerContextProvider']>,
  } as DelegationRuntime
}

function makeCtx(opts: Partial<ToolExecuteContext> & { sessionId: string }): ToolExecuteContext {
  return {
    workspace: '/tmp/ws',
    parentMessageId: 'parent-msg-1',
    ...opts,
  }
}

/** mock runReactLoop helper: 写入 N 条 assistant text 到子 session 模拟成功结束 */
function mockSuccessReactLoop(textForChild: string): RunReactLoopFn {
  return async (opts: ReactLoopOptions) => {
    messageRepo.create({
      id: uuidv4(),
      session_id: opts.sessionId,
      role: 'assistant',
      content: [{ type: 'text', text: textForChild }],
      agent_id: opts.agent.id,
    })
  }
}

describe('delegate_agent (TASK-3)', () => {
  let translator: Agent
  let tool: ToolDefinition

  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_SESSIONS_FULL)
    currentDb.instance.exec(CREATE_MESSAGES)
    translator = makeAgent('translator-001', '翻译助手')

    // 主 session 必须先存在（外键约束）
    sessionRepo.create({
      title: 'Main',
      provider_id: 'mock-provider',
      agent_id: '__coordinator__',
    })
    // clear limiter map between tests
    __TEST__.limiterPerSession.clear()
  })

  afterEach(() => {
    currentDb.instance?.close()
    currentDb.instance = null
  })

  describe('AC-001: basic delegation flow', () => {
    it('returns subagent final assistant text as tool_result.output', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('Hello (translated)'),
        agents,
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: '翻成英文', context: '销售报告摘要' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(result.output).toBe('Hello (translated)')
    })
  })

  describe('AC-007: AGENT_NOT_FOUND', () => {
    it('returns envelope with code AGENT_NOT_FOUND when agent_id unknown', async () => {
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('never called'),
        agents: new Map(),
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'nonexistent', instruction: 'do x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('AGENT_NOT_FOUND')
    })

    it('does not create a child session when agent_id unknown', async () => {
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('never called'),
        agents: new Map(),
      })
      tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const beforeCount = sessionRepo.list().length

      await tool.execute(
        { agent_id: 'nonexistent', instruction: 'do x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(sessionRepo.list().length).toBe(beforeCount)
    })
  })

  describe('AC-009: SUBAGENT_FAILED catches exceptions (preserves §I-MUST-1)', () => {
    it('catches errors thrown by runReactLoop and returns envelope', async () => {
      const failingLoop: RunReactLoopFn = async () => {
        throw new Error('boom')
      }
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({ runReactLoop: failingLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_FAILED')
    })

    it('marks child session status=aborted on failure', async () => {
      const failingLoop: RunReactLoopFn = async () => {
        throw new Error('boom')
      }
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({ runReactLoop: failingLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const allSessions = sessionRepo.list()
      const child = allSessions.find((s) => s.parent_session_id === parentSessions[0].id)
      expect(child?.status).toBe('aborted')
    })
  })

  describe('AC-010: SUBAGENT_MAX_STEPS when child produced no text', () => {
    it('returns envelope with truncated=true when child has no assistant text', async () => {
      const agents = new Map([['translator-001', translator]])
      const noTextLoop: RunReactLoopFn = async () => {
        // run loop but write zero messages — simulates max_steps reached without text
      }
      const runtime = makeRuntime({ runReactLoop: noTextLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope & { truncated?: boolean }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_MAX_STEPS')
      expect(env.truncated).toBe(true)
    })
  })

  describe('AC-011: strict isolation (no parent history visible to subagent)', () => {
    it('passes only instruction (when no context) as userContent to child loop', async () => {
      const agents = new Map([['translator-001', translator]])
      let capturedUserContent = ''
      const captureLoop: RunReactLoopFn = async (opts) => {
        capturedUserContent = opts.userContent
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: captureLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      await tool.execute(
        { agent_id: 'translator-001', instruction: '翻译 Hello' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(capturedUserContent).toBe('翻译 Hello')
    })

    it('concatenates context + instruction when context provided', async () => {
      const agents = new Map([['translator-001', translator]])
      let capturedUserContent = ''
      const captureLoop: RunReactLoopFn = async (opts) => {
        capturedUserContent = opts.userContent
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: captureLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      await tool.execute(
        { agent_id: 'translator-001', instruction: '翻译', context: '销售报告' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(capturedUserContent).toBe('销售报告\n\n翻译')
    })
  })

  describe('AC-002: parallel delegation with K=10 (within limit)', () => {
    it('runs 10 concurrent delegations to completion', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('done'),
        agents,
        config: { maxConcurrencyPerSession: 10 },
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const ctx = makeCtx({ sessionId: parentSessions[0].id })

      const calls = Array.from({ length: 10 }, () =>
        tool.execute({ agent_id: 'translator-001', instruction: 'x' }, ctx),
      )
      const results = await Promise.all(calls)

      for (const r of results) {
        expect(r.output).toBe('done')
      }
    })
  })

  describe('AC-003: DELEGATION_QUEUE_TIMEOUT', () => {
    it('11th delegation times out when queue is held by long-running 10', async () => {
      const agents = new Map([['translator-001', translator]])
      // 让第一批 10 个长时间不完成，模拟队列阻塞
      let unblock: (() => void) | undefined
      const blockingLoop: RunReactLoopFn = async (opts) => {
        await new Promise<void>((resolve) => {
          unblock = resolve
        })
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          agent_id: opts.agent.id,
        })
      }

      const runtime = makeRuntime({
        runReactLoop: blockingLoop,
        agents,
        config: { maxConcurrencyPerSession: 10, queueTimeoutMs: 30 },
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const ctx = makeCtx({ sessionId: parentSessions[0].id })

      // 启动 10 个让 limiter 满
      const heldCalls = Array.from({ length: 10 }, () =>
        tool.execute({ agent_id: 'translator-001', instruction: 'x' }, ctx),
      )
      // 第 11 个排队，30ms 后队列超时
      const eleventh = await tool.execute({ agent_id: 'translator-001', instruction: 'x' }, ctx)

      const env = eleventh.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('DELEGATION_QUEUE_TIMEOUT')

      // 解锁前 10 个让 promise 不悬挂
      unblock?.()
      await Promise.all(heldCalls)
    })
  })

  describe('AC-006: parent abort propagates to subagent', () => {
    it('returns SUBAGENT_ABORTED when parent abortSignal triggers', async () => {
      const agents = new Map([['translator-001', translator]])
      const respondsToAbort: RunReactLoopFn = async (opts) => {
        await new Promise<void>((_resolve, reject) => {
          opts.abortSignal.addEventListener(
            'abort',
            () =>
              reject(Object.assign(new Error('aborted: parent_aborted'), { name: 'AbortError' })),
            { once: true },
          )
        })
      }
      const runtime = makeRuntime({ runReactLoop: respondsToAbort, agents })
      tool = createDelegateAgentTool(runtime)

      const controller = new AbortController()
      const parentSessions = sessionRepo.list()
      const promise = tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id, abortSignal: controller.signal }),
      )

      // 立即触发父 abort
      setTimeout(() => controller.abort(), 5)

      const result = await promise
      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_ABORTED')
    })
  })

  describe('AC-005: SUBAGENT_TIMEOUT (executionTimeoutMs)', () => {
    it('aborts child loop and returns SUBAGENT_TIMEOUT after executionTimeoutMs', async () => {
      const agents = new Map([['translator-001', translator]])
      const slowLoop: RunReactLoopFn = async (opts) => {
        await new Promise<void>((_resolve, reject) => {
          opts.abortSignal.addEventListener(
            'abort',
            () =>
              reject(
                Object.assign(new Error('aborted: execution_timeout'), { name: 'AbortError' }),
              ),
            { once: true },
          )
        })
      }
      const runtime = makeRuntime({
        runReactLoop: slowLoop,
        agents,
        config: { executionTimeoutMs: 30 },
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_TIMEOUT')
    })
  })

  describe('AC-008: SUBAGENT_MCP_INIT_FAILED', () => {
    it('classifies MCP-related init errors as SUBAGENT_MCP_INIT_FAILED', async () => {
      const agents = new Map([['translator-001', translator]])
      const mcpFailingLoop: RunReactLoopFn = async () => {
        throw new Error('MCP server "fs" failed to init: connection refused')
      }
      const runtime = makeRuntime({ runReactLoop: mcpFailingLoop, agents })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_MCP_INIT_FAILED')
    })
  })

  describe('clearLimiter (lifecycle hook)', () => {
    it('removes limiter for given sessionId', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('done'),
        agents,
      })
      tool = createDelegateAgentTool(runtime)

      const parentSessions = sessionRepo.list()
      await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(__TEST__.limiterPerSession.has(parentSessions[0].id)).toBe(true)
      clearLimiter(parentSessions[0].id)
      expect(__TEST__.limiterPerSession.has(parentSessions[0].id)).toBe(false)
    })
  })

  describe('tool metadata', () => {
    it('exposes correct name + riskLevel + zodSchema', () => {
      const runtime = makeRuntime({ runReactLoop: mockSuccessReactLoop('x'), agents: new Map() })
      tool = createDelegateAgentTool(runtime)
      expect(tool.name).toBe('delegate_agent')
      expect(tool.riskLevel).toBe('LOW')
      expect(tool.zodSchema).toBeDefined()
    })
  })

  describe('TASK-2 scope (AC-022, AC-024)', () => {
    it('AC-022: empty scope ([]) — listing 段为空，execute 任何 agent_id 都返 AGENT_NOT_FOUND', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('done'),
        agents,
      })
      // 空 scope（无可委托目标）
      tool = createDelegateAgentTool({ runtime, allowedAgentIds: [] })

      // description 应包含 "no subagents available"
      const description =
        typeof tool.description === 'function' ? tool.description() : tool.description
      expect(description).toContain('no subagents available')

      // 即使 agent 真实存在，execute 也因 scope=[] 拒绝
      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('AGENT_NOT_FOUND')
      expect(env.hint).toMatch(/no subagent dependencies declared/)
    })

    it('AC-024 (trigger): scope=["A"]，调用 agent_id="B" 返 AGENT_NOT_FOUND with hint Allowed: A', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('done'),
        agents,
      })
      tool = createDelegateAgentTool({ runtime, allowedAgentIds: ['translator-001'] })

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'someone-else', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      const env = result.output as ToolErrorEnvelope
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('AGENT_NOT_FOUND')
      expect(env.hint).toContain('Allowed: translator-001')
    })

    it('AC-024 (no-trigger): scope=["A"]，调用 agent_id="A" 进入 runDelegation', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('translated text'),
        agents,
      })
      tool = createDelegateAgentTool({ runtime, allowedAgentIds: ['translator-001'] })

      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(result.output).toBe('translated text')
    })

    it('全开放 scope (null) — description listing 含全部业务 agent', () => {
      const otherAgent = makeAgent('other-agent', 'Other Agent')
      const agents = new Map([
        ['translator-001', translator],
        ['other-agent', otherAgent],
      ])
      // 关键：让 makeRuntime 的 agentManager listBusinessAgentIds 真返回这俩
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('done'),
        agents,
      })
      // 给 agentManager 注入 listBusinessAgentIds
      ;(
        runtime.agentManager as unknown as { listBusinessAgentIds: () => string[] }
      ).listBusinessAgentIds = () => ['translator-001', 'other-agent']

      tool = createDelegateAgentTool({ runtime, allowedAgentIds: null })

      const description =
        typeof tool.description === 'function' ? tool.description() : tool.description
      expect(description).toContain('translator-001')
      expect(description).toContain('other-agent')
      expect(description).toContain('any registered business agent')
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // V2 quality gates: A1 / A2 / A3 / B1 / B2 / C1
  // ─────────────────────────────────────────────────────────────────

  function makeFullProfileAgent(opts: {
    id: string
    name: string
    description?: string
    tools?: Array<{ name: string; disabled?: boolean }>
    mcpServers?: string[]
    scope?: { in?: string[]; out?: string[] }
    objective?: string
    outcomes?: Array<{ id?: string; description: string; priority?: 'core' | 'auxiliary' }>
    capabilities?: string[]
    inputs?: Array<{
      id: string
      type: string
      required: boolean
      description: string
      examples?: string[]
    }>
    deliverables?: Array<{ id: string; format: string; trigger?: string }>
  }): Agent {
    const profile = {
      schemaVersion: '1.0',
      identity: {
        id: opts.id,
        name: opts.name,
        description: opts.description ?? '',
        version: '1.0.0',
      },
      mission: {
        objective: opts.objective ?? '',
        outcomes: (opts.outcomes ?? []).map((o, i) => ({
          id: o.id ?? `o${i}`,
          description: o.description,
          priority: o.priority,
          verifyBy: [],
        })),
        scope: opts.scope,
        inputs: opts.inputs,
      },
      method: {
        capabilities: opts.capabilities ?? [],
        tools: opts.tools ?? [],
        mcpServers: (opts.mcpServers ?? []).map((name) => ({
          name,
          transport: { type: 'stdio', command: 'noop' },
          tools: [],
          required: false,
        })),
        skills: [],
      },
      delivery: { deliverables: opts.deliverables ?? [] },
      execution: {
        limits: { maxSteps: 50, maxTokens: 1000 },
        retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
      },
    } as unknown as Agent['profile']
    return {
      id: opts.id,
      name: opts.name,
      profile,
      source: null,
      toolRegistry: {} as Agent['toolRegistry'],
      mcpRegistry: null,
      skillRegistry: {} as Agent['skillRegistry'],
      skillsDir: null,
      knowledgeDir: null,
    } as unknown as Agent
  }

  describe("A1: contract-skeleton listing (does/won't/needs/returns)", () => {
    function getDesc(agent: Agent): string {
      const agents = new Map([[agent.id, agent]])
      const runtime = makeRuntime({ runReactLoop: mockSuccessReactLoop('x'), agents })
      const tool = createDelegateAgentTool({ runtime, allowedAgentIds: null })
      return typeof tool.description === 'function' ? tool.description() : tool.description
    }

    it('renders all four contract fields when fully populated', () => {
      const agent = makeFullProfileAgent({
        id: 'stock-poet',
        name: '股票悲情诗人',
        description: 'should not appear (scope.in present)',
        objective: 'should not appear (scope.in present)',
        outcomes: [{ id: 'poem_done', description: '用户收到完整诗作', priority: 'core' }],
        inputs: [
          {
            id: 'ticker',
            type: 'text',
            required: true,
            description: '股票代码',
            examples: ['BIDU'],
          },
          { id: 'mood', type: 'text', required: false, description: '情绪基调' },
        ],
        scope: {
          in: ['为指定股票写七言绝句', '按情绪基调调整风格'],
          out: ['实时报价获取'],
        },
        deliverables: [{ id: 'poem', format: 'markdown' }],
        capabilities: ['should not appear (scope.in present)'],
        tools: [{ name: 'bash' }],
      })
      const desc = getDesc(agent)
      expect(desc).toContain('- stock-poet — 股票悲情诗人')
      // does = scope.in inline (2 短项 → ` / ` 分隔)
      expect(desc).toContain('does: 为指定股票写七言绝句 / 按情绪基调调整风格')
      // won't inline 单条
      expect(desc).toContain("won't: 实时报价获取")
      // needs inline 单条 required（mood optional 不渲染）
      expect(desc).toContain('needs: ticker (text) — 股票代码')
      expect(desc).not.toContain('mood')
      // returns inline 单条
      expect(desc).toContain('returns: poem (markdown)')
      // 永不渲染字段
      expect(desc).not.toContain('description:')
      expect(desc).not.toContain('objective:')
      expect(desc).not.toContain('outcomes:')
      expect(desc).not.toContain('capabilities:')
      expect(desc).not.toContain('examples:')
      expect(desc).not.toContain('tools:')
      expect(desc).not.toContain('internet:')
    })

    describe('does: fallback chain', () => {
      it('falls back to capabilities when scope.in missing', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          objective: 'should not appear',
          capabilities: ['cap-a', 'cap-b'],
        })
        const desc = getDesc(agent)
        expect(desc).toContain('does: cap-a / cap-b')
        expect(desc).not.toContain('objective')
      })

      it('falls back to objective when scope.in & capabilities missing', () => {
        const agent = makeFullProfileAgent({
          id: 'b',
          name: 'B',
          objective: 'do something useful',
          capabilities: [],
        })
        const desc = getDesc(agent)
        expect(desc).toContain('does: do something useful')
      })

      it('falls back to description when only description present', () => {
        const agent = makeFullProfileAgent({
          id: 'c',
          name: 'C',
          description: 'just a description',
          capabilities: [],
        })
        const desc = getDesc(agent)
        expect(desc).toContain('does: just a description')
      })

      it('renders only `- id — name` when nothing available (defensive)', () => {
        const agent = makeAgent('bare', 'Bare')
        const desc = getDesc(agent)
        expect(desc).toContain('- bare — Bare')
        // 半 mock 场景: 不能崩溃,字段缺失就不渲染
      })
    })

    describe('inline vs list adaptive rendering', () => {
      it('inline for 1 item', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['只做一件事'], out: [] },
        })
        expect(getDesc(agent)).toContain('does: 只做一件事')
      })

      it('inline with " / " for 2-3 short items', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['事 A', '事 B', '事 C'], out: [] },
        })
        expect(getDesc(agent)).toContain('does: 事 A / 事 B / 事 C')
      })

      it('expands to list for 4+ items', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['一', '二', '三', '四'], out: [] },
        })
        const desc = getDesc(agent)
        expect(desc).toContain('does:\n      - 一\n      - 二\n      - 三\n      - 四')
      })

      it('expands to list when any item is long (>30 chars)', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: {
            in: [
              '短的',
              'this item is intentionally longer than thirty characters to force list expansion',
            ],
            out: [],
          },
        })
        const desc = getDesc(agent)
        expect(desc).toMatch(/does:\n {6}- 短的/)
      })
    })

    describe("won't / needs / returns: skip empty", () => {
      it("omits won't when scope.out empty", () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
        })
        expect(getDesc(agent)).not.toContain("won't")
      })

      it('omits needs when no required inputs', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
          inputs: [{ id: 'opt', type: 'text', required: false, description: '可选' }],
        })
        expect(getDesc(agent)).not.toContain('needs')
      })

      it('omits returns when no deliverables', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
          deliverables: [],
        })
        // 用 'returns:' (含冒号) 匹配字段而非 prologue 文案中的 "returns" 单词
        expect(getDesc(agent)).not.toContain('returns:')
      })

      it('expands needs to list for multiple required inputs', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
          inputs: [
            { id: 'i1', type: 'text', required: true, description: 'first input description here' },
            {
              id: 'i2',
              type: 'text',
              required: true,
              description: 'second input description here',
            },
          ],
        })
        const desc = getDesc(agent)
        expect(desc).toMatch(/needs:\n {6}- i1 \(text\) —/)
        expect(desc).toMatch(/ {6}- i2 \(text\) —/)
      })

      it('returns inline for 1 deliverable', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
          deliverables: [{ id: 'report', format: 'markdown' }],
        })
        expect(getDesc(agent)).toContain('returns: report (markdown)')
      })

      it('returns inline " / " for 2 deliverables when short', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          scope: { in: ['x'], out: [] },
          deliverables: [
            { id: 'a', format: 'markdown' },
            { id: 'b', format: 'json' },
          ],
        })
        expect(getDesc(agent)).toContain('returns: a (markdown) / b (json)')
      })
    })

    it('never exposes tooling fields (tools / mcp / skills / cli / internet)', () => {
      const agent = makeFullProfileAgent({
        id: 'tool-heavy',
        name: 'Tool Heavy',
        scope: { in: ['x'], out: [] },
        tools: [{ name: 'bash' }, { name: 'edit' }, { name: 'write' }],
        mcpServers: ['playwright', 'mysql'],
      })
      const desc = getDesc(agent)
      expect(desc).not.toContain('tools:')
      expect(desc).not.toContain('mcp:')
      expect(desc).not.toContain('skills:')
      expect(desc).not.toContain('cli:')
      expect(desc).not.toContain('internet:')
    })
  })

  describe('A2: instruction-scope compatibility check', () => {
    it('rejects when profile entities and instruction entities have no overlap', async () => {
      const agent = makeFullProfileAgent({
        id: 'stock-poet-zj',
        name: '中际旭创悲情诗',
        description: '为中际旭创写七言绝句',
        tools: [{ name: 'bash' }],
        outcomes: [{ description: '为中际旭创等股票写诗' }],
      })
      const agents = new Map([['stock-poet-zj', agent]])
      const runtime = makeRuntime({ runReactLoop: mockSuccessReactLoop('hello'), agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'stock-poet-zj', instruction: '搜索百度股价并写诗' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const env = result.output as ToolErrorEnvelope & { instruction_entities?: string[] }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('INSTRUCTION_OUT_OF_SCOPE')
      // specificity filter: instruction_entities 仅含 ≥3 字中文等高置信集合
      expect(env.instruction_entities!.some((e: string) => e.includes('百度'))).toBe(true)
    })

    it('passes when instruction entity exists in profile text', async () => {
      const agent = makeFullProfileAgent({
        id: 'stock-poet-baidu',
        name: '百度悲情诗',
        description: '为百度等中国互联网股票写七言绝句',
        tools: [{ name: 'bash' }],
      })
      const agents = new Map([['stock-poet-baidu', agent]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('百度股价低迷'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'stock-poet-baidu', instruction: '搜索百度股价并写诗' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      // 应进入正常委托流程并返回子文本
      expect(result.output).toBe('百度股价低迷')
    })

    it('passes when profile has only low-confidence fragments (generic poetry agent vs specific stock)', async () => {
      // 缺环 2 specificity filter: profile "为A股写诗" 抽取出的 "股写"
      // 等碎片不算高置信; instruction "为TSLA写诗" 含 specific TSLA 但 profile
      // 无 specific → 视 profile 为通用 → PASS, 不能因 entity 噪声误拒。
      const agent = makeFullProfileAgent({
        id: 'generic-poet',
        name: '诗人',
        description: '为A股写诗',
        tools: [{ name: 'read' }],
        outcomes: [{ description: '产出七言绝句' }],
      })
      const agents = new Map([['generic-poet', agent]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('TSLA 股价飘摇'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'generic-poet', instruction: '为TSLA写七言绝句' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(r.output).toBe('TSLA 股价飘摇')
    })

    it('passes when no specific entities in either side (generic agent)', async () => {
      const agent = makeFullProfileAgent({
        id: 'general-helper',
        name: 'General Helper',
        description: 'Help with any task',
        tools: [{ name: 'bash' }],
      })
      const agents = new Map([['general-helper', agent]])
      const runtime = makeRuntime({ runReactLoop: mockSuccessReactLoop('done'), agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const result = await tool.execute(
        { agent_id: 'general-helper', instruction: 'do something' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(result.output).toBe('done')
    })
  })

  describe('A3: per-agent delegation budget', () => {
    it('returns DELEGATION_BUDGET_EXHAUSTED on (max+1)th invocation', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('Hello (translated)'),
        agents,
        config: { maxInvocationsPerAgentPerSession: 2 },
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()

      const r1 = await tool.execute(
        { agent_id: 'translator-001', instruction: '翻成英文' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const r2 = await tool.execute(
        { agent_id: 'translator-001', instruction: '翻成英文' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const r3 = await tool.execute(
        { agent_id: 'translator-001', instruction: '翻成英文' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(r1.output).toBe('Hello (translated)')
      expect(r2.output).toBe('Hello (translated)')
      const env = r3.output as ToolErrorEnvelope & {
        invocations_used?: number
        budget_max?: number
      }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('DELEGATION_BUDGET_EXHAUSTED')
      expect(env.budget_max).toBe(2)
    })

    it('budget is per-agent (different agent_id has own counter)', async () => {
      const a = makeAgent('agent-a', 'A')
      const b = makeAgent('agent-b', 'B')
      const agents = new Map([
        ['agent-a', a],
        ['agent-b', b],
      ])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('ok'),
        agents,
        config: { maxInvocationsPerAgentPerSession: 1 },
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      // 各自第 1 次 → 都成功
      expect(
        (
          await tool.execute(
            { agent_id: 'agent-a', instruction: 'x' },
            makeCtx({ sessionId: parentSessions[0].id }),
          )
        ).output,
      ).toBe('ok')
      expect(
        (
          await tool.execute(
            { agent_id: 'agent-b', instruction: 'x' },
            makeCtx({ sessionId: parentSessions[0].id }),
          )
        ).output,
      ).toBe('ok')
      // a 第 2 次 → exhausted
      const r = await tool.execute(
        { agent_id: 'agent-a', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect((r.output as ToolErrorEnvelope).code).toBe('DELEGATION_BUDGET_EXHAUSTED')
    })
  })

  describe('B1: auto parent-context injection', () => {
    it('prepends parent recent user message to child userContent', async () => {
      const agents = new Map([['translator-001', translator]])
      let capturedUserContent = ''
      const captureLoop: RunReactLoopFn = async (opts) => {
        capturedUserContent = opts.userContent
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: captureLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      // 父 session 写一条 user message,模拟真实场景
      messageRepo.create({
        id: uuidv4(),
        session_id: parentSessions[0].id,
        role: 'user',
        content: [{ type: 'text', text: '请帮我搜索百度股价' }],
        agent_id: '__chat__',
      })

      await tool.execute(
        { agent_id: 'translator-001', instruction: '翻译这段' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(capturedUserContent).toContain('<parent-context auto-injected>')
      expect(capturedUserContent).toContain('请帮我搜索百度股价')
      expect(capturedUserContent).toContain('翻译这段')
    })

    it('includes recent tool failures', async () => {
      const agents = new Map([['translator-001', translator]])
      let capturedUserContent = ''
      const captureLoop: RunReactLoopFn = async (opts) => {
        capturedUserContent = opts.userContent
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: captureLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      // 父 session 含失败的 tool result
      messageRepo.create({
        id: uuidv4(),
        session_id: parentSessions[0].id,
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc1',
            toolName: 'browse',
            output: { type: 'text', value: 'ENOENT: tool not installed' },
            isError: true,
          },
        ],
        agent_id: '__chat__',
      })

      await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )

      expect(capturedUserContent).toContain('recent-tool-failures')
      expect(capturedUserContent).toContain('browse')
      expect(capturedUserContent).toContain('ENOENT')
    })

    it('emits empty auto-context when parent has no relevant messages', async () => {
      const agents = new Map([['translator-001', translator]])
      let capturedUserContent = ''
      const captureLoop: RunReactLoopFn = async (opts) => {
        capturedUserContent = opts.userContent
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: captureLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      await tool.execute(
        { agent_id: 'translator-001', instruction: 'standalone' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      // 没父 user message / tool error → autoCtx 为空
      expect(capturedUserContent).toBe('standalone')
    })
  })

  describe('B2: entity binding (subagent must mention instruction entity)', () => {
    it('returns SUBAGENT_OFF_TARGET when output drifted to unrelated entity', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('为中际旭创写一首悲情绝句'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: '为百度股票写诗' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const env = r.output as ToolErrorEnvelope & { expected_entities?: string[] }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_OFF_TARGET')
      expect(env.expected_entities).toEqual(
        expect.arrayContaining([expect.stringContaining('百度')]),
      )
    })

    it('passes when output mentions instruction entity', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('百度股价飘摇,无人问津'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: '为百度写七言绝句' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(r.output).toBe('百度股价飘摇,无人问津')
    })

    it('does not flag when output is in different language (translation case)', async () => {
      // instruction 中文,output 纯英文 → 跳过 cn-name 检查
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('Hello world from English text'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: '翻成英文' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(r.output).toBe('Hello world from English text')
    })

    it('flags when ticker entity not in output', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('Tencent had a great quarter'),
        agents,
      })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: 'Search BIDU stock price' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const env = r.output as ToolErrorEnvelope & { expected_entities?: string[] }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_OFF_TARGET')
      expect(env.expected_entities).toContain('BIDU')
    })
  })

  describe('C1: failure-recovery → ToolErrorEnvelope', () => {
    it('converts [failure-recovery] text to SUBAGENT_RECOVERY envelope', async () => {
      const agents = new Map([['translator-001', translator]])
      const recoveryLoop: RunReactLoopFn = async (opts) => {
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '[failure-recovery • 1 unverifiable quote masked]\nI was unable to complete the task because curl returned 404. Please advise.',
            },
          ],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: recoveryLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: 'standalone' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const env = r.output as ToolErrorEnvelope & { last_text?: string; child_session_id?: string }
      expect(env.__talor_error).toBe(true)
      expect(env.code).toBe('SUBAGENT_RECOVERY')
      expect(env.last_text).toContain('curl returned 404')
      expect(env.child_session_id).toBeDefined()
    })

    it('also flags [auto-summary] marker', async () => {
      const agents = new Map([['translator-001', translator]])
      const recoveryLoop: RunReactLoopFn = async (opts) => {
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: '[auto-summary]\nNothing to report.' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: recoveryLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: 'standalone' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect((r.output as ToolErrorEnvelope).code).toBe('SUBAGENT_RECOVERY')
    })

    it('does not flag normal output starting with bracketed but non-recovery text', async () => {
      const agents = new Map([['translator-001', translator]])
      const normalLoop: RunReactLoopFn = async (opts) => {
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: '[Note] standalone task completed.' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({ runReactLoop: normalLoop, agents })
      const tool = createDelegateAgentTool(runtime)
      const parentSessions = sessionRepo.list()
      const r = await tool.execute(
        { agent_id: 'translator-001', instruction: 'standalone' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      expect(r.output).toContain('standalone task completed')
    })
  })
})
