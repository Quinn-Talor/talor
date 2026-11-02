import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

let fakeHome: string

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'home') return fakeHome
      throw new Error(`unexpected getPath arg: ${name}`)
    }),
  },
}))
vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import type { AskRequest, RunInfo } from 'agent-engine'
import type { PermissionRequest, PermissionResponse } from '@shared/types/permissions'
import { permissionStore } from '../permissions/permission-store'
import { agentFor, engineAgentId } from './agents'
import { catalogSnapshot } from './catalog'
import {
  approvalTargetsOf,
  createSessionApprover,
  matchPathRule,
  registerApprovalPort,
} from './approval'

type Req = AskRequest & { callId: string; toolName: string }

const runOf = (subject: string | undefined, workspace?: string) =>
  ({
    runId: 'r1',
    rootRunId: 'r1',
    environment: { name: 'interactive', principalReachable: true },
    agent: { id: 'talor__chat__' },
    task: {
      ...(subject === undefined ? {} : { subject }),
      ...(workspace ? { scope: { workspace } } : {}),
    },
  }) as RunInfo

const readReq = (...paths: string[]): Req => ({
  callId: 'c1',
  toolName: 'read',
  summary: 'read 要访问工作区外的路径',
  risk: 'low',
  detail: { paths, reason: '不在工作区内' },
})

const writeReq = (path: string): Req => ({
  callId: 'c2',
  toolName: 'write',
  summary: 'write 要访问工作区外的路径；write {"path":"x"}',
  risk: 'high',
  detail: { paths: [path], input: `{"path":"${path}","content":"hi"}` },
})

const bashReq: Req = {
  callId: 'c3',
  toolName: 'bash',
  summary: 'bash {"command":"git status"}',
  risk: 'high',
  detail: { input: '{"command":"git status"}' },
}

function stubPrompt(answer: Partial<PermissionResponse> = { decision: 'approved' }) {
  return vi.fn(
    async (req: PermissionRequest): Promise<PermissionResponse> => ({
      requestId: req.requestId,
      decision: 'approved',
      ...answer,
    }),
  )
}

const DESK = join(homedir(), 'Desktop', 'talor-a3-approval-test')

let workspace: string
let unregister: Array<() => void>

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'talor-a3-home-'))
  workspace = mkdtempSync(join(tmpdir(), 'talor-a3-ws-'))
  permissionStore._resetForTests()
  unregister = []
})

afterEach(() => {
  for (const off of unregister) off()
  permissionStore._resetForTests()
  rmSync(fakeHome, { recursive: true, force: true })
  rmSync(workspace, { recursive: true, force: true })
})

function register(sessionId: string, prompt: ReturnType<typeof stubPrompt>) {
  unregister.push(registerApprovalPort(sessionId, prompt))
  return prompt
}

/** 读磁盘上的 permissions.json（不经缓存，也不清会话规则）。 */
const persistedCount = () => {
  const dir = join(fakeHome, '.talor', 'workspaces')
  if (!existsSync(dir)) return 0
  return readdirSync(dir).reduce((n, d) => {
    const file = join(dir, d, 'permissions.json')
    if (!existsSync(file)) return n
    return n + (JSON.parse(readFileSync(file, 'utf8')) as { rules: unknown[] }).rules.length
  }, 0)
}

describe('approvalTargetsOf', () => {
  it('AC-004 splits a request into path targets and at most one high-risk target', () => {
    const onlyPaths = approvalTargetsOf(readReq('/x/a', '/x/b'))
    expect(onlyPaths.paths).toEqual([
      {
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/x/a',
        inputSummary: 'read 要访问工作区外的路径\n/x/a',
      },
      {
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/x/b',
        inputSummary: 'read 要访问工作区外的路径\n/x/b',
      },
    ])
    expect(onlyPaths.risk).toBeUndefined()

    const write = approvalTargetsOf(writeReq('/x/a'))
    expect(write.paths).toHaveLength(1)
    expect(write.risk).toMatchObject({
      toolName: 'write',
      reason: 'high_risk_tool',
      absPath: '/x/a',
    })
    expect(write.risk!.inputSummary).toContain('/x/a')

    const bash = approvalTargetsOf(bashReq).risk!
    expect(bash.inputSummary).toContain('git status')
    expect(bash.inputSummary).not.toContain('{"command"')

    const truncated = '{"command":"echo 很长很长'
    expect(
      approvalTargetsOf({ ...bashReq, detail: { input: truncated } }).risk!.inputSummary,
    ).toContain(truncated)

    const fallback = approvalTargetsOf({
      callId: 'c4',
      toolName: 'crm__run',
      summary: 'crm__run {"sql":"DELETE FROM t"}',
      risk: 'high',
      detail: { reason: '参数命中旧路径的危险模式：SQL DML', input: '{"sql":"DELETE FROM t"}' },
    }).risk!.inputSummary
    expect(fallback).toContain('crm__run')
    expect(fallback).toContain('SQL DML')
    expect(fallback).toContain('DELETE FROM t')

    const hook = approvalTargetsOf({
      callId: 'c5',
      toolName: 'ls',
      summary: 'hook 要求确认',
      risk: 'low',
    })
    expect(hook).toEqual({
      paths: [],
      risk: { toolName: 'ls', reason: 'high_risk_tool', inputSummary: 'hook 要求确认' },
    })

    const long = approvalTargetsOf({ ...bashReq, summary: 'x'.repeat(900) }).risk!
    expect(long.inputSummary.length).toBeLessThanOrEqual(500)
  })
})

describe('sessionApprover v2', () => {
  const approver = createSessionApprover()

  it('AC-005 uses remembered path rules and writes the rule the user picks', async () => {
    permissionStore.addSessionRule(workspace, { tool: 'read', argPattern: '/x/', effect: 'allow' })
    const prompt = register(
      's1',
      stubPrompt({ grantPatternId: 'parent_dir', rememberAcrossSessions: true }),
    )

    expect(await approver.approve(readReq('/x/a'), runOf('s1', workspace))).toEqual({
      approved: true,
    })
    expect(prompt).not.toHaveBeenCalled()

    expect(await approver.approve(readReq(join(DESK, 'b.md')), runOf('s1', workspace))).toEqual({
      approved: true,
    })
    expect(prompt).toHaveBeenCalledTimes(1)
    const asked = prompt.mock.calls[0]![0]
    expect(asked).toMatchObject({
      reason: 'path_outside_workspace',
      absPath: join(DESK, 'b.md'),
      bulkGrantGroup: ['read', 'ls', 'glob', 'grep'],
    })
    expect(asked.suggestedPatterns.length).toBeGreaterThan(0)
    expect(persistedCount()).toBe(1)

    expect(await approver.approve(readReq(join(DESK, 'c.md')), runOf('s1', workspace))).toEqual({
      approved: true,
    })
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('AC-006 asks every time for high-risk calls, never remembers, and honours deny rules', async () => {
    permissionStore.addSessionRule(workspace, { tool: 'write', argPattern: '/x/', effect: 'allow' })
    permissionStore.addSessionRule(workspace, { tool: 'write', argPattern: '/z/', effect: 'deny' })
    const prompt = register(
      's1',
      stubPrompt({ grantPatternId: 'parent_dir', rememberAcrossSessions: true }),
    )

    expect(await approver.approve(writeReq('/x/a'), runOf('s1', workspace))).toEqual({
      approved: true,
    })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt.mock.calls[0]![0]).toMatchObject({
      reason: 'high_risk_tool',
      suggestedPatterns: [],
    })
    expect(persistedCount()).toBe(0)

    expect(await approver.approve(writeReq('/z/a'), runOf('s1', workspace))).toEqual({
      approved: false,
    })
    expect(prompt).toHaveBeenCalledTimes(1)

    expect(await approver.approve(bashReq, runOf('s1', workspace))).toEqual({ approved: true })
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[1]![0]).toMatchObject({
      reason: 'high_risk_tool',
      suggestedPatterns: [],
    })
    expect(persistedCount()).toBe(0)
  })

  it('AC-007 handles a missing workspace, refusals, errors and missing ports', async () => {
    const noWorkspace = register('s1', stubPrompt({ grantPatternId: 'parent_dir' }))
    expect(await approver.approve(readReq(join(DESK, 'b.md')), runOf('s1'))).toEqual({
      approved: true,
    })
    expect(noWorkspace.mock.calls[0]![0]).toMatchObject({ suggestedPatterns: [] })
    expect(permissionStore.allRulesFor(workspace)).toEqual([])

    register('s2', stubPrompt({ decision: 'rejected' }))
    expect(await approver.approve(readReq('/y/b'), runOf('s2', workspace))).toEqual({
      approved: false,
    })

    const failing = vi.fn(async () => {
      throw new Error('window gone')
    })
    unregister.push(registerApprovalPort('s3', failing))
    expect(await approver.approve(readReq('/y/b'), runOf('s3', workspace))).toEqual({
      approved: false,
    })
    expect(await approver.approve(bashReq, runOf('s3', workspace))).toEqual({ approved: false })

    expect(await approver.approve(readReq('/y/b'), runOf('s9', workspace))).toEqual({
      approved: false,
    })
    expect(await approver.approve(readReq('/y/b'), runOf(undefined, workspace))).toEqual({
      approved: false,
    })

    const older = stubPrompt({ decision: 'rejected' })
    const newer = stubPrompt()
    const offOlder = registerApprovalPort('s4', older)
    unregister.push(registerApprovalPort('s4', newer))
    offOlder()
    expect(await approver.approve(bashReq, runOf('s4', workspace))).toEqual({ approved: true })
    expect(newer).toHaveBeenCalledTimes(1)
    expect(older).not.toHaveBeenCalled()
  })

  it('AC-008 matches a literal-path rule against the real path of the request', async () => {
    const base = mkdtempSync(join(tmpdir(), 'talor-a3-link-'))
    try {
      mkdirSync(join(base, 'real'))
      symlinkSync(join(base, 'real'), join(base, 'link'))
      const real = realpathSync(join(base, 'real'))
      const prompt = register('s1', stubPrompt())

      permissionStore.addSessionRule(workspace, {
        tool: 'read',
        argPattern: `${join(base, 'link')}/`,
        effect: 'allow',
      })
      expect(matchPathRule(workspace, 'read', join(real, 'a'))).toBe('allow')
      expect(await approver.approve(readReq(join(real, 'a')), runOf('s1', workspace))).toEqual({
        approved: true,
      })

      permissionStore._resetForTests()
      permissionStore.addSessionRule(workspace, {
        tool: 'read',
        argPattern: `${join(base, 'link')}/`,
        effect: 'deny',
      })
      expect(await approver.approve(readReq(join(real, 'a')), runOf('s1', workspace))).toEqual({
        approved: false,
      })
      expect(prompt).not.toHaveBeenCalled()
      expect(matchPathRule(workspace, 'read', '/elsewhere/a')).toBe('unknown')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('AC-009 lets reads inside the skill roots through and still asks for writes', async () => {
    const skills = mkdtempSync(join(tmpdir(), 'talor-a3-skills-'))
    try {
      const inSkills = join(realpathSync(skills), 'lark', 'ref.md')
      const scoped = createSessionApprover({ skillRoots: [skills] })
      const prompt = register('s1', stubPrompt())

      expect(await scoped.approve(readReq(inSkills), runOf('s1', workspace))).toEqual({
        approved: true,
      })
      expect(prompt).not.toHaveBeenCalled()

      expect(await scoped.approve(writeReq(inSkills), runOf('s1', workspace))).toEqual({
        approved: true,
      })
      expect(prompt).toHaveBeenCalledTimes(1)
      expect(prompt.mock.calls[0]![0]).toMatchObject({
        reason: 'high_risk_tool',
        suggestedPatterns: [],
      })

      // 低风险工具往 skill 目录写：沙箱给 high、没有输入，照常按越界路径询问
      await scoped.approve(
        { ...readReq(inSkills), toolName: 'feature_write', risk: 'high' },
        runOf('s1', workspace),
      )
      expect(prompt).toHaveBeenCalledTimes(2)
      expect(prompt.mock.calls[1]![0]).toMatchObject({
        toolName: 'feature_write',
        reason: 'path_outside_workspace',
      })

      await scoped.approve(readReq(inSkills, '/y/outside'), runOf('s1', workspace))
      const asked = prompt.mock.calls.slice(2).map((c) => c[0])
      expect(
        asked.some((r) => r.reason === 'path_outside_workspace' && r.absPath === '/y/outside'),
      ).toBe(true)
    } finally {
      rmSync(skills, { recursive: true, force: true })
    }
  })
})

describe('child-run approvals (A4 TASK-4)', () => {
  it('AC-013 prefixes requests from a child run with the sub-agent name', async () => {
    agentFor(
      { id: 'helper', name: 'Helper', description: 'helps', agentPrompt: 'x' },
      catalogSnapshot({
        builtins: () => [],
        mcpServers: () => [],
        skills: () => [],
        agents: () => [],
      }),
    )
    const lsReq: Req = {
      ...bashReq,
      summary: 'bash {"command":"ls"}',
      detail: { input: '{"command":"ls"}' },
    }
    const original = approvalTargetsOf(lsReq).risk!.inputSummary
    const prompt = register('s-a4', stubPrompt())
    const approver = createSessionApprover()
    const root = runOf('s-a4', workspace)
    const child = (agentId: string) =>
      ({ ...root, runId: 'c1', parentRunId: 'r1', agent: { id: agentId } }) as RunInfo

    await approver.approve(lsReq, root)
    await approver.approve(lsReq, child(engineAgentId('helper')))
    await approver.approve(lsReq, child('zzz'))
    const summaries = prompt.mock.calls.map((c) => c[0].inputSummary)
    expect(summaries).toEqual([
      original,
      `子 agent Helper：\n${original}`,
      `子 agent zzz：\n${original}`,
    ])
    expect(original).toContain('ls')
    for (const s of summaries) expect(s.length).toBeLessThanOrEqual(500)
  })
})
