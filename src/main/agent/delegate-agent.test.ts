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
})
