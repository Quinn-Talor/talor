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
    expect(result.output).toBe('Cannot access path outside workspace')
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
})
