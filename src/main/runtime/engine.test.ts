import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))
vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: () => undefined }) },
}))

import {
  createEngine,
  createMcpHost,
  defineTask,
  memoryArchive,
  modelHub,
  type McpConnect,
  type Approver,
  type RunEvent,
  type McpHost,
} from 'agent-engine'
import { checkInvariants } from 'agent-engine/sdk'
import { fakeMcpServer, fakeModel, type FakeReply } from 'agent-engine/testing'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import { agentFor } from './agents'
import { createSessionApprover, registerApprovalPort } from './approval'
import type { MCPServer } from '../repos/mcp-server-repo'
import { catalogSnapshot } from './catalog'
import {
  APPROVAL_TIMEOUT_MS,
  childTimeoutOf,
  createRuntime,
  delegationCapsOf,
  interactiveEnvironment,
  preconnectSpecs,
  shutdownRuntime,
  buildRuntime,
  getRuntime,
  RUNTIME_RETRY_MS,
  runtimeCreated,
  type Runtime,
} from './engine'
import { ENGINE_NOTICE } from './notice'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'talor-runtime-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

async function runWith(
  replies: FakeReply[],
  approved: boolean,
  opts: {
    caps?: Parameters<typeof createRuntime>[0]['caps']
    hang?: boolean
    approver?: Approver
  } = {},
) {
  const model = fakeModel({ replies, repeatLast: true })
  const archive = memoryArchive()
  const approve = vi.fn<Approver['approve']>()
  if (opts.hang) approve.mockReturnValue(new Promise(() => {}))
  else approve.mockResolvedValue({ approved })
  const runtime = createRuntime({
    models: modelHub({ providers: [model], default: model.ref }),
    archive,
    approver: opts.approver ?? { approve },
    ...(opts.caps ? { caps: opts.caps } : {}),
  })
  const snapshot = catalogSnapshot({
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => [],
    skills: () => [],
    agents: () => [],
  })
  const agent = agentFor(
    { id: '__chat__', name: 'Talor', description: '', agentPrompt: 'Help.' },
    snapshot,
  )
  const task = defineTask({
    input: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
    scope: { workspace },
    subject: 's1',
  })
  const result = await runtime.interactive.start(agent, task).result
  const events: RunEvent[] = []
  for await (const event of archive.read(result.runId)) events.push(event)
  const finished = events.filter((e) => e.t === 'tool_finished')
  return { result, events, finished, approve, model, archive }
}

const writeA = { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] }

describe('createRuntime', () => {
  it('AC-011 writes after the approver agrees', async () => {
    const { result, events, approve } = await runWith([writeA, { text: 'done' }], true)

    expect(result.status).toBe('completed')
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve.mock.calls[0]![0]).toMatchObject({ toolName: 'write', risk: 'high' })
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hi')
    expect(checkInvariants(events, { complete: true })).toEqual([])
  })

  it('AC-011 does not write when the approver refuses', async () => {
    const { finished, events } = await runWith([writeA, { text: 'ok' }], false)

    expect(existsSync(join(workspace, 'a.txt'))).toBe(false)
    expect(finished[0]).toMatchObject({ isError: true, errorCode: 'USER_DENIED' })
    expect(checkInvariants(events, { complete: true })).toEqual([])
  })

  it('AC-011 denies a sensitive path without asking', async () => {
    const readSsh = {
      toolCalls: [{ name: 'read', input: { path: join(homedir(), '.ssh', 'config') } }],
    }
    const { finished, events, approve } = await runWith([readSsh, { text: 'ok' }], true)

    expect(approve).not.toHaveBeenCalled()
    expect(finished[0]).toMatchObject({ isError: true, errorCode: 'PERMISSION_DENIED' })
    expect(checkInvariants(events, { complete: true })).toEqual([])
  })

  it('reads inside the workspace without asking', async () => {
    const readInside = { toolCalls: [{ name: 'ls', input: {} }] }
    const { finished, approve, result } = await runWith([readInside, { text: 'ok' }], false)

    expect(approve).not.toHaveBeenCalled()
    expect(finished[0]).toMatchObject({ isError: false })
    expect(result.status).toBe('completed')
  })
})

describe('interactive environment (A3)', () => {
  it('AC-002 adds the notice, orders the rules and merges caps over the default', () => {
    const approver: Approver = { approve: vi.fn() }
    const base = interactiveEnvironment({ approver })
    expect(base.name).toBe('interactive')
    expect(base.principal).toEqual({ reachable: true, approver })
    expect(base.notice).toEqual([
      { role: 'system', parts: [{ type: 'text', text: ENGINE_NOTICE }] },
    ])
    expect(base.permissions!.map((r) => r.id)).toEqual([
      'workspace-sandbox',
      'talor-fallback-risk',
      'risk-approval',
    ])
    expect((base.permissions![0]!.config as { granted: unknown }).granted).toBeNull()
    expect(base.caps).toEqual({ approvalTimeoutMs: 290000 })
    expect(APPROVAL_TIMEOUT_MS).toBe(290_000)

    const merged = interactiveEnvironment({
      approver,
      caps: { approvalTimeoutMs: 50, delegation: { depth: 2 } },
    })
    expect(merged.caps).toEqual({ approvalTimeoutMs: 50, delegation: { depth: 2 } })
  })

  it('AC-011 records an approval timeout apart from a refusal', async () => {
    const timedOut = await runWith([writeA, { text: 'ok' }], true, {
      caps: { approvalTimeoutMs: 50 },
      hang: true,
    })
    expect(timedOut.finished[0]).toMatchObject({ isError: true, errorCode: 'APPROVAL_TIMEOUT' })
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false)

    const refused = await runWith([writeA, { text: 'ok' }], false)
    expect(refused.finished[0]).toMatchObject({ isError: true, errorCode: 'USER_DENIED' })
  })

  it('AC-003 reads skill files without asking and asks before writing there', async () => {
    const skills = mkdtempSync(join(tmpdir(), 'talor-a3-g-'))
    writeFileSync(join(skills, 'ref.md'), 'skill reference body')
    const prompt = vi.fn(async (req: { requestId: string }) => ({
      requestId: req.requestId,
      decision: 'approved' as const,
    }))
    const off = registerApprovalPort('s1', prompt)
    const approver = createSessionApprover({ skillRoots: [skills] })
    try {
      const read = await runWith(
        [
          { toolCalls: [{ name: 'read', input: { path: join(skills, 'ref.md') } }] },
          { text: 'ok' },
        ],
        true,
        { approver },
      )
      expect(prompt).not.toHaveBeenCalled()
      expect(read.finished[0]).toMatchObject({ isError: false })
      const shown = await read.archive.getBlob(read.finished[0]!.shown)
      expect(String(shown)).toContain('skill reference body')

      await runWith(
        [
          { toolCalls: [{ name: 'write', input: { path: join(skills, 'new.md'), content: 'x' } }] },
          { text: 'ok' },
        ],
        true,
        { approver },
      )
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(prompt.mock.calls[0]![0]).toMatchObject({
        reason: 'high_risk_tool',
        suggestedPatterns: [],
      })
    } finally {
      off()
      rmSync(skills, { recursive: true, force: true })
    }
  })

  it('AC-012 gives the model the notice in its first input', async () => {
    const { model } = await runWith([{ text: 'hi' }], true)
    const system = JSON.stringify(model.inputs[0]!.messages.filter((m) => m.role === 'system'))
    expect(system).toContain('# Core Behavior Principles')
    expect(system).toContain('# Task Routing')
  })
})

describe('MCP host and runtime lifecycle (A2)', () => {
  const AT = '2026-01-01T00:00:00.000Z'
  const SERVERS: MCPServer[] = [
    {
      id: 'm1',
      name: 'github',
      type: 'stdio',
      command: 'npx',
      enabled: true,
      created_at: AT,
      updated_at: AT,
    },
    {
      id: 'm2',
      name: 'legacy',
      type: 'stdio',
      command: 'npx',
      enabled: false,
      created_at: AT,
      updated_at: AT,
    },
    { id: 'm3', name: 'broken', type: 'stdio', enabled: true, created_at: AT, updated_at: AT },
  ]

  it('AC-006 preconnects the same specs the catalog gives the agents', () => {
    const catalog = catalogSnapshot({
      builtins: () => [],
      mcpServers: () => SERVERS,
      skills: () => [],
      agents: () => [],
    })
    expect(preconnectSpecs(SERVERS)).toEqual([catalog.mcpServers[0]!.spec])
    expect(catalog.mcpServers.map((e) => e.name)).toEqual(['github'])
  })

  it('AC-007 closes the MCP connections when the runtime shuts down', async () => {
    const fake = fakeMcpServer({ tools: [{ name: 'ping' }] })
    let closed = 0
    const connect: McpConnect = async (server, opts) => {
      const conn = await fake.connect(server, opts)
      const close = conn.close.bind(conn)
      conn.close = async () => {
        closed += 1
        await close()
      }
      return conn
    }
    const mcp = createMcpHost({ connect })
    const model = fakeModel({ replies: [{ text: 'ok' }] })
    const runtime = createRuntime({
      models: modelHub({ providers: [model], default: model.ref }),
      archive: memoryArchive(),
      mcp,
    })
    const lease = await mcp.acquire(preconnectSpecs(SERVERS)[0]!, {
      vault: { resolve: async () => '' },
      signal: new AbortController().signal,
    })
    lease.release()
    expect(closed).toBe(0)

    await shutdownRuntime(runtime)
    expect(closed).toBe(1)
  })

  it('AC-007 does nothing when no runtime was created', async () => {
    await expect(shutdownRuntime()).resolves.toBeUndefined()
  })
})

describe('delegation caps (A4 TASK-2)', () => {
  const config = (c: Record<string, number>) =>
    ({ queueTimeoutMs: 300000, ...c }) as unknown as Parameters<typeof delegationCapsOf>[0]

  it('AC-004 clamps the delegation config and the environment accepts it', () => {
    const first = config({
      maxConcurrencyPerSession: 4,
      maxInvocationsPerAgentPerSession: 2,
      executionTimeoutMs: 60000,
    })
    const second = config({
      maxConcurrencyPerSession: 0,
      maxInvocationsPerAgentPerSession: -1,
      executionTimeoutMs: 10,
    })
    const third = config({
      maxConcurrencyPerSession: 2.7,
      maxInvocationsPerAgentPerSession: NaN,
      executionTimeoutMs: Infinity,
    })
    expect([delegationCapsOf(first), childTimeoutOf(first)]).toEqual([
      { depth: 3, perAgent: 2, concurrency: 4 },
      60000,
    ])
    expect([delegationCapsOf(second), childTimeoutOf(second)]).toEqual([
      { depth: 3, perAgent: 3, concurrency: 10 },
      1800000,
    ])
    expect([delegationCapsOf(third), childTimeoutOf(third)]).toEqual([
      { depth: 3, perAgent: 3, concurrency: 2 },
      1800000,
    ])
    const env = interactiveEnvironment({ caps: { delegation: delegationCapsOf(second) } })
    expect(env.caps).toMatchObject({
      approvalTimeoutMs: APPROVAL_TIMEOUT_MS,
      delegation: { depth: 3, perAgent: 3, concurrency: 10 },
    })
    const model = fakeModel({ replies: [{ text: 'x' }] })
    const engine = createEngine({
      services: {
        models: modelHub({ providers: [model], default: model.ref }),
        archive: memoryArchive(),
      },
    })
    expect(() => engine.environment(env)).not.toThrow()
  })

  it('AC-005 rejects a second delegation to the same agent past perAgent', async () => {
    const model = fakeModel({
      replies: [
        { toolCalls: [{ name: 'delegate', input: { agent: 'helper', task: 'a' } }] },
        { text: 'ok1' },
        { toolCalls: [{ name: 'delegate', input: { agent: 'helper', task: 'b' } }] },
        { text: 'done' },
      ],
    })
    const archive = memoryArchive()
    const runtime = createRuntime({
      models: modelHub({ providers: [model], default: model.ref }),
      archive,
      caps: { delegation: { depth: 3, perAgent: 1, concurrency: 10 } },
    })
    const helper = {
      id: 'helper',
      name: 'Helper',
      description: 'helps with notes',
      agentPrompt: 'Help.',
    }
    const snapshot = catalogSnapshot({
      builtins: () => [],
      mcpServers: () => [],
      skills: () => [],
      agents: () => [{ profile: helper, featureTools: [] }],
    })
    const agent = agentFor(
      {
        id: '__chat__',
        name: 'Talor',
        description: '',
        agentPrompt: 'Help.',
        subagents: { allowAny: true },
      },
      snapshot,
    )
    const task = defineTask({
      input: [{ role: 'user', parts: [{ type: 'text', text: 'go' }] }],
      subject: 's1',
    })
    const result = await runtime.interactive.start(agent, task).result
    const events: RunEvent[] = []
    for await (const event of archive.read(result.runId)) events.push(event)
    const finished = events.filter((e) => e.t === 'tool_finished')
    expect(result.status).toBe('completed')
    expect(finished).toHaveLength(2)
    expect(finished[0]).toMatchObject({ isError: false })
    expect(finished[1]).toMatchObject({ isError: true, errorCode: 'SPAWN_LIMIT' })
    expect(JSON.stringify(model.inputs[0]!.messages)).toContain('Helper：helps with notes')
  })
})

describe('runtime creation failure (A5a TASK-3)', () => {
  const fakeHost = () =>
    ({ kind: 'mcp', shutdown: vi.fn(async () => undefined) }) as unknown as McpHost & {
      shutdown: ReturnType<typeof vi.fn>
    }

  it('AC-011 closes the MCP host on failure and waits before rebuilding', async () => {
    const hosts: Array<ReturnType<typeof fakeHost>> = []
    let fail = true
    const built = { engine: { shutdown: async () => undefined } } as unknown as Runtime
    const build = vi.fn(() =>
      buildRuntime({
        mcp: () => {
          const h = fakeHost()
          hosts.push(h)
          return h
        },
        runtime: () => {
          if (fail) throw new Error('boom')
          return built
        },
      }),
    )
    const t0 = 1_000_000
    expect(() => getRuntime({ build, now: () => t0 })).toThrow('boom')
    expect(hosts[0]!.shutdown).toHaveBeenCalledTimes(1)
    expect(runtimeCreated()).toBe(false)

    fail = false
    expect(() => getRuntime({ build, now: () => t0 + 30_000 })).toThrow(String(RUNTIME_RETRY_MS))
    expect(build).toHaveBeenCalledTimes(1)

    expect(getRuntime({ build, now: () => t0 + 61_000 })).toBe(built)
    expect(build).toHaveBeenCalledTimes(2)
    expect(runtimeCreated()).toBe(true)
    expect(hosts[1]!.shutdown).not.toHaveBeenCalled()
    await shutdownRuntime()
    expect(runtimeCreated()).toBe(false)
  })
})
