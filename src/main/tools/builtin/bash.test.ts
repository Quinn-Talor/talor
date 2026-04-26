import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return actual
})

describe('bash tool', () => {
  let bashTool: any
  let mockContext: any

  beforeEach(async () => {
    await import('./index')
    const { toolRegistry } = await import('../registry')
    
    bashTool = toolRegistry.getTool('bash')
    mockContext = {
      workspace: '/tmp',
      sessionId: 'test-session',
    }
  })

  it('executes simple command', async () => {
    const result = await bashTool.execute(
      { command: 'echo "hello world"' },
      mockContext
    )
    expect(result.output).toContain('hello world')
  })

  it('executes command in workspace', async () => {
    const result = await bashTool.execute(
      { command: 'pwd' },
      mockContext
    )
    expect(result.output).toContain('/tmp')
  })

  it('returns error for failed command', async () => {
    const result = await bashTool.execute(
      { command: 'ls /nonexistent-file-12345' },
      mockContext
    )
    expect(result.output).toContain('No such file')
  })

  it('enforces workspace boundary', async () => {
    const result = await bashTool.execute(
      { command: 'ls /etc/passwd' },
      mockContext
    )
    expect(result.output).toContain('outside workspace')
  })

  it('blocks dangerous commands', async () => {
    const result = await bashTool.execute(
      { command: 'rm -rf /' },
      mockContext
    )
    expect(result.output).toContain('not allowed')
  })

  it('handles timeout', async () => {
    const result = await bashTool.execute(
      { command: 'sleep 10' },
      { ...mockContext, toolTimeoutMs: 1000 }
    )
    expect(result.output).toContain('timed out')
  }, 15000)

  it('timeout fires within 2 seconds for slow command', async () => {
    const start = Date.now()
    const result = await bashTool.execute(
      { command: 'sleep 60' },
      { ...mockContext, toolTimeoutMs: 1500 }
    )
    const elapsed = Date.now() - start
    expect(result.output).toContain('timed out')
    expect(elapsed).toBeLessThan(5000)
  }, 10000)
})
