import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const { currentDb, configValues, generateText } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
  configValues: {} as Record<string, unknown>,
  generateText: vi.fn(),
}))

// 凭据库不读真实的 Electron safeStorage
vi.mock('../services/safe-storage', () => ({
  SafeStorageService: { getInstance: () => ({ getApiKey: () => null }) },
}))
// 跨轮前文由引擎会话提供：Talor 不应自己调模型做摘要（替换 generateText 以便断言）
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText,
}))

vi.mock('../db/index', () => ({
  getDb: () => {
    if (!currentDb.instance) throw new Error('Test DB not initialized')
    return currentDb.instance
  },
}))
vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: () => ({
      get: (key: string) => configValues[key],
      getDelegation: () => ({
        maxConcurrencyPerSession: 10,
        queueTimeoutMs: 300000,
        executionTimeoutMs: 1800000,
        maxInvocationsPerAgentPerSession: 3,
      }),
    }),
  },
}))

import {
  createHookRunner,
  createMcpHost,
  memoryArchive,
  modelHub,
  type ModelInput,
} from 'agent-engine'
import {
  fakeMcpServer,
  fakeModel,
  type FakeMcpServer,
  type FakeModel,
  type FakeReply,
} from 'agent-engine/testing'
import type { AgentManager } from '../agent/agent-manager'
import type { AgentProfile } from '@shared/types/agent'
import type { ChatCallbacks, ChatPorts } from '../chat/types'
import type { MCPServer } from '../repos/mcp-server-repo'
import { streamRegistry } from '../chat/stream-registry'
import { sessionRepo } from '../repos/session-repo'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import { sessionApprover } from './approval'
import { catalogSnapshot, type CatalogSnapshot } from './catalog'
import { createRuntime, getRuntime, type Runtime } from './engine'
import { shutdownForQuit } from './lifecycle'
import { liveRows } from './live-turns'
import { clearRowCache, INTERRUPTED_NOTE, rowsOfRun, sessionRows } from './turn-rows'
import { sendTurn } from './turn'
import { phaseMarker } from '@shared/turn-phase'

const CREATE_TABLES = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT,
  workspace TEXT,
  agent_id TEXT NOT NULL DEFAULT '__chat__',
  parent_session_id TEXT,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata TEXT,
  reasoning TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE session_summaries (
  session_id     TEXT NOT NULL PRIMARY KEY,
  summary_text   TEXT NOT NULL,
  covered_until  TEXT NOT NULL,
  token_estimate INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);
`

const CHAT_PROFILE = {
  id: '__chat__',
  name: 'Talor',
  description: 'chat',
  agentPrompt: 'You are Talor.',
}

let workspace: string
let model: FakeModel
let runtime: Runtime
let done: Array<[string, unknown]>
let statuses: string[] = []
let confirmTool: ReturnType<typeof vi.fn>
let promptPermission: ReturnType<typeof vi.fn>
const permissionAnswer = (decision: 'approved' | 'rejected') =>
  vi.fn(async (req: { requestId: string }) => ({ requestId: req.requestId, decision }))
let catalog: ReturnType<typeof vi.fn<() => CatalogSnapshot>>

/** 内存库里没有 mcp_servers 表，目录只给内置工具。 */
const catalogOf = (exclude: string[] = []) =>
  catalogSnapshot({
    builtins: () => toolRegistry.listAll().filter((t) => !exclude.includes(t.name)),
    mcpServers: () => [],
    skills: () => [],
    agents: () => [],
  })

function useReplies(replies: FakeReply[], mcpServer?: FakeMcpServer) {
  model = fakeModel({ provider: 'talor', model: 'p1/m1', replies, repeatLast: true })
  runtime = createRuntime({
    models: modelHub({ providers: [model] }),
    archive: memoryArchive(),
    approver: sessionApprover,
    ...(mcpServer ? { mcp: createMcpHost({ connect: mcpServer.connect }) } : {}),
  })
}

const CRM: MCPServer = {
  id: 'crm-id',
  name: 'crm',
  type: 'stdio',
  command: 'crm-server',
  enabled: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

/** 目录含 crm 服务器（内存库里没有 mcp_servers 表，直接给来源）。 */
const catalogWithCrm = () =>
  catalogSnapshot({
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => [CRM],
    skills: () => [],
    agents: () => [],
  })

const callbacks = (): ChatCallbacks => ({
  onTextDelta: vi.fn(),
  onToolCall: vi.fn(),
  onToolResult: vi.fn(),
  onMessagePersisted: vi.fn(),
  onRunStatus: (_messageId, status) => void statuses.push(status),
  onDone: (messageId, error) => void done.push([messageId, error]),
})

const ports = (chat: AgentProfile = CHAT_PROFILE): ChatPorts => ({
  confirmTool: confirmTool as unknown as ChatPorts['confirmTool'],
  promptPermission: promptPermission as unknown as ChatPorts['promptPermission'],
  agentManager: {
    getAgent: () => null,
    getChatAgent: () => ({ profile: chat }),
  } as unknown as AgentManager,
})

const send = (content: string, chat?: AgentProfile) =>
  sendTurn({ sessionId: 's1', content, attachments: [] }, callbacks(), ports(chat), {
    runtime: () => runtime,
    now: () => new Date('2026-10-31T08:00:00Z'),
    catalog,
  })

/** 界面看到的行：同 session:getMessages（档案折叠 + 进行中的轮；子会话读它的子运行），全文模式。 */
async function rowsOf(sessionId: string) {
  const runId = sessionRepo.getMetadata(sessionId).engine_run_id
  const done =
    typeof runId === 'string'
      ? await rowsOfRun(runtime.archive, { runId, sessionId, agentId: 'helper', full: true })
      : (
          await sessionRows(runtime.archive, sessionId, {
            turns: Number.POSITIVE_INFINITY,
            full: true,
          })
        ).messages
  const live = liveRows(sessionId)
  const liveIds = new Set(live.map((m) => m.id))
  return [...done.filter((m) => !liveIds.has(m.id)), ...live].map((r) => ({
    role: r.role,
    content: JSON.parse(r.content) as unknown,
    trace_id: r.trace_id ?? null,
    content_type: r.content_type,
  }))
}

const parsed = () => rowsOf('s1')

const textOfInput = (input: ModelInput) => JSON.stringify(input.messages)

const HELPER: AgentProfile = {
  id: 'helper',
  name: 'Helper',
  description: 'helps',
  agentPrompt: 'You help.',
}
const DELEGATING_CHAT: AgentProfile = { ...CHAT_PROFILE, subagents: { allowAny: true } }

/** 目录含业务 agent helper。 */
const delegationCatalog = () =>
  catalogSnapshot({
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => [],
    skills: () => [],
    agents: () => [{ profile: HELPER, featureTools: [] }],
  })

const childSession = () =>
  currentDb.instance!.prepare("SELECT * FROM sessions WHERE parent_session_id = 's1'").get() as {
    id: string
    status: string
    parent_message_id: string
  }

/** 每个 tool-call 都紧跟一条含它结果的 tool 行。 */
async function assertPaired(given?: Awaited<ReturnType<typeof rowsOf>>) {
  const list = given ?? (await parsed())
  list.forEach((r, i) => {
    if (r.role !== 'assistant' || !Array.isArray(r.content)) return
    const ids = (r.content as Array<{ type: string; toolCallId?: string }>)
      .filter((p) => p.type === 'tool-call')
      .map((p) => p.toolCallId)
    if (ids.length === 0) return
    const next = list[i + 1]
    expect(next?.role).toBe('tool')
    const got = (next!.content as Array<{ toolCallId: string }>).map((p) => p.toolCallId)
    expect(got).toEqual(ids)
  })
}

beforeEach(() => {
  clearRowCache()
  workspace = mkdtempSync(join(tmpdir(), 'talor-turn-'))
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_TABLES)
  currentDb.instance
    .prepare(
      `INSERT INTO sessions (id, title, provider_id, model_id, workspace, created_at, updated_at)
       VALUES ('s1', 't', 'p1', 'm1', ?, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z')`,
    )
    .run(workspace)
  for (const key of Object.keys(configValues)) delete configValues[key]
  configValues.providers = {
    p1: {
      id: 'p1',
      type: 'openai',
      name: 'P1',
      base_url: 'https://example.invalid',
      models: [{ id: 'm1', name: 'm1', provider_id: 'p1', display_name: 'm1', capabilities: [] }],
      enabled: true,
      is_default: true,
      supports_vision: false,
      created_at: '',
      updated_at: '',
    },
  }
  done = []
  confirmTool = vi.fn().mockResolvedValue(true)
  promptPermission = permissionAnswer('approved')
  catalog = vi.fn(() => catalogOf())
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
  rmSync(workspace, { recursive: true, force: true })
})

describe('sendTurn', () => {
  it('AC-007 / C1 AC-009 runs a plain turn, persists both messages and records usage', async () => {
    useReplies([{ text: '你好！' }])
    statuses = []

    const { messageId } = await send('hi')

    expect(done).toEqual([[messageId, undefined]])
    const list = await parsed()
    expect(list.map((r) => r.role)).toEqual(['user', 'assistant'])
    expect(list[0]!.content).toBe('hi')
    expect(list[1]!.content).toEqual([
      { type: 'text', text: '你好！', providerOptions: phaseMarker('answer') },
    ])
    expect(list.every((r) => r.trace_id === messageId)).toBe(true)
    expect(statuses).toEqual(['verifying', 'idle'])
    const usage = currentDb
      .instance!.prepare('SELECT input_tokens, output_tokens FROM sessions WHERE id = ?')
      .get('s1') as { input_tokens: number; output_tokens: number }
    expect(usage.input_tokens).toBeGreaterThan(0)
    expect(usage.output_tokens).toBeGreaterThan(0)
  })

  it('AC-008 gives the next turn the previous turn as history', async () => {
    useReplies([{ text: '你好！' }, { text: 'again ok' }])

    await send('hi')
    await send('again')

    const last = textOfInput(model.inputs.at(-1)!)
    const count = (needle: string) => last.split(needle).length - 1
    expect(last).toContain('你好！')
    // 上一轮的输入与本轮的输入各出现一次
    expect(count('"hi"')).toBe(1)
    expect(count('"again"')).toBe(1)
    expect(last.indexOf('"hi"')).toBeLessThan(last.indexOf('你好！'))
    expect(last.indexOf('你好！')).toBeLessThan(last.indexOf('"again"'))
  })

  it('AC-009 / A3 AC-013 asks the permission window before writing and keeps tool messages paired', async () => {
    useReplies([
      { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
      { text: 'done' },
    ])

    const { messageId } = await send('write a file')

    expect(done).toEqual([[messageId, undefined]])
    expect(promptPermission).toHaveBeenCalledTimes(1)
    expect(promptPermission.mock.calls[0]![0]).toMatchObject({
      toolName: 'write',
      reason: 'high_risk_tool',
      suggestedPatterns: [],
    })
    expect(confirmTool).not.toHaveBeenCalled()
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hi')
    expect((await parsed()).map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    await assertPaired()
  })

  it('AC-009 / A3 AC-013 does not write when the user rejects', async () => {
    promptPermission = permissionAnswer('rejected')
    useReplies([
      { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
      { text: 'ok' },
    ])

    await send('write a file')

    expect(existsSync(join(workspace, 'a.txt'))).toBe(false)
    expect(promptPermission).toHaveBeenCalledTimes(1)
    expect(confirmTool).not.toHaveBeenCalled()
    const tool = (await parsed()).find((r) => r.role === 'tool')!
    expect(tool.content).toMatchObject([{ isError: true }])
    await assertPaired()
  })

  it('AC-012 gives the turn only the tools in the catalog', async () => {
    catalog.mockImplementation(() => catalogOf(['write']))
    useReplies([
      { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
      { text: 'ok' },
    ])

    await send('write a file')

    expect(catalog).toHaveBeenCalledTimes(1)
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false)
    expect(promptPermission).not.toHaveBeenCalled()
    const tool = (await parsed()).find((r) => r.role === 'tool')!
    expect(tool.content).toMatchObject([{ toolName: 'write', isError: true }])
    await assertPaired()
  })

  it('A2 AC-008 finds an MCP tool through search_tool and calls it', async () => {
    // 延后工具不超过 20 个时引擎直接全给、不露出 search_tool（F23），所以多放 20 个无关工具
    const crm = fakeMcpServer({
      tools: [
        { name: 'lookup', description: '查客户', handler: () => '客户 A' },
        ...Array.from({ length: 20 }, (_, i) => ({ name: `misc${i}`, description: `杂项 ${i}` })),
      ],
    })
    catalog.mockImplementation(catalogWithCrm)
    useReplies(
      [
        { toolCalls: [{ name: 'search_tool', input: { query: 'lookup' } }] },
        { toolCalls: [{ name: 'crm__lookup', input: { id: 1 } }] },
        { text: 'done' },
      ],
      crm,
    )

    const { messageId } = await send('look up customer 1')

    expect(done).toEqual([[messageId, undefined]])
    expect(model.inputs[0]!.tools.map((t) => t.name)).toContain('search_tool')
    expect(model.inputs[0]!.tools.map((t) => t.name)).not.toContain('crm__lookup')
    expect(crm.calls).toEqual([{ name: 'lookup', args: { id: 1 } }])
    const list = await parsed()
    expect(list.map((r) => r.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(list[1]!.content).toMatchObject([{ type: 'tool-call', toolName: 'search_tool' }])
    expect(list[3]!.content).toMatchObject([{ type: 'tool-call', toolName: 'crm__lookup' }])
    expect(JSON.stringify(list[4]!.content)).toContain('客户 A')
    expect(list[5]!.content).toEqual([
      { type: 'text', text: 'done', providerOptions: phaseMarker('answer') },
    ])
    await assertPaired()
  })

  it('carries the image an MCP tool returned into the next turn', async () => {
    const crm = fakeMcpServer({
      tools: [
        {
          name: 'shot',
          description: '截图',
          handler: () => ({
            content: [
              { type: 'text', text: '页面截图' },
              { type: 'image', data: 'iVBOR', mimeType: 'image/png' },
            ],
          }),
        },
      ],
    })
    catalog.mockImplementation(catalogWithCrm)
    useReplies(
      [
        { toolCalls: [{ name: 'crm__shot', input: {} }] },
        { text: '页面正常' },
        { text: '和上次一样' },
      ],
      crm,
    )

    await send('截个图')
    await send('再看看')

    const imagesIn = (input: ModelInput) =>
      input.messages.flatMap((m) =>
        m.role === 'tool' ? m.content.flatMap((r) => r.images ?? []) : [],
      )
    const image = { type: 'image', image: 'iVBOR', mediaType: 'image/png' }
    // 同一轮里引擎直接给；下一轮由 history 带回
    expect(imagesIn(model.inputs[1]!)).toEqual([image])
    expect(imagesIn(model.inputs.at(-1)!)).toEqual([image])
    await assertPaired()
  })

  it('A2 AC-009 finishes the turn when an MCP server cannot connect', async () => {
    const broken = fakeMcpServer({ tools: [{ name: 'ping' }], failConnects: 1 })
    catalog.mockImplementation(catalogWithCrm)
    useReplies([{ text: 'hi' }], broken)

    const { messageId } = await send('hello')

    expect(done).toEqual([[messageId, undefined]])
    expect((await parsed()).map((r) => [r.role, r.content])).toEqual([
      ['user', 'hello'],
      ['assistant', [{ type: 'text', text: 'hi', providerOptions: phaseMarker('answer') }]],
    ])
    // 服务器不可用：没有延后工具，search_tool 也不露出
    expect(model.inputs[0]!.tools.map((t) => t.name)).not.toContain('search_tool')
  })

  it('A4 AC-009 delegates to a sub-agent whose write is approved in the parent session', async () => {
    catalog.mockImplementation(delegationCatalog)
    useReplies([
      { toolCalls: [{ name: 'delegate', input: { agent: 'helper', task: 'write a note' } }] },
      { toolCalls: [{ name: 'write', input: { path: 'a.txt', content: 'hi' } }] },
      { text: 'wrote' },
      { text: 'done' },
    ])

    const { messageId } = await send('please delegate', DELEGATING_CHAT)

    expect(done).toEqual([[messageId, undefined]])
    expect(promptPermission).toHaveBeenCalledTimes(1)
    const req = promptPermission.mock.calls[0]![0] as {
      toolName: string
      reason: string
      absPath?: string
      inputSummary: string
    }
    // 工作区内的写没有越界路径，A3 的高风险请求不带 absPath，路径在输入里
    expect(req).toMatchObject({ toolName: 'write', reason: 'high_risk_tool' })
    expect(req.absPath).toBeUndefined()
    expect(req.inputSummary.startsWith('子 agent Helper：')).toBe(true)
    expect(req.inputSummary).toContain('a.txt')
    expect(confirmTool).not.toHaveBeenCalled()
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('hi')

    expect((await parsed()).map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(JSON.stringify((await parsed())[2]!.content)).toContain('wrote')
    await assertPaired()

    const child = childSession()
    expect(child).toMatchObject({ status: 'completed', parent_message_id: messageId })
    const childRows = await rowsOf(child.id)
    expect(childRows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(childRows[0]!.content).toBe('write a note')
    expect(childRows[3]!.content).toEqual([
      { type: 'text', text: 'wrote', providerOptions: phaseMarker('answer') },
    ])
    await assertPaired(childRows)
    // 子会话按子运行 id 读出
    expect(sessionRepo.getMetadata(child.id).engine_run_id).toEqual(expect.any(String))

    const usageOf = (id: string) =>
      currentDb.instance!.prepare('SELECT input_tokens FROM sessions WHERE id = ?').get(id) as {
        input_tokens: number
      }
    const parentRun = await runtime.archive.query({ subject: 's1' })
    const root = parentRun.find((r) => r.runId === messageId)!
    expect(usageOf('s1').input_tokens).toBe(root.usage!.input - root.usage!.children.input)
    expect(usageOf(child.id).input_tokens).toBeGreaterThan(0)
  })

  it('A4 AC-010 aborts the child session when the user stops', async () => {
    catalog.mockImplementation(delegationCatalog)
    useReplies([
      { toolCalls: [{ name: 'delegate', input: { agent: 'helper', task: 'wait' } }] },
      { hang: true },
    ])

    const pending = send('please delegate', DELEGATING_CHAT)
    await new Promise((resolve) => setTimeout(resolve, 50))
    streamRegistry.abort('s1')
    const { messageId } = await pending

    expect(done).toEqual([[messageId, undefined]])
    expect(childSession()).toMatchObject({ status: 'aborted' })
    await assertPaired()
  })

  it('A5a AC-010 lets a turn in progress finish its writes before quitting', async () => {
    useReplies([{ hang: true }])
    // 作为全局运行时安装，退出关闭作用于它
    expect(getRuntime({ build: () => runtime })).toBe(runtime)

    const pending = send('wait')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await shutdownForQuit(3000)).toBe('closed')
    const { messageId } = await pending

    expect(done).toEqual([[messageId, undefined]])
    // 中断提示由读模型从引擎补记的结局折叠出来
    const list = await parsed()
    expect(list.map((r) => [r.role, r.content_type, r.trace_id])).toEqual([
      ['user', undefined, messageId],
      ['assistant', 'notice', messageId],
    ])
    expect(list[1]!.content).toEqual([{ type: 'text', text: INTERRUPTED_NOTE }])
  })

  const sessionUsage = () =>
    currentDb
      .instance!.prepare(
        'SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM sessions WHERE id = ?',
      )
      .get('s1') as {
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
    }
  const ownOf = async (messageId: string) => {
    const run = (await runtime.archive.query({ subject: 's1' })).find((r) => r.runId === messageId)!
    const u = run.usage!
    return {
      input_tokens: u.input - u.children.input,
      output_tokens: u.output - u.children.output,
      cache_read_tokens: u.cacheRead - u.children.cacheRead,
      cache_write_tokens: u.cacheWrite - u.children.cacheWrite,
    }
  }

  it('A5b AC-002 writes usage every step and ends with the run total', async () => {
    const spy = vi.spyOn(sessionRepo, 'addUsage')
    try {
      useReplies([{ toolCalls: [{ name: 'ls', input: { path: '.' } }] }, { text: 'done' }])
      const { messageId } = await send('list')
      expect(done).toEqual([[messageId, undefined]])
      expect(spy.mock.calls.filter((c) => c[0] === 's1').length).toBeGreaterThanOrEqual(2)
      expect(sessionUsage()).toEqual(await ownOf(messageId))
    } finally {
      spy.mockRestore()
    }
  })

  it('A5b AC-003 keeps the usage of finished steps when the user stops', async () => {
    useReplies([{ toolCalls: [{ name: 'ls', input: { path: '.' } }] }, { hang: true }])
    const pending = send('list then wait')
    await new Promise((resolve) => setTimeout(resolve, 80))
    let midway: number
    try {
      midway = sessionUsage().input_tokens
    } finally {
      streamRegistry.abort('s1')
    }
    const { messageId } = await pending
    expect(midway).toBeGreaterThan(0)
    expect(sessionUsage()).toEqual(await ownOf(messageId))
  })

  it('B1 AC-016 expands a plugin command before saving and running the turn', async () => {
    catalog.mockImplementation(() =>
      catalogSnapshot({
        builtins: () => toolRegistry.listAll(),
        mcpServers: () => [],
        skills: () => [],
        agents: () => [],
        commands: () => [
          { name: 'alpha:review', content: 'Review: $ARGUMENTS', source: 'plugin:alpha' },
        ],
      }),
    )
    useReplies([{ text: 'ok' }])

    await send('/alpha:review a.ts')

    const input = JSON.stringify(model.inputs[0]!.messages)
    expect(input).toContain('Review: a.ts')
    expect(input).not.toContain('/alpha:review')
    expect((await parsed())[0]).toMatchObject({ role: 'user', content: 'Review: a.ts' })
    expect(catalog).toHaveBeenCalledTimes(1)
  })

  it('AC-010 stops when the user aborts and leaves no unpaired tool call', async () => {
    useReplies([{ hang: true }])

    const pending = send('wait')
    await new Promise((resolve) => setTimeout(resolve, 50))
    streamRegistry.abort('s1')
    const { messageId } = await pending

    expect(done).toEqual([[messageId, undefined]])
    expect((await parsed())[0]).toMatchObject({ role: 'user', content: 'wait' })
    await assertPaired()
  })

  it('B2 AC-006 reports a UserPromptSubmit hook block through onDone without calling the model', async () => {
    model = fakeModel({
      provider: 'talor',
      model: 'p1/m1',
      replies: [{ text: 'hi' }],
      repeatLast: true,
    })
    runtime = createRuntime({
      models: modelHub({ providers: [model] }),
      archive: memoryArchive(),
      approver: sessionApprover,
      hooks: [{ event: 'UserPromptSubmit', command: 'policy' }],
      hookRunner: createHookRunner({
        exec: async () => ({
          exitCode: 2,
          stdout: '',
          stderr: 'blocked by policy',
          timedOut: false,
        }),
      }),
    })

    const { messageId } = await send('hello')

    expect(done).toEqual([[messageId, { code: 'LLM_ERROR', message: 'blocked by policy' }]])
    expect(model.inputs).toHaveLength(0)
    // 被须知拦下的运行没有开始（无 run_started），不是会话的一轮：结束后界面不再显示这条输入，原因经 onDone 给出
    expect(await parsed()).toEqual([])
  })

  it('AC-011 reports a model auth failure through onDone', async () => {
    useReplies([{ error: { code: 'AUTH_FAILED', message: 'bad key' } }])

    const { messageId } = await send('hi')

    expect(done).toHaveLength(1)
    expect(done[0]![0]).toBe(messageId)
    expect(done[0]![1]).toMatchObject({ code: 'AUTH_FAILED' })
  })

  it('reports an empty message without starting a run', async () => {
    useReplies([{ text: 'never' }])

    const { messageId } = await send('   ')

    expect(done).toEqual([[messageId, { code: 'LLM_ERROR', message: 'Empty message' }]])
    expect(await parsed()).toEqual([])
    expect(model.inputs).toHaveLength(0)
  })
})

describe('intent tools (C2)', () => {
  it('AC-006 ends an ask_user turn without error and keeps the call paired', async () => {
    useReplies([
      {
        toolCalls: [{ name: 'ask_user', input: { question: '用哪个目录？', options: ['a', 'b'] } }],
      },
    ])

    const { messageId } = await send('整理一下')

    expect(done).toEqual([[messageId, undefined]])
    const list = await parsed()
    expect(list.map((r) => r.role)).toEqual(['user', 'assistant', 'tool'])
    expect(JSON.stringify(list[1]!.content)).toContain('ask_user')
    expect((list[1]!.content as Array<{ providerOptions?: unknown }>)[0]!.providerOptions).toEqual(
      phaseMarker('answer'),
    )
    await assertPaired(list)
  })

  it('AC-006 ends a report_blocked turn without error and keeps the call paired', async () => {
    useReplies([{ toolCalls: [{ name: 'report_blocked', input: { reason: '缺少权限' } }] }])

    const { messageId } = await send('删掉系统文件')

    expect(done).toEqual([[messageId, undefined]])
    const list = await parsed()
    expect(list.map((r) => r.role)).toEqual(['user', 'assistant', 'tool'])
    expect(JSON.stringify(list[1]!.content)).toContain('report_blocked')
    await assertPaired(list)
  })
})

describe('pending context (workbench snapshot)', () => {
  it('AC-008 gives the model the pending context before the user input once, then clears it', async () => {
    sessionRepo.setMetadata('s1', { pending_context: ['SNAPSHOT-MARKER 源对话'] })
    useReplies([{ text: '好的' }, { text: '再说' }])

    await send('提炼一下')

    const first = model.inputs[0]!.messages
    const text = JSON.stringify(first)
    expect(text.indexOf('SNAPSHOT-MARKER')).toBeGreaterThan(-1)
    expect(text.indexOf('SNAPSHOT-MARKER')).toBeLessThan(text.indexOf('提炼一下'))
    expect(sessionRepo.getMetadata('s1').pending_context).toEqual([])
    // 界面的用户行只是用户说的话
    expect((await parsed())[0]).toMatchObject({ role: 'user', content: '提炼一下' })

    await send('继续')
    const last = textOfInput(model.inputs.at(-1)!)
    expect(last.split('SNAPSHOT-MARKER').length - 1).toBe(1)
  })

  it('keeps the pending context when the run does not start', async () => {
    sessionRepo.setMetadata('s1', { pending_context: ['SNAPSHOT-MARKER'] })
    model = fakeModel({ provider: 'talor', model: 'p1/m1', replies: [{ text: 'x' }] })
    runtime = createRuntime({
      models: modelHub({ providers: [model] }),
      archive: memoryArchive(),
      approver: sessionApprover,
      hooks: [{ event: 'UserPromptSubmit', command: 'policy' }],
      hookRunner: createHookRunner({
        exec: async () => ({ exitCode: 2, stdout: '', stderr: 'blocked', timedOut: false }),
      }),
    })

    await send('提炼一下')

    expect(sessionRepo.getMetadata('s1').pending_context).toEqual(['SNAPSHOT-MARKER'])
  })
})

describe('cross-turn history (engine session)', () => {
  it('AC-011 saves the user message before reading history and sends each input once', async () => {
    const savedBeforeCall: boolean[] = []
    useReplies([
      () => {
        savedBeforeCall.push(liveRows('s1').some((r) => r.content === JSON.stringify('hi')))
        return { text: '你好！' }
      },
      () => {
        savedBeforeCall.push(liveRows('s1').some((r) => r.content === JSON.stringify('again')))
        return { text: 'again ok' }
      },
    ])

    await send('hi')
    await send('again')

    expect(savedBeforeCall).toEqual([true, true])
    const last = textOfInput(model.inputs.at(-1)!)
    const count = (needle: string) => last.split(needle).length - 1
    expect(count('"hi"')).toBe(1)
    expect(count('"again"')).toBe(1)
  })

  it('takes the earlier turns from the engine session', async () => {
    generateText.mockClear()
    useReplies([{ text: '你好！' }, { text: 'again ok' }])
    await send('hi')

    await send('again')

    const last = textOfInput(model.inputs.at(-1)!)
    expect(last).toContain('"hi"')
    expect(last).toContain('你好！')
    expect(generateText).not.toHaveBeenCalled()
    const turns = await runtime.archive.query({ session: 's1' })
    expect(turns.map((t) => t.turn)).toEqual([2, 1])
    expect(turns[0]!.continues).toBe(turns[1]!.runId)
  })
})
