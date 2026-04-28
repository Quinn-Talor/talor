import { describe, it, expect } from 'vitest'
import { BuiltinToolRegistry } from './builtin-registry'
import type { ToolDefinition } from '../tools/types'

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    riskLevel: 'LOW',
    execute: async () => ({ output: `${name} result` }),
  }
}

describe('BuiltinToolRegistry', () => {
  const tools = [makeTool('read'), makeTool('write'), makeTool('bash')]
  const registry = new BuiltinToolRegistry(tools)

  it('lists all registered tools', () => {
    const all = registry.listAll()
    expect(all).toHaveLength(3)
    expect(all.map(t => t.name)).toEqual(['read', 'write', 'bash'])
  })

  it('getTool returns a registered tool', () => {
    const tool = registry.getTool('read')
    expect(tool).toBeDefined()
    expect(tool!.name).toBe('read')
  })

  it('getTool returns undefined for unknown tool', () => {
    expect(registry.getTool('nonexistent')).toBeUndefined()
  })

  it('has returns true for registered, false for unknown', () => {
    expect(registry.has('read')).toBe(true)
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('size returns correct count', () => {
    expect(registry.size).toBe(3)
  })

  it('execute runs the tool and returns result', async () => {
    const result = await registry.execute('bash', {}, { sessionId: 's1', workspace: '/tmp' })
    expect(result.output).toBe('bash result')
  })

  it('execute throws for unknown tool', async () => {
    await expect(registry.execute('nope', {}, { sessionId: 's1', workspace: '' }))
      .rejects.toThrow('Builtin tool not found: nope')
  })

  it('ignores duplicate tool names during construction', () => {
    const dup = new BuiltinToolRegistry([makeTool('read'), makeTool('read')])
    expect(dup.size).toBe(1)
  })

  it('is immutable — no register method exists', () => {
    expect((registry as unknown as Record<string, unknown>).register).toBeUndefined()
  })
})
