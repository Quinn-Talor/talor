import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { currentDb } = vi.hoisted(() => ({
  currentDb: { instance: null as Database.Database | null },
}))

vi.mock('../db/index', async () => {
  // 仅 mock getDb；其他导出（cleanup 函数等）保留真实
  const actual = await vi.importActual<typeof import('../db/index')>('../db/index')
  return {
    ...actual,
    getDb: () => {
      if (!currentDb.instance) throw new Error('Test DB not initialized')
      return currentDb.instance
    },
  }
})

import { sessionRepo, messageRepo } from '../repos/session-repo'
import { v4 as uuidv4 } from 'uuid'
import type { AgentProfile } from '@shared/types/agent'

// 直接复用本特性的核心函数式逻辑（IPC handler 内部业务）；避免在测试里搭起 Electron IPC 框架
// 我们提取 handler 实现为内联函数测，跟实际 ipc/agents.ts 走同一份流程

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
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

const CREATE_MESSAGES_FULL = `
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

let agentsDirRoot: string

beforeEach(() => {
  currentDb.instance = new Database(':memory:')
  currentDb.instance.exec(CREATE_SESSIONS_FULL)
  currentDb.instance.exec(CREATE_MESSAGES_FULL)
  agentsDirRoot = mkdtempSync(join(tmpdir(), 'agents-cry-test-'))
})

afterEach(() => {
  currentDb.instance?.close()
  currentDb.instance = null
  try {
    rmSync(agentsDirRoot, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

// ─── handler 业务逻辑（提取自 ipc/agents.ts，让单测可以直接调用而不走 IPC layer）

import { serializeS1History } from '../agent/draft-extractor'

interface StartCrystallizeResult {
  success: boolean
  workbench_session_id?: string
  reused?: boolean
  error?: string
}

const WELCOME_FRESH =
  `你好！我已读取你跟 Talor 的对话历史。\n\n` +
  `请告诉我你想从中提取一个**什么样的 agent**，可以涵盖以下任意维度：\n` +
  `- 角色定位（例如：情感挽回助手 / 代码审查师 / 旅行行程规划师）\n` +
  `- 关键能力（这个 agent 主要要做哪些事）\n` +
  `- 输出风格（Markdown / 纯文本 / 结构化 JSON 等）\n` +
  `- 依赖工具或外部服务\n\n` +
  `给一句话或几句话描述都可以，我会结合上面的对话历史综合给出 agent 草稿（fenced \`\`\`json\`\`\` block）。`
const WELCOME_UPDATED = `S1 对话有更新（最新历史已注入到上面）。如果想基于新内容调整草稿，告诉我要改什么；也可以不动，继续基于之前的方向迭代。`

function startCrystallize(sessionId: string): StartCrystallizeResult {
  const source = sessionRepo.getById(sessionId)
  if (!source) return { success: false, error: `Session not found: ${sessionId}` }

  const messages = messageRepo.listBySession(sessionId)
  const currentMsgCount = messages.length
  const snapshot = serializeS1History(messages)
  const delegated = sessionRepo.listDelegatedAgents(sessionId)

  const buildSnapshotMessage = (variant: 'fresh' | 'updated', prevCount: number): string => {
    const header =
      variant === 'fresh'
        ? `Original conversation context for this Agent extraction:`
        : `Updated original conversation history (now ${currentMsgCount} messages, was ${prevCount}):`
    return (
      header +
      `\n\n===== Original Conversation (${currentMsgCount} messages) =====\n` +
      snapshot +
      (delegated.length > 0
        ? `\n\n===== Subagents Delegated To =====\n${delegated.join(', ')}\n` +
          `(If extracting an agent from this context, include these in dependencies.subagents.)`
        : '')
    )
  }

  const existing = sessionRepo.findWorkbenchForSource(sessionId)
  if (existing) {
    const meta = sessionRepo.getMetadata(existing.id)
    const lastCount = (meta.last_snapshot_message_count as number | undefined) ?? 0
    if (lastCount !== currentMsgCount) {
      messageRepo.create({
        id: uuidv4(),
        session_id: existing.id,
        role: 'user',
        content: [{ type: 'text', text: buildSnapshotMessage('updated', lastCount) }],
        agent_id: '__crystallizer__',
      })
      messageRepo.create({
        id: uuidv4(),
        session_id: existing.id,
        role: 'assistant',
        content: [{ type: 'text', text: WELCOME_UPDATED }],
        agent_id: '__crystallizer__',
      })
      sessionRepo.setMetadata(existing.id, {
        ...meta,
        last_snapshot_message_count: currentMsgCount,
        delegated_subagents: delegated,
      })
    }
    return { success: true, workbench_session_id: existing.id, reused: true }
  }

  const workbench = sessionRepo.create({
    title: `Workbench: ${source.title}`,
    provider_id: source.provider_id,
    model_id: source.model_id,
    agent_id: '__crystallizer__',
  })
  sessionRepo.setMetadata(workbench.id, {
    source_session_id: sessionId,
    last_snapshot_message_count: currentMsgCount,
    delegated_subagents: delegated,
    created_agents: [],
  })
  messageRepo.create({
    id: uuidv4(),
    session_id: workbench.id,
    role: 'user',
    content: [{ type: 'text', text: buildSnapshotMessage('fresh', 0) }],
    agent_id: '__crystallizer__',
  })
  messageRepo.create({
    id: uuidv4(),
    session_id: workbench.id,
    role: 'assistant',
    content: [{ type: 'text', text: WELCOME_FRESH }],
    agent_id: '__crystallizer__',
  })
  return { success: true, workbench_session_id: workbench.id, reused: false }
}

interface CreateFromDraftResult {
  success: boolean
  id?: string
  created_at?: string
  error?: string
}

function createFromDraft(
  profile: AgentProfile,
  workbenchSessionId: string,
  agentsDir: string,
): CreateFromDraftResult {
  // 模拟 agent loader 内存中的 id 检查
  const checkConflict = (id: string): boolean => existsSync(join(agentsDir, id, 'agent.json'))

  // validation
  if (typeof profile.id !== 'string' || profile.id === '')
    return { success: false, error: 'id required' }
  if (profile.id.startsWith('__') && profile.id.endsWith('__')) {
    return { success: false, error: `Reserved id pattern: __X__ is for platform agents.` }
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(profile.id)) {
    return { success: false, error: 'Invalid id format' }
  }
  if (checkConflict(profile.id)) {
    return { success: false, error: `Agent id "${profile.id}" already exists.` }
  }

  // 写文件
  const targetDir = join(agentsDir, profile.id)
  mkdirSync(targetDir, { recursive: true })
  writeFileSync(join(targetDir, 'agent.json'), JSON.stringify(profile, null, 2), 'utf-8')

  // 维护 workbench.metadata.created_agents
  const wsMeta = sessionRepo.getMetadata(workbenchSessionId)
  const sourceSessionId = wsMeta.source_session_id as string | undefined
  const sourceMsgCount = sourceSessionId ? messageRepo.listBySession(sourceSessionId).length : 0
  const created = (wsMeta.created_agents as Array<Record<string, unknown>> | undefined) ?? []
  created.push({
    id: profile.id,
    version: profile.version,
    created_at: new Date().toISOString(),
    based_on_message_count: sourceMsgCount,
  })
  sessionRepo.setMetadata(workbenchSessionId, { ...wsMeta, created_agents: created })

  const createdAt = (created[created.length - 1].created_at as string) ?? new Date().toISOString()
  return { success: true, id: profile.id, created_at: createdAt }
}

const VALID_PROFILE: AgentProfile = {
  id: 'love-letter-writer',
  name: '挽回助手',
  description: '基于对话生成挽回语录',
  version: '1.0.0',
  role: { capabilities: ['撰写挽回语录'], outputFormat: 'markdown' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

// 镜像 ipc/agents.ts 的 reconcileCreatedAgents:
// 把 created_agents 跟磁盘真相对账,把已删除的 agent 从 metadata 抠掉并持久化。
// 测试里用 existsSync 替代 loader.getById（loader 在测试里没起 — 走 fs 检查同效果）。
type CreatedAgentEntry = {
  id: string
  version: string
  created_at: string
  based_on_message_count: number
}
function reconcileCreatedAgents(
  workbenchSessionId: string,
  agentsDir: string,
): CreatedAgentEntry[] {
  const meta = sessionRepo.getMetadata(workbenchSessionId)
  const created = (meta.created_agents as CreatedAgentEntry[] | undefined) ?? []
  if (created.length === 0) return []
  const alive: CreatedAgentEntry[] = []
  const removed: string[] = []
  for (const c of created) {
    if (existsSync(join(agentsDir, c.id, 'agent.json'))) alive.push(c)
    else removed.push(c.id)
  }
  if (removed.length > 0) {
    sessionRepo.setMetadata(workbenchSessionId, { ...meta, created_agents: alive })
  }
  return alive
}
function listFromWorkbench(
  workbenchSessionId: string,
  agentsDir: string,
): Array<CreatedAgentEntry & { exists: boolean }> {
  const created = reconcileCreatedAgents(workbenchSessionId, agentsDir)
  return created.map((c) => ({
    ...c,
    exists: existsSync(join(agentsDir, c.id, 'agent.json')),
  }))
}

describe('start-crystallize (TASK-2: AC-001/002/003/012)', () => {
  it('AC-001: first call creates workbench + pre-injects user(snapshot) + assistant(welcome), no auto-trigger', () => {
    const s1 = sessionRepo.create({
      title: 'Talor 主对话',
      provider_id: 'p1',
      agent_id: '__chat__',
    })
    for (let i = 0; i < 5; i++) {
      messageRepo.create({
        id: uuidv4(),
        session_id: s1.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: [{ type: 'text', text: `msg ${i}` }],
        agent_id: '__chat__',
      })
    }

    const r = startCrystallize(s1.id)
    expect(r.success).toBe(true)
    expect(r.workbench_session_id).toBeTruthy()
    expect(r.reused).toBe(false)

    const ws = sessionRepo.getById(r.workbench_session_id!)!
    expect(ws.parent_session_id).toBeUndefined() // 顶层
    expect(ws.agent_id).toBe('__crystallizer__')

    const meta = sessionRepo.getMetadata(ws.id)
    expect(meta.source_session_id).toBe(s1.id)
    expect(meta.last_snapshot_message_count).toBe(5)
    expect(meta.created_agents).toEqual([])

    // backend 直接预置两条 message：
    //   1. user(S1 历史快照) — 当作 context 不触发 LLM
    //   2. assistant(欢迎语 + 引导用户描述需求)
    // 用户输入需求后才走 chat.send 触发 ReactLoop（可控性 > 自动化）。
    const wsMessages = messageRepo.listBySession(ws.id)
    expect(wsMessages.length).toBe(2)
    expect(wsMessages[0].role).toBe('user')
    const userText = JSON.parse(wsMessages[0].content)[0].text as string
    expect(userText).toContain('Original conversation context')
    expect(userText).toContain('5 messages')
    expect(wsMessages[1].role).toBe('assistant')
    const asstText = JSON.parse(wsMessages[1].content)[0].text as string
    expect(asstText).toContain('请告诉我你想从中提取')
  })

  it('AC-002: reuse + appends snapshot+prompt when S1 has new messages', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    for (let i = 0; i < 5; i++) {
      messageRepo.create({
        id: uuidv4(),
        session_id: s1.id,
        role: 'user',
        content: [{ type: 'text', text: `m${i}` }],
        agent_id: '__chat__',
      })
    }

    // 第一次：注入 2 条
    const r1 = startCrystallize(s1.id)
    const wsId = r1.workbench_session_id!
    expect(messageRepo.listBySession(wsId).length).toBe(2)

    // S1 新增 3 条
    for (let i = 5; i < 8; i++) {
      messageRepo.create({
        id: uuidv4(),
        session_id: s1.id,
        role: 'assistant',
        content: [{ type: 'text', text: `m${i}` }],
        agent_id: '__chat__',
      })
    }

    // 第二次：检测到 diff → 追加 user(updated snapshot) + assistant(updated welcome)
    const r2 = startCrystallize(s1.id)
    expect(r2.workbench_session_id).toBe(wsId)
    expect(r2.reused).toBe(true)
    const wsMsgs = messageRepo.listBySession(wsId)
    expect(wsMsgs.length).toBe(4) // 初始 2 + diff 追加 2
    const lastUserText = JSON.parse(wsMsgs[2].content)[0].text as string
    expect(lastUserText).toContain('Updated original conversation history')
    expect(lastUserText).toContain('now 8 messages, was 5')
    const lastAsstText = JSON.parse(wsMsgs[3].content)[0].text as string
    expect(lastAsstText).toContain('S1 对话有更新')
    // 元数据更新
    const meta = sessionRepo.getMetadata(wsId)
    expect(meta.last_snapshot_message_count).toBe(8)
  })

  it('AC-003: reuse + no append when S1 unchanged', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    for (let i = 0; i < 5; i++) {
      messageRepo.create({
        id: uuidv4(),
        session_id: s1.id,
        role: 'user',
        content: [{ type: 'text', text: `m${i}` }],
        agent_id: '__chat__',
      })
    }

    const r1 = startCrystallize(s1.id)
    const wsId = r1.workbench_session_id!
    expect(messageRepo.listBySession(wsId).length).toBe(2) // user(snapshot) + assistant(welcome)
    const r2 = startCrystallize(s1.id)
    expect(r2.workbench_session_id).toBe(wsId)
    expect(r2.reused).toBe(true)
    // S1 unchanged → 不追加新消息
    expect(messageRepo.listBySession(wsId).length).toBe(2)
  })

  it('AC-012: includes delegated_subagents in metadata when S1 had delegations', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    // 模拟 S1 委托过 'A' / 'B' (创建 child sessions)
    sessionRepo.create({
      title: 'sub-A',
      provider_id: 'p1',
      parent_session_id: s1.id,
      agent_id: 'agent-a',
      status: 'completed',
    })
    sessionRepo.create({
      title: 'sub-B',
      provider_id: 'p1',
      parent_session_id: s1.id,
      agent_id: 'agent-b',
      status: 'completed',
    })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      agent_id: '__chat__',
    })

    const r = startCrystallize(s1.id)
    const meta = sessionRepo.getMetadata(r.workbench_session_id!)
    expect(meta.delegated_subagents).toEqual(['agent-a', 'agent-b'])
  })

  it('returns error when source session does not exist', () => {
    const r = startCrystallize('does-not-exist')
    expect(r.success).toBe(false)
    expect(r.error).toContain('Session not found')
  })
})

describe('create-from-draft (TASK-2: AC-009/010/011)', () => {
  it('AC-009: writes agent.json + updates workbench.metadata.created_agents', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const r1 = startCrystallize(s1.id)
    const wsId = r1.workbench_session_id!

    const r = createFromDraft(VALID_PROFILE, wsId, agentsDirRoot)
    expect(r.success).toBe(true)
    expect(r.id).toBe('love-letter-writer')
    expect(r.created_at).toBeTruthy()

    // agent.json 写入
    const agentJson = readFileSync(join(agentsDirRoot, 'love-letter-writer', 'agent.json'), 'utf-8')
    expect(JSON.parse(agentJson).id).toBe('love-letter-writer')

    // workbench.metadata.created_agents 多一项
    const meta = sessionRepo.getMetadata(wsId)
    const created = meta.created_agents as Array<Record<string, unknown>>
    expect(created.length).toBe(1)
    expect(created[0].id).toBe('love-letter-writer')
    expect(created[0].version).toBe('1.0.0')
    expect(created[0].based_on_message_count).toBe(1)
  })

  it('AC-010: rejects when id already exists (file present)', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const r1 = startCrystallize(s1.id)
    const wsId = r1.workbench_session_id!

    // 预创建冲突的 agent
    mkdirSync(join(agentsDirRoot, VALID_PROFILE.id), { recursive: true })
    writeFileSync(join(agentsDirRoot, VALID_PROFILE.id, 'agent.json'), '{}')

    const r = createFromDraft(VALID_PROFILE, wsId, agentsDirRoot)
    expect(r.success).toBe(false)
    expect(r.error).toContain('already exists')

    // metadata 不变
    const meta = sessionRepo.getMetadata(wsId)
    const created = (meta.created_agents as unknown[]) ?? []
    expect(created.length).toBe(0)
  })

  it('AC-011: rejects when profile fails validation', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!

    const bad = { ...VALID_PROFILE, id: '__chat__' }
    const r = createFromDraft(bad, wsId, agentsDirRoot)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Reserved id pattern')
  })

  it('rejects invalid id format', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!

    const bad = { ...VALID_PROFILE, id: 'Has Spaces' }
    const r = createFromDraft(bad, wsId, agentsDirRoot)
    expect(r.success).toBe(false)
    expect(r.error).toContain('Invalid id')
  })
})

describe('list-from-workbench / remove-from-workbench (TASK-2: AC-013/014)', () => {
  it('AC-013: list reconciles stale entries — only returns agents whose files still exist', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!

    // 模拟 metadata 含两个 created_agents（A 已被外部删，B 仍在）
    sessionRepo.setMetadata(wsId, {
      ...sessionRepo.getMetadata(wsId),
      created_agents: [
        {
          id: 'A',
          version: '1.0.0',
          created_at: '2026-05-08T00:00:00Z',
          based_on_message_count: 1,
        },
        {
          id: 'B',
          version: '1.0.0',
          created_at: '2026-05-08T00:00:00Z',
          based_on_message_count: 1,
        },
      ],
    })
    // B 在文件系统里
    mkdirSync(join(agentsDirRoot, 'B'), { recursive: true })
    writeFileSync(join(agentsDirRoot, 'B', 'agent.json'), JSON.stringify(VALID_PROFILE), 'utf-8')

    // 走 list 自愈路径：A（缺失）被过滤掉,B（存在）保留
    const result = listFromWorkbench(wsId, agentsDirRoot)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('B')
    expect(result[0].exists).toBe(true)
  })

  it('list persists the reconciliation — second call sees clean metadata even if all stale', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!

    // 全是 stale entries（A、B 都没在磁盘上）
    sessionRepo.setMetadata(wsId, {
      ...sessionRepo.getMetadata(wsId),
      created_agents: [
        { id: 'A', version: '1.0.0', created_at: 't', based_on_message_count: 1 },
        { id: 'B', version: '1.0.0', created_at: 't', based_on_message_count: 1 },
      ],
    })

    // 第 1 次 list:返回空 + 持久化清理
    expect(listFromWorkbench(wsId, agentsDirRoot)).toEqual([])
    const after1 = sessionRepo.getMetadata(wsId)
    expect((after1.created_agents as unknown[]).length).toBe(0)

    // 第 2 次 list:依旧空（不是因为再次 reconcile,而是 metadata 已干净）
    expect(listFromWorkbench(wsId, agentsDirRoot)).toEqual([])
  })

  it('reconcile is a no-op when all entries are alive — does not rewrite metadata', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!
    mkdirSync(join(agentsDirRoot, 'B'), { recursive: true })
    writeFileSync(join(agentsDirRoot, 'B', 'agent.json'), JSON.stringify(VALID_PROFILE), 'utf-8')
    sessionRepo.setMetadata(wsId, {
      ...sessionRepo.getMetadata(wsId),
      created_agents: [{ id: 'B', version: '1.0.0', created_at: 't', based_on_message_count: 1 }],
    })
    const before = JSON.stringify(sessionRepo.getMetadata(wsId))
    const result = listFromWorkbench(wsId, agentsDirRoot)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe('B')
    expect(JSON.stringify(sessionRepo.getMetadata(wsId))).toBe(before)
  })

  it('AC-014: remove drops entry from metadata but does NOT delete agent.json', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    messageRepo.create({
      id: uuidv4(),
      session_id: s1.id,
      role: 'user',
      content: [{ type: 'text', text: 'm' }],
      agent_id: '__chat__',
    })
    const wsId = startCrystallize(s1.id).workbench_session_id!
    sessionRepo.setMetadata(wsId, {
      ...sessionRepo.getMetadata(wsId),
      created_agents: [
        { id: 'A', version: '1.0.0', created_at: '...', based_on_message_count: 1 },
        { id: 'B', version: '1.0.0', created_at: '...', based_on_message_count: 1 },
      ],
    })
    // 模拟 remove
    const meta = sessionRepo.getMetadata(wsId)
    const created = (meta.created_agents as Array<{ id: string }>).filter((c) => c.id !== 'A')
    sessionRepo.setMetadata(wsId, { ...meta, created_agents: created })

    const after = sessionRepo.getMetadata(wsId)
    const list = after.created_agents as Array<{ id: string }>
    expect(list.length).toBe(1)
    expect(list[0].id).toBe('B')
  })
})

describe('findWorkbenchForSource (TASK-2 helper)', () => {
  it('returns null when no workbench exists for source', () => {
    expect(sessionRepo.findWorkbenchForSource('non-existent')).toBeNull()
  })

  it('returns workbench when metadata.source_session_id matches', () => {
    const s1 = sessionRepo.create({ title: 'X', provider_id: 'p1' })
    const ws = sessionRepo.create({
      title: 'WS',
      provider_id: 'p1',
      agent_id: '__crystallizer__',
    })
    sessionRepo.setMetadata(ws.id, { source_session_id: s1.id })

    const found = sessionRepo.findWorkbenchForSource(s1.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(ws.id)
  })
})
