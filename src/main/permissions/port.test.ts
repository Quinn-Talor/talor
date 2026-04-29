import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir, homedir } from 'os'
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
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createPermissionPort } from './port'
import { permissionStore } from './permission-store'
import type { PermissionRequest, PermissionResponse } from '@shared/types/permissions'

const WS = '/Users/alice/projects/foo'
// 构造本机真实 homedir 下的 Desktop 路径，以便 suggestPathPatterns 识别为
// home_subdir zone 并返回 parent_dir / top_dir 档位。
const HOME_DESKTOP = `${homedir()}/Desktop`

describe('createPermissionPort', () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'talor-port-test-'))
    permissionStore._resetForTests()
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
  })

  describe('rule-based fast paths', () => {
    it('existing allow rule short-circuits without prompting UI', async () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read',
        argPattern: '/Users/alice/Desktop/',
        effect: 'allow',
      })

      const promptUI = vi.fn()
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '/Users/alice/Desktop/foo.md',
      })

      expect(ok).toBe(true)
      expect(promptUI).not.toHaveBeenCalled()
    })

    it('existing deny rule short-circuits without prompting UI', async () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read',
        argPattern: '/Users/alice/Desktop/',
        effect: 'deny',
      })

      const promptUI = vi.fn()
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '/Users/alice/Desktop/foo.md',
      })

      expect(ok).toBe(false)
      expect(promptUI).not.toHaveBeenCalled()
    })

    it('deny takes precedence over allow when both match', async () => {
      permissionStore.addPersistedRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/', effect: 'allow',
      })
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/private/', effect: 'deny',
      })

      const promptUI = vi.fn()
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/private/secret.md',
        inputSummary: '',
      })

      expect(ok).toBe(false)
      expect(promptUI).not.toHaveBeenCalled()
    })
  })

  describe('UI prompt path', () => {
    it('prompts UI when no rule matches', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
      }))

      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: 'foo.md',
      })

      expect(ok).toBe(true)
      expect(promptUI).toHaveBeenCalledOnce()
      const req = promptUI.mock.calls[0][0]
      expect(req.toolName).toBe('read')
      expect(req.absPath).toBe('/Users/alice/Desktop/foo.md')
      expect(req.suggestedPatterns.length).toBeGreaterThan(0)
      expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('user rejection returns false', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'rejected',
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '',
      })

      expect(ok).toBe(false)
      expect(permissionStore.listAll(WS).session).toHaveLength(0)
    })

    it('promptUI exception is swallowed and treated as denial', async () => {
      const promptUI = vi.fn(async () => {
        throw new Error('IPC disconnected')
      })
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      const ok = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '',
      })

      expect(ok).toBe(false)
    })
  })

  describe('rule writing on grant', () => {
    it('Allow once: no rule is written', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        // grantPatternId undefined = "Allow once"
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '',
      })

      const view = permissionStore.listAll(WS)
      expect(view.session).toHaveLength(0)
      expect(view.persisted).toHaveLength(0)
    })

    it('grantPatternId="exact" + no remember: writes session rule', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        grantPatternId: 'exact',
        rememberAcrossSessions: false,
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/foo.md',
        inputSummary: '',
      })

      const view = permissionStore.listAll(WS)
      expect(view.session).toHaveLength(1)
      expect(view.persisted).toHaveLength(0)
      expect(view.session[0].tool).toBe('read')
      expect(view.session[0].argPattern).toBe('/Users/alice/Desktop/foo.md')
    })

    it('grantPatternId + rememberAcrossSessions: writes persisted rule', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        grantPatternId: 'parent_dir',
        rememberAcrossSessions: true,
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: `${HOME_DESKTOP}/foo.md`,
        inputSummary: '',
      })

      const view = permissionStore.listAll(WS)
      expect(view.session).toHaveLength(0)
      expect(view.persisted).toHaveLength(1)
      expect(view.persisted[0].argPattern).toBe(`${HOME_DESKTOP}/`)
    })

    it('bash same_subcommand writes regex pattern', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        grantPatternId: 'same_subcommand',
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'bash',
        reason: 'high_risk_tool',
        bashCommand: 'git log --oneline',
        inputSummary: 'git log --oneline',
      })

      const view = permissionStore.listAll(WS)
      expect(view.session).toHaveLength(1)
      expect(view.session[0].argPattern).toBe('^git log( .*)?$')
    })
  })

  describe('bulk grant for readonly file tools', () => {
    it('bulkGrantGroup is populated for readonly file tools', async () => {
      let capturedReq: PermissionRequest | null = null
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => {
        capturedReq = req
        return { requestId: req.requestId, decision: 'rejected' }
      })
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: '/Users/alice/Desktop/x',
        inputSummary: '',
      })

      expect(capturedReq!.bulkGrantGroup).toEqual(['read', 'ls', 'glob', 'grep'])
    })

    it('bulkGrantGroup is undefined for bash', async () => {
      let capturedReq: PermissionRequest | null = null
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => {
        capturedReq = req
        return { requestId: req.requestId, decision: 'rejected' }
      })
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'bash',
        reason: 'high_risk_tool',
        bashCommand: 'ls /tmp',
        inputSummary: 'ls /tmp',
      })

      expect(capturedReq!.bulkGrantGroup).toBeUndefined()
    })

    it('bulkGrantTools writes rules for each selected tool', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        grantPatternId: 'parent_dir',
        rememberAcrossSessions: false,
        bulkGrantTools: ['read', 'ls', 'glob'],   // grep not included
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: `${HOME_DESKTOP}/x`,
        inputSummary: '',
      })

      const view = permissionStore.listAll(WS)
      const tools = view.session.map(r => r.tool).sort()
      expect(tools).toEqual(['glob', 'ls', 'read'])
      // All share the same pattern
      expect(new Set(view.session.map(r => r.argPattern))).toEqual(
        new Set([`${HOME_DESKTOP}/`])
      )
    })

    it('bulkGrantTools that are not in the readonly group are ignored', async () => {
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => ({
        requestId: req.requestId,
        decision: 'approved',
        grantPatternId: 'parent_dir',
        bulkGrantTools: ['read', 'write', 'edit'],   // write/edit should be rejected
      }))
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: `${HOME_DESKTOP}/x`,
        inputSummary: '',
      })

      const view = permissionStore.listAll(WS)
      const tools = view.session.map(r => r.tool).sort()
      // Only the primary tool (read) is granted; write/edit filtered out
      expect(tools).toEqual(['read'])
    })
  })

  describe('rule written on grant is immediately effective', () => {
    it('second call for same path does not re-prompt after grant', async () => {
      let promptCount = 0
      const promptUI = vi.fn(async (req: PermissionRequest): Promise<PermissionResponse> => {
        promptCount++
        return {
          requestId: req.requestId,
          decision: 'approved',
          grantPatternId: 'parent_dir',
        }
      })
      const port = createPermissionPort({ workspacePath: WS, promptUI })

      await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: `${HOME_DESKTOP}/a.md`,
        inputSummary: '',
      })
      expect(promptCount).toBe(1)

      // Second call to same dir — should be covered by the session rule
      const ok2 = await port({
        toolName: 'read',
        reason: 'path_outside_workspace',
        absPath: `${HOME_DESKTOP}/b.md`,
        inputSummary: '',
      })

      expect(ok2).toBe(true)
      expect(promptCount).toBe(1)   // still 1 — rule hit, no re-prompt
    })
  })
})
