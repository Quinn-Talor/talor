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
import { DEFAULT_TRACE_CONFIG, type ObservationRecord } from '@shared/types/trace'
import { traceRecorder } from '../observe/trace-recorder'
import { traceRepo } from '../repos/trace-repo'

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
  trace_id     TEXT,
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
        {
          agent_id: 'translator-001',
          instruction: 'translate this text',
          context: 'sales report summary',
        },
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
      const unblockers: Array<() => void> = []
      const blockingLoop: RunReactLoopFn = async (opts) => {
        await new Promise<void>((resolve) => {
          unblockers.push(resolve)
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

      // 已在执行的 10 个不受排队超时影响：解锁后正常拿到子 agent 结果
      for (const u of unblockers) u()
      const heldResults = await Promise.all(heldCalls)
      for (const r of heldResults) {
        expect(r.output).toBe('done')
      }
    })

    it('a running delegation that outlives queueTimeoutMs still returns its result', async () => {
      const agents = new Map([['translator-001', translator]])
      const slowLoop: RunReactLoopFn = async (opts) => {
        await new Promise((r) => setTimeout(r, 60))
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: 'slow but done' }],
          agent_id: opts.agent.id,
        })
      }
      const runtime = makeRuntime({
        runReactLoop: slowLoop,
        agents,
        config: { queueTimeoutMs: 20 },
      })
      tool = createDelegateAgentTool(runtime)
      const ctx = makeCtx({ sessionId: sessionRepo.list()[0].id })

      const r = await tool.execute({ agent_id: 'translator-001', instruction: 'x' }, ctx)
      expect(r.output).toBe('slow but done')
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

  describe('loop returns normally on abort / step exhaustion (real runReactLoop contract)', () => {
    // runReactLoop 吞掉 abort,落一条带 [step interrupted] 的半截文本后返回 exitReason='abort'
    function abortSwallowingLoop(partial: string): RunReactLoopFn {
      return async (opts) => {
        await new Promise<void>((resolve) => {
          opts.abortSignal.addEventListener('abort', () => resolve(), { once: true })
        })
        messageRepo.create({
          id: uuidv4(),
          session_id: opts.sessionId,
          role: 'assistant',
          content: [{ type: 'text', text: `${partial}\n\n[step interrupted]` }],
          agent_id: opts.agent.id,
        })
        return { exitReason: 'abort' }
      }
    }

    it('execution timeout → SUBAGENT_TIMEOUT, partial text is not reported as success', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: abortSwallowingLoop('half an answer'),
        agents,
        config: { executionTimeoutMs: 20 },
      })
      tool = createDelegateAgentTool(runtime)
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id }),
      )
      const env = result.output as ToolErrorEnvelope & { last_text?: string }
      expect(env.code).toBe('SUBAGENT_TIMEOUT')
      expect(env.last_text).toBe('half an answer')
    })

    it('parent stop → SUBAGENT_ABORTED', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({ runReactLoop: abortSwallowingLoop('partial'), agents })
      tool = createDelegateAgentTool(runtime)
      const controller = new AbortController()
      const promise = tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id, abortSignal: controller.signal }),
      )
      setTimeout(() => controller.abort(), 5)
      const env = (await promise).output as ToolErrorEnvelope
      expect(env.code).toBe('SUBAGENT_ABORTED')
    })

    it("exitReason='max_steps' → SUBAGENT_MAX_STEPS carrying the last text", async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: async (opts) => {
          messageRepo.create({
            id: uuidv4(),
            session_id: opts.sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: 'intermediate notes' }],
            agent_id: opts.agent.id,
          })
          return { exitReason: 'max_steps' }
        },
        agents,
      })
      tool = createDelegateAgentTool(runtime)
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id }),
      )
      const env = result.output as ToolErrorEnvelope & { last_text?: string }
      expect(env.code).toBe('SUBAGENT_MAX_STEPS')
      expect(env.last_text).toBe('intermediate notes')
    })

    it('[signature-dead-loop] summary is reported as SUBAGENT_RECOVERY', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: async (opts) => {
          messageRepo.create({
            id: uuidv4(),
            session_id: opts.sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: '[signature-dead-loop] stuck on the same call' }],
            agent_id: opts.agent.id,
          })
          return { exitReason: 'repeated_error' }
        },
        agents,
      })
      tool = createDelegateAgentTool(runtime)
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id }),
      )
      expect((result.output as ToolErrorEnvelope).code).toBe('SUBAGENT_RECOVERY')
    })

    it("normal completion with exitReason='no_tool_calls' still returns the text", async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: async (opts) => {
          messageRepo.create({
            id: uuidv4(),
            session_id: opts.sessionId,
            role: 'assistant',
            content: [{ type: 'text', text: 'final answer' }],
            agent_id: opts.agent.id,
          })
          return { exitReason: 'no_tool_calls' }
        },
        agents,
      })
      tool = createDelegateAgentTool(runtime)
      const result = await tool.execute(
        { agent_id: 'translator-001', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id }),
      )
      expect(result.output).toBe('final answer')
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
      const description = tool.description
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

      const description = tool.description
      expect(description).toContain('translator-001')
      expect(description).toContain('other-agent')
      expect(description).toContain('any registered business agent')
    })
  })

  // ─────────────────────────────────────────────────────────────────
  // V2 quality gates: A1 / A2 / A3 / B1 / B2 / C1
  // ─────────────────────────────────────────────────────────────────

  // v2.0 helper: build an Agent with a flat v2.0 AgentProfile
  function makeFullProfileAgent(opts: {
    id: string
    name: string
    description?: string
    agentPrompt?: string
    tools?: string[]
  }): Agent {
    const profile = {
      id: opts.id,
      name: opts.name,
      description: opts.description ?? '',
      agentPrompt: opts.agentPrompt ?? '',
      tools: opts.tools ?? [],
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

  describe('A1: v2.0 listing (name + description + first H2 section)', () => {
    function getDesc(agent: Agent): string {
      const agents = new Map([[agent.id, agent]])
      const runtime = makeRuntime({ runReactLoop: mockSuccessReactLoop('x'), agents })
      const tool = createDelegateAgentTool({ runtime, allowedAgentIds: null })
      return tool.description
    }

    it('renders name, id, description, and first H2 section when fully populated', () => {
      const agent = makeFullProfileAgent({
        id: 'stock-poet',
        name: '股票悲情诗人',
        description: '为指定股票写七言绝句。\n\n会做：查股价、写诗。\n不会做：实时报价获取。',
        agentPrompt: `## When invoked
Provide a stock ticker and mood. The agent fetches price data and composes a 七言绝句.

## Workflow
1. Read ticker input.
2. Write poem.

## Principles
- Always cite data sources.
`,
        tools: ['bash'],
      })
      const desc = getDesc(agent)
      expect(desc).toContain('### 股票悲情诗人 (id: stock-poet)')
      expect(desc).toContain('为指定股票写七言绝句')
      expect(desc).toContain('## When invoked')
      // Only first H2 section (not subsequent ones)
      expect(desc).not.toContain('## Workflow')
    })

    it('renders only name + description when agentPrompt has no H2 sections', () => {
      const agent = makeFullProfileAgent({
        id: 'a',
        name: 'Agent A',
        description: 'Does something useful.',
        agentPrompt: 'Just some prose without headers.',
      })
      const desc = getDesc(agent)
      expect(desc).toContain('### Agent A (id: a)')
      expect(desc).toContain('Does something useful.')
      // no H2 section from agentPrompt (note: '### ' headings are still present — check for line-start '## ')
      expect(desc).not.toMatch(/\n## /)
    })

    it('renders name + id even when profile is minimal (defensive)', () => {
      const agent = makeAgent('bare', 'Bare')
      const desc = getDesc(agent)
      expect(desc).toContain('### Bare (id: bare)')
      // 半 mock 场景: 不能崩溃,字段缺失就不渲染
    })

    describe('inline vs list adaptive rendering (legacy tests migrated to v2.0)', () => {
      it('inline for 1 item (description shown)', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          description: '只做一件事',
        })
        expect(getDesc(agent)).toContain('只做一件事')
      })

      it('description with multiple lines is shown', () => {
        const agent = makeFullProfileAgent({
          id: 'a',
          name: 'A',
          description: '会做：事 A。\n不会做：事 B。',
        })
        const desc = getDesc(agent)
        expect(desc).toContain('会做：事 A')
        expect(desc).toContain('不会做：事 B')
      })
    })

    it('never exposes raw tools / mcp / skills / cli / internet field labels', () => {
      const agent = makeFullProfileAgent({
        id: 'tool-heavy',
        name: 'Tool Heavy',
        description: 'Does many things.',
        tools: ['bash', 'edit', 'write'],
      })
      const desc = getDesc(agent)
      expect(desc).not.toContain('tools:')
      expect(desc).not.toContain('mcp:')
      expect(desc).not.toContain('skills:')
      expect(desc).not.toContain('cli:')
      expect(desc).not.toContain('internet:')
    })
  })

  // v3.7.2: A2 instruction-scope compatibility check 已删除 — 见 J-SHOULD-2 反模式

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
        { agent_id: 'translator-001', instruction: 'translate this text' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const r2 = await tool.execute(
        { agent_id: 'translator-001', instruction: 'translate this text' },
        makeCtx({ sessionId: parentSessions[0].id }),
      )
      const r3 = await tool.execute(
        { agent_id: 'translator-001', instruction: 'translate this text' },
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

  describe('A3: budget is scoped to the parent turn', () => {
    it('a new turn (different parentMessageId) gets a fresh budget', async () => {
      const agents = new Map([['translator-001', translator]])
      const runtime = makeRuntime({
        runReactLoop: mockSuccessReactLoop('ok'),
        agents,
        config: { maxInvocationsPerAgentPerSession: 1 },
      })
      tool = createDelegateAgentTool(runtime)
      const sid = sessionRepo.list()[0].id
      const call = (turn: string) =>
        tool.execute(
          { agent_id: 'translator-001', instruction: 'x' },
          makeCtx({ sessionId: sid, parentMessageId: turn }),
        )

      expect((await call('turn-1')).output).toBe('ok')
      expect(((await call('turn-1')).output as ToolErrorEnvelope).code).toBe(
        'DELEGATION_BUDGET_EXHAUSTED',
      )
      expect((await call('turn-2')).output).toBe('ok')
    })
  })

  describe('recursion guard', () => {
    it('rejects platform agents as delegation targets', async () => {
      const chatAgent = makeAgent('__chat__', 'Talor')
      const agents = new Map([['__chat__', chatAgent]])
      const loop = vi.fn(mockSuccessReactLoop('ok'))
      tool = createDelegateAgentTool(makeRuntime({ runReactLoop: loop, agents }))
      const r = await tool.execute(
        { agent_id: '__chat__', instruction: 'x' },
        makeCtx({ sessionId: sessionRepo.list()[0].id }),
      )
      expect((r.output as ToolErrorEnvelope).code).toBe('AGENT_NOT_FOUND')
      expect(loop).not.toHaveBeenCalled()
    })

    it('rejects delegating to an agent already in the chain (A → B → A)', async () => {
      const a = makeAgent('agent-a', 'A')
      const b = makeAgent('agent-b', 'B')
      const agents = new Map([
        ['agent-a', a],
        ['agent-b', b],
      ])
      const root = sessionRepo.list()[0]
      const childA = sessionRepo.create({
        title: 'A',
        provider_id: 'mock-provider',
        agent_id: 'agent-a',
        parent_session_id: root.id,
      })
      const childB = sessionRepo.create({
        title: 'B',
        provider_id: 'mock-provider',
        agent_id: 'agent-b',
        parent_session_id: childA.id,
      })
      const loop = vi.fn(mockSuccessReactLoop('ok'))
      tool = createDelegateAgentTool(makeRuntime({ runReactLoop: loop, agents }))

      const r = await tool.execute(
        { agent_id: 'agent-a', instruction: 'x' },
        makeCtx({ sessionId: childB.id }),
      )
      expect((r.output as ToolErrorEnvelope).code).toBe('DELEGATION_CYCLE')
      expect(loop).not.toHaveBeenCalled()
    })

    it('rejects delegation beyond the depth limit, allows it within', async () => {
      const ids = ['d1', 'd2', 'd3', 'd4']
      const agents = new Map(ids.map((id) => [id, makeAgent(id, id)] as const))
      let parentId = sessionRepo.list()[0].id
      const chain: string[] = []
      for (const id of ids.slice(0, 3)) {
        const s = sessionRepo.create({
          title: id,
          provider_id: 'mock-provider',
          agent_id: id,
          parent_session_id: parentId,
        })
        chain.push(s.id)
        parentId = s.id
      }
      tool = createDelegateAgentTool(
        makeRuntime({ runReactLoop: mockSuccessReactLoop('ok'), agents }),
      )

      // depth 2 (root → d1 → d2) 仍可委托
      const ok = await tool.execute(
        { agent_id: 'd4', instruction: 'x' },
        makeCtx({ sessionId: chain[1] }),
      )
      expect(ok.output).toBe('ok')
      // depth 3 (root → d1 → d2 → d3) 到达上限
      const r = await tool.execute(
        { agent_id: 'd4', instruction: 'x' },
        makeCtx({ sessionId: chain[2] }),
      )
      expect((r.output as ToolErrorEnvelope).code).toBe('DELEGATION_DEPTH_EXCEEDED')
    })
  })

  describe('listing reflects the current agent registry', () => {
    it('description is recomputed when agents are registered later', () => {
      const agents = new Map<string, Agent>()
      tool = createDelegateAgentTool(
        makeRuntime({ runReactLoop: mockSuccessReactLoop('ok'), agents }),
      )
      expect(tool.description).toContain('(no subagents available)')
      agents.set('translator-001', translator)
      expect(tool.description).toContain('translator-001')
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

  // v3.7.2: B2 entity binding 测试组删除 — 见 J-SHOULD-2 反模式

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

describe('delegate_agent — turn trace（turn-trace AC-016）', () => {
  let translator: Agent
  let rows: Map<string, ObservationRecord>

  beforeEach(() => {
    currentDb.instance = new Database(':memory:')
    currentDb.instance.exec(CREATE_SESSIONS_FULL)
    currentDb.instance.exec(CREATE_MESSAGES)
    translator = makeAgent('translator-001', '翻译助手')
    sessionRepo.create({ title: 'Main', provider_id: 'mock-provider', agent_id: '__coordinator__' })
    __TEST__.limiterPerSession.clear()
    rows = new Map()
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation((_trace, observations) => {
      for (const o of observations) rows.set(o.id, { ...o })
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    currentDb.instance?.close()
    currentDb.instance = null
  })

  async function delegateTraced(runReactLoop: RunReactLoopFn, withParent: boolean) {
    const tool = createDelegateAgentTool(
      makeRuntime({ runReactLoop, agents: new Map([['translator-001', translator]]) }),
    )
    const parentId = sessionRepo.list()[0].id
    const scope = traceRecorder.startTrace({
      id: 't-del',
      sessionId: parentId,
      name: 'turn',
      input: 'x',
      rootName: 'agent:coordinator',
      config: DEFAULT_TRACE_CONFIG,
    })!
    const toolObs = traceRecorder.startObservation({
      type: 'TOOL',
      name: 'delegate_agent',
      parent: scope.parent!,
    })
    const result = await tool.execute(
      { agent_id: 'translator-001', instruction: 'translate this' },
      makeCtx({ sessionId: parentId, traceParent: withParent ? toolObs.ref! : undefined }),
    )
    toolObs.end({ output: result.output })
    traceRecorder.endTrace('t-del', {})
    return { toolId: toolObs.ref!.observationId, result }
  }

  function childAgents(): ObservationRecord[] {
    return [...rows.values()].filter((o) => o.type === 'AGENT' && o.name === 'agent:translator-001')
  }

  it('AC-016: the child AGENT nests under the delegate TOOL; child messages carry the parent trace_id', async () => {
    const { toolId } = await delegateTraced(mockSuccessReactLoop('done (translated)'), true)

    const agents = childAgents()
    expect(agents).toHaveLength(1)
    const child = agents[0]
    expect(child.parent_observation_id).toBe(toolId)
    expect(child.trace_id).toBe('t-del')
    expect(child.output).toBe('done (translated)')
    expect(child.end_time).not.toBeNull()
    const childSessionId = child.metadata.child_session_id as string
    const childMsgs = messageRepo.listBySession(childSessionId)
    expect(childMsgs.length).toBeGreaterThan(0)
    expect(childMsgs.every((m) => m.trace_id === 't-del')).toBe(true)
  })

  it('AC-016（不触发）: without ctx.traceParent no child AGENT is recorded', async () => {
    await delegateTraced(mockSuccessReactLoop('done'), false)
    expect(childAgents()).toHaveLength(0)
  })

  it('a child loop that writes no text ends the child AGENT as WARNING / SUBAGENT_MAX_STEPS', async () => {
    await delegateTraced(async () => undefined, true)
    expect(childAgents()[0]).toMatchObject({
      level: 'WARNING',
      status_message: 'SUBAGENT_MAX_STEPS',
    })
  })

  it('a throwing child loop ends the child AGENT as ERROR with the envelope code', async () => {
    const { result } = await delegateTraced(async () => {
      throw new Error('child blew up')
    }, true)
    const code = (result.output as ToolErrorEnvelope).code
    expect(childAgents()[0]).toMatchObject({ level: 'ERROR', status_message: code })
  })
})
