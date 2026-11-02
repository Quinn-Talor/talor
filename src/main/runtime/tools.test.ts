import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import type { ToolCtx, ToolDef } from 'agent-engine'
import '../tools/builtin'
import { toolRegistry } from '../tools/registry'
import type { ToolDefinition } from '../tools/types'
import { accessOf, declaredPathPermission, toEngineTool } from './tools'

let workspace: string
let outside: string

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'talor-ws-'))
  outside = mkdtempSync(join(tmpdir(), 'talor-out-'))
  writeFileSync(join(workspace, 'a.txt'), 'inside')
  writeFileSync(join(outside, 'out.txt'), 'outside')
})

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function ctxFor(): ToolCtx {
  return {
    runId: 'r1',
    callId: 'c1',
    idempotencyKey: 'r1:c1',
    scope: { workspace },
    task: { subject: 's1' },
    signal: new AbortController().signal,
    spawn: () => Promise.reject(new Error('no spawn')),
    progress: () => {},
  }
}

function fakeTool(execute: ToolDefinition['execute']): ToolDef {
  return toEngineTool({
    name: 'fake',
    description: 'fake tool',
    parameters: {},
    zodSchema: z.object({}),
    execute,
  })
}

const builtin = (name: string): ToolDef => {
  const def = toolRegistry.listAll().find((t) => t.name === name)
  if (!def) throw new Error(`missing builtin ${name}`)
  return toEngineTool(def)
}

describe('toEngineTool output', () => {
  it('AC-005 keeps a tool error envelope as a deterministic engine error', async () => {
    const tool = fakeTool(async () => ({
      output: { __talor_error: true, code: 'FS_ERROR', message: 'boom', hint: 'retry later' },
    }))
    expect(await tool.execute({}, ctxFor())).toEqual({
      __agent_error: true,
      code: 'FS_ERROR',
      message: 'boom',
      hint: 'retry later',
      errorClass: 'deterministic',
    })
  })

  it('AC-005 turns a failure string into a deterministic TOOL_FAILED error', async () => {
    const tool = fakeTool(async () => ({ output: 'File not found: x' }))
    expect(await tool.execute({}, ctxFor())).toEqual({
      __agent_error: true,
      code: 'TOOL_FAILED',
      message: 'File not found: x',
      errorClass: 'deterministic',
    })
  })

  it('AC-005 reports an exception as a transient TOOL_EXCEPTION', async () => {
    const tool = fakeTool(async () => {
      throw new Error('crashed')
    })
    const out = (await tool.execute({}, ctxFor())) as Record<string, unknown>
    expect(out).toMatchObject({ __agent_error: true, code: 'TOOL_EXCEPTION' })
    expect(out).not.toHaveProperty('errorClass')
  })

  it('AC-005 serializes non-string output as JSON and keeps strings as they are', async () => {
    expect(await fakeTool(async () => ({ output: ['a', 'b'] })).execute({}, ctxFor())).toBe(
      '["a","b"]',
    )
    expect(await fakeTool(async () => ({ output: 'plain' })).execute({}, ctxFor())).toBe('plain')
  })
})

describe('toEngineTool safety and access', () => {
  it('AC-006 marks write, edit and bash as high risk with side effects', () => {
    for (const name of ['write', 'edit', 'bash']) {
      const tool = builtin(name)
      expect(tool.safety?.risk).toBe('high')
      expect(tool.execution?.effect).toBe('side_effect')
    }
    for (const name of ['read', 'ls', 'glob', 'grep']) {
      const tool = builtin(name)
      expect(tool.safety?.risk).toBe('low')
      expect(tool.execution?.effect).toBe('none')
    }
    expect(builtin('read').execution?.timeoutMs).toBe(35_000)
  })

  it('AC-006 declares the paths each tool reads or writes', () => {
    expect(accessOf('read', { path: 'a' })).toEqual({ read: ['a'] })
    expect(accessOf('ls', {})).toEqual({ read: ['.'] })
    expect(accessOf('grep', { pattern: 'x' })).toEqual({ read: ['.'] })
    expect(accessOf('grep', { pattern: 'x', path: 'src' })).toEqual({ read: ['src'] })
    expect(accessOf('glob', { pattern: '**/*.ts' })).toEqual({ read: ['.'] })
    expect(accessOf('write', { path: 'b', content: '' })).toEqual({ write: ['b'] })
    expect(accessOf('edit', { path: 'b' })).toEqual({ write: ['b'] })
    expect(accessOf('bash', { command: 'ls' })).toBeUndefined()
    expect(builtin('read').safety?.access?.({ path: 'a' })).toEqual({ read: ['a'] })
    expect(builtin('bash').safety?.access).toBeUndefined()
  })
})

describe('declaredPathPermission', () => {
  it('AC-007 lets a tool read a path outside the workspace that the call declared', async () => {
    const target = join(outside, 'out.txt')
    expect(await builtin('read').execute({ path: target }, ctxFor())).toBe('outside')
    expect(await builtin('read').execute({ path: 'a.txt' }, ctxFor())).toBe('inside')
  })

  it('AC-007 refuses paths the call did not declare', async () => {
    const allow = declaredPathPermission({ read: [join(outside, 'out.txt')] }, workspace)
    const request = (absPath: string) =>
      allow({ toolName: 'read', reason: 'path_outside_workspace', absPath, inputSummary: '' })
    expect(await request(join(outside, 'out.txt'))).toBe(true)
    expect(await request(join(outside, 'other.txt'))).toBe(false)
    expect(
      await allow({ toolName: 'bash', reason: 'high_risk_tool', inputSummary: 'rm -rf x' }),
    ).toBe(false)
  })
})

describe('toEngineTool validate', () => {
  it('AC-008 rejects a bash command writing outside the workspace before it runs', () => {
    const bash = builtin('bash')
    expect(bash.validate?.({ command: 'echo x > /opt/out.txt' }, ctxFor())).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    })
    expect(bash.validate?.({ command: 'echo x > out.txt' }, ctxFor())).toEqual({ ok: true })
  })
})

describe('declared tool timeout (A5b)', () => {
  it('AC-006 uses the timeout a tool declares and keeps the default otherwise', async () => {
    const seen: Array<number | undefined> = []
    const make = (timeoutMs?: number) =>
      toEngineTool({
        name: 'slow',
        description: 'slow tool',
        parameters: {},
        zodSchema: z.object({}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        execute: async (_input, context) => {
          seen.push(context.toolTimeoutMs)
          return { output: 'ok' }
        },
      })
    const declared = make(120_000)
    const plain = make()
    expect(declared.execution?.timeoutMs).toBe(125_000)
    expect(plain.execution?.timeoutMs).toBe(35_000)
    await declared.execute({}, ctxFor())
    await plain.execute({}, ctxFor())
    expect(seen).toEqual([120_000, 30_000])
  })
})
