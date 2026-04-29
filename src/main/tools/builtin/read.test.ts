import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { toolRegistry } from '../registry'
import { registerBuiltinTools } from './read'

const TMP = join(__dirname, '__tmp_read_test__')

function makeContext(workspace = TMP) {
  return { sessionId: 'test-session', workspace }
}

beforeEach(() => {
  mkdirSync(TMP, { recursive: true })
  registerBuiltinTools()
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  toolRegistry.clear()
})

describe('read tool', () => {
  it('reads text file content', async () => {
    writeFileSync(join(TMP, 'hello.txt'), 'hello world')
    const result = await toolRegistry.execute('read', { path: 'hello.txt' }, makeContext())
    expect(result.output).toBe('hello world')
  })

  it('reads file via absolute path within workspace', async () => {
    writeFileSync(join(TMP, 'abs.txt'), 'abs content')
    const result = await toolRegistry.execute('read', { path: join(TMP, 'abs.txt') }, makeContext())
    expect(result.output).toBe('abs content')
  })

  it('returns error for file not found', async () => {
    const result = await toolRegistry.execute('read', { path: 'nonexistent.txt' }, makeContext())
    expect(result.output).toContain('not found')
  })

  it('returns error for path outside workspace', async () => {
    const result = await toolRegistry.execute('read', { path: '../outside.txt' }, makeContext())
    expect(result.output).toContain('Cannot access path outside workspace')
  })

  it('returns error when workspace not set', async () => {
    const result = await toolRegistry.execute('read', { path: 'file.txt' }, { sessionId: 'x', workspace: '' })
    expect(result.output).toContain('Workspace not set')
  })

  it('returns error for sensitive path', async () => {
    const result = await toolRegistry.execute('read', { path: '/etc/passwd' }, makeContext())
    expect(result.output).toBe('Cannot access sensitive system path')
  })

  it('returns error for file exceeding size limit', async () => {
    writeFileSync(join(TMP, 'big.txt'), 'x')
    const result = await toolRegistry.execute(
      'read',
      { path: 'big.txt' },
      { ...makeContext(), maxReadSizeBytes: 0 },
    )
    expect(result.output).toContain('too large')
  })

  it('returns error for binary file', async () => {
    const bin = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(join(TMP, 'image.png'), bin)
    const result = await toolRegistry.execute('read', { path: 'image.png' }, makeContext())
    expect(result.output).toBe('Cannot read binary file')
  })

  it('returns error for path traversal attack', async () => {
    const result = await toolRegistry.execute('read', { path: '../../etc/passwd' }, makeContext())
    expect(result.output).toContain('Cannot access')
  })

  it('blocks symlink pointing outside workspace', async () => {
    const { symlinkSync } = await import('fs')
    const linkPath = join(TMP, 'evil_link')
    try {
      symlinkSync('/etc', linkPath)
    } catch {
      return
    }
    const result = await toolRegistry.execute('read', { path: 'evil_link/passwd' }, makeContext())
    expect(result.output).toContain('Cannot access')
  })

  describe('requestPermission integration (needs_consent path)', () => {
    it('calls requestPermission for workspace-external paths; approved → file is read', async () => {
      // Write a fixture file OUTSIDE the workspace, then verify the port is
      // invoked and, on approval, read succeeds.
      const { mkdtempSync, writeFileSync: wfs, rmSync } = await import('fs')
      const { tmpdir } = await import('os')
      const outsideDir = mkdtempSync(join(tmpdir(), 'talor-read-outside-'))
      wfs(join(outsideDir, 'external.md'), 'external content')

      const requestPermission = async () => true
      const result = await toolRegistry.execute(
        'read',
        { path: join(outsideDir, 'external.md') },
        { ...makeContext(), requestPermission },
      )

      rmSync(outsideDir, { recursive: true, force: true })
      expect(result.output).toBe('external content')
    })

    it('calls requestPermission; denied → returns denial message; does not read', async () => {
      const { mkdtempSync, writeFileSync: wfs, rmSync } = await import('fs')
      const { tmpdir } = await import('os')
      const outsideDir = mkdtempSync(join(tmpdir(), 'talor-read-outside-'))
      wfs(join(outsideDir, 'secret.md'), 'SECRET')

      const requestPermission = async () => false
      const result = await toolRegistry.execute(
        'read',
        { path: join(outsideDir, 'secret.md') },
        { ...makeContext(), requestPermission },
      )

      rmSync(outsideDir, { recursive: true, force: true })
      expect(result.output).toContain('user denied')
      expect(result.output).not.toContain('SECRET')
    })

    it('absent requestPermission port → falls back to hard deny', async () => {
      // No port injected — the tool should refuse without trying anything else.
      const result = await toolRegistry.execute(
        'read',
        { path: '/tmp/anywhere.md' },
        makeContext(),   // no requestPermission
      )
      expect(result.output).toContain('Cannot access path outside workspace')
    })

    it('requestPermission is invoked with absPath + summary', async () => {
      interface Captured { toolName: string; absPath?: string; inputSummary: string; reason: string }
      let captured: Captured | null = null
      const requestPermission = async (input: Captured): Promise<boolean> => {
        captured = input
        return false
      }
      await toolRegistry.execute(
        'read',
        { path: '/tmp/peek.md' },
        { ...makeContext(), requestPermission } as any,   // cast: ctx extends ToolConfig; extra requestPermission allowed
      )
      expect(captured).not.toBeNull()
      expect(captured!.toolName).toBe('read')
      expect(captured!.reason).toBe('path_outside_workspace')
      expect(captured!.absPath).toBe('/tmp/peek.md')
      expect(captured!.inputSummary).toBe('/tmp/peek.md')
    })
  })
})
