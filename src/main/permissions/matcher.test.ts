import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
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

import { matchRules } from './matcher'
import { permissionStore } from './permission-store'

const WS = '/Users/alice/projects/foo'

describe('matchRules', () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'talor-match-test-'))
    permissionStore._resetForTests()
  })

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true })
  })

  describe('unknown when no rules', () => {
    it('returns unknown for bash', () => {
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: 'ls' })
      expect(r.decision).toBe('unknown')
    })

    it('returns unknown for read', () => {
      const r = matchRules({ workspacePath: WS, toolName: 'read', absPath: '/tmp/x' })
      expect(r.decision).toBe('unknown')
    })
  })

  describe('bash rules', () => {
    it('regex matches command', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'bash', argPattern: '^git log( .*)?$', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: 'git log --oneline' })
      expect(r.decision).toBe('allow')
    })

    it('same binary but different subcommand does not match', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'bash', argPattern: '^git log( .*)?$', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: 'git push origin' })
      expect(r.decision).toBe('unknown')
    })

    it('malformed regex → treated as non-match', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'bash', argPattern: '^(unclosed', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: 'anything' })
      expect(r.decision).toBe('unknown')
    })

    it('command is trimmed before matching', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'bash', argPattern: '^ls$', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: '   ls   ' })
      expect(r.decision).toBe('allow')
    })
  })

  describe('path rules', () => {
    it('directory prefix (trailing /) matches nested files', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'read', absPath: '/Users/alice/Desktop/a/b/c.md' })
      expect(r.decision).toBe('allow')
    })

    it('directory prefix does NOT match sibling with same stem', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desk/', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'read', absPath: '/Users/alice/Desktop/x.md' })
      expect(r.decision).toBe('unknown')
    })

    it('exact path (no trailing /) requires equality', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/foo.md', effect: 'allow',
      })
      expect(matchRules({ workspacePath: WS, toolName: 'read', absPath: '/Users/alice/foo.md' }).decision).toBe('allow')
      expect(matchRules({ workspacePath: WS, toolName: 'read', absPath: '/Users/alice/foo.md.bak' }).decision).toBe('unknown')
    })

    it('rule for read does not grant ls access', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/x/', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'ls', absPath: '/x/' })
      expect(r.decision).toBe('unknown')
    })
  })

  describe('deny-first precedence', () => {
    it('deny wins even when allow also matches', () => {
      permissionStore.addPersistedRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/', effect: 'allow',
      })
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/private/', effect: 'deny',
      })
      const r = matchRules({
        workspacePath: WS, toolName: 'read',
        absPath: '/Users/alice/Desktop/private/secret.md',
      })
      expect(r.decision).toBe('deny')
    })

    it('allow applies when no deny rule matches', () => {
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Desktop/', effect: 'allow',
      })
      permissionStore.addSessionRule(WS, {
        tool: 'read', argPattern: '/Users/alice/Secrets/', effect: 'deny',
      })
      const r = matchRules({
        workspacePath: WS, toolName: 'read',
        absPath: '/Users/alice/Desktop/public.md',
      })
      expect(r.decision).toBe('allow')
    })
  })

  describe('session + persisted both participate', () => {
    it('persisted rule alone matches', () => {
      permissionStore.addPersistedRule(WS, {
        tool: 'bash', argPattern: '^npm test$', effect: 'allow',
      })
      const r = matchRules({ workspacePath: WS, toolName: 'bash', bashCommand: 'npm test' })
      expect(r.decision).toBe('allow')
    })

    it('workspace isolation: rule in WS1 does not match WS2', () => {
      permissionStore.addSessionRule('/ws1', {
        tool: 'bash', argPattern: '^ls$', effect: 'allow',
      })
      const r = matchRules({ workspacePath: '/ws2', toolName: 'bash', bashCommand: 'ls' })
      expect(r.decision).toBe('unknown')
    })
  })
})
