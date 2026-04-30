import { describe, it, expect } from 'vitest'
import { diagnoseInputMismatch } from './input-diagnostics'

const bashParams = {
  type: 'object',
  required: ['command'],
  properties: {
    command: { type: 'string', description: 'Shell command to execute' },
    description: { type: 'string', description: 'Description of the command (optional)' },
  },
}

describe('diagnoseInputMismatch', () => {
  it('头条明确指出缺失哪个 required 字段', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, { cmd: 'ls' }, ['command'])
    expect(msg).toMatch(/^Invalid input for tool "bash": missing required parameter \[command\]\./)
  })

  it('列出模型实际传的字段 (关键诊断信息)', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, { cmd: 'ls', timeout: 30 }, ['command'])
    expect(msg).toMatch(/Provided fields: \[cmd, timeout\]/)
  })

  it('列出期望的 schema 含每字段的 type 和 required 标记', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, { cmd: 'ls' }, ['command'])
    expect(msg).toMatch(/Expected schema:/)
    expect(msg).toMatch(/- command \(string, required\)/)
    expect(msg).toMatch(/- description \(string, optional\)/)
  })

  it('对 cmd → command 给出 "Did you mean" 建议 (已知别名)', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, { cmd: 'ls' }, ['command'])
    expect(msg).toMatch(/Did you mean "command" instead of "cmd"\?/)
  })

  it('对 text → content 给出建议', () => {
    const params = {
      required: ['content'],
      properties: { content: { type: 'string' } },
    }
    const msg = diagnoseInputMismatch('write', params, { path: '/x', text: 'hi' }, ['content'])
    expect(msg).toMatch(/Did you mean "content" instead of "text"\?/)
  })

  it('对 path → filename 给出建议', () => {
    const params = {
      required: ['path'],
      properties: { path: { type: 'string' } },
    }
    const msg = diagnoseInputMismatch('read', params, { filename: '/x' }, ['path'])
    expect(msg).toMatch(/Did you mean "path" instead of "filename"\?/)
  })

  it('无任何已知别名或相近拼写时不给虚假建议', () => {
    const params = {
      required: ['content'],
      properties: { content: { type: 'string' } },
    }
    // "xyz" 跟 "content" 差太远,不该给建议
    const msg = diagnoseInputMismatch('write', params, { xyz: 1 }, ['content'])
    expect(msg).not.toMatch(/Did you mean/)
  })

  it('多个缺失字段一次性列出', () => {
    const params = {
      required: ['path', 'content'],
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
    }
    const msg = diagnoseInputMismatch('write', params, {}, ['path', 'content'])
    expect(msg).toMatch(/missing required parameters \[path, content\]/)
  })

  it('provided fields 为空时显示 (none)', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, {}, ['command'])
    expect(msg).toMatch(/Provided fields: \(none\)/)
  })

  it('input 是 null/非对象时也不崩溃', () => {
    const msg = diagnoseInputMismatch('bash', bashParams, null, ['command'])
    expect(msg).toMatch(/missing required parameter \[command\]/)
    expect(msg).toMatch(/Provided fields: \(none\)/)
  })
})
