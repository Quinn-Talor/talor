import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'agent-engine'
import type { ChatMessage } from '../repos/session-repo'
import { historyOf, taskFor, userPartsOf, volatileOf } from './task'

const resultsOf = (message: ModelMessage | undefined) => {
  if (message?.role !== 'tool') throw new Error(`expected a tool message, got ${message?.role}`)
  return message.content
}

let seq = 0
const row = (role: ChatMessage['role'], content: unknown): ChatMessage => ({
  id: `m${++seq}`,
  session_id: 's1',
  role,
  content: JSON.stringify(content),
  agent_id: '__chat__',
  created_at: '2026-10-31T00:00:00.000Z',
})

const call = (id: string, name = 'read') => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input: { path: 'a' },
})
const result = (id: string, value: string, name = 'read') => ({
  type: 'tool-result',
  toolCallId: id,
  toolName: name,
  output: { type: 'text', value },
  isError: false,
})

describe('historyOf', () => {
  it('AC-001 converts every role and part type', () => {
    const history = historyOf([
      row('system', [{ type: 'text', text: 'note' }]),
      row('user', 'hi'),
      row('user', [
        { type: 'text', text: 'see' },
        { type: 'image', image: 'data:image/png;base64,AAA' },
        { type: 'file', data: 'BBB', mediaType: 'application/pdf' },
      ]),
      row('assistant', [
        { type: 'reasoning', text: 'think', providerOptions: { anthropic: { signature: 'sig' } } },
        { type: 'text', text: 'checking' },
        call('c1'),
        call('c2', 'glob'),
        call('c3', 'grep'),
      ]),
      row('tool', [
        result('c1', 'body'),
        {
          type: 'tool-result',
          toolCallId: 'c2',
          toolName: 'glob',
          output: { type: 'json', value: ['a', 'b'] },
          isError: false,
        },
        {
          type: 'tool-result',
          toolCallId: 'c3',
          toolName: 'grep',
          output: { type: 'error-text', value: 'bad regex' },
        },
      ]),
      row('assistant', 'done'),
    ])

    expect(history).toEqual([
      { role: 'system', content: 'note' },
      { role: 'user', content: 'hi' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see' },
          { type: 'image', image: 'data:image/png;base64,AAA' },
          { type: 'file', data: 'BBB', mediaType: 'application/pdf' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think', providerData: { anthropic: { signature: 'sig' } } },
          { type: 'text', text: 'checking' },
          { type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: { path: 'a' } },
          { type: 'tool-call', toolCallId: 'c2', toolName: 'glob', input: { path: 'a' } },
          { type: 'tool-call', toolCallId: 'c3', toolName: 'grep', input: { path: 'a' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'read',
            output: 'body',
            isError: false,
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'glob',
            output: '["a","b"]',
            isError: false,
          },
          {
            type: 'tool-result',
            toolCallId: 'c3',
            toolName: 'grep',
            output: 'bad regex',
            isError: true,
          },
        ],
      },
      { role: 'assistant', content: 'done' },
    ])
  })

  it('AC-002 repairs tool calls without results and drops orphan results', () => {
    const history = historyOf([
      row('user', 'go'),
      row('assistant', [call('c1'), call('c2')]),
      row('tool', [result('c2', 'second')]),
      row('tool', [result('x9', 'orphan')]),
      row('assistant', [{ type: 'text', text: 'again' }, call('c3')]),
    ])

    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool'])
    const firstResults = resultsOf(history[2])
    expect(firstResults.map((r) => r.toolCallId)).toEqual(['c1', 'c2'])
    expect(firstResults[0]).toMatchObject({ isError: true })
    expect(firstResults[0]!.output).toContain('TOOL_MISSING_RESULT')
    expect(firstResults[1]).toMatchObject({ output: 'second', isError: false })
    const lastResults = resultsOf(history[4])
    expect(lastResults).toHaveLength(1)
    expect(lastResults[0]).toMatchObject({ toolCallId: 'c3', isError: true })
  })

  it('keeps unparseable content as a plain string', () => {
    const broken: ChatMessage = { ...row('user', ''), content: 'not json' }
    expect(historyOf([broken])).toEqual([{ role: 'user', content: 'not json' }])
  })
})

describe('taskFor', () => {
  const now = new Date(2026, 9, 31, 10, 0, 0)

  it('AC-003 builds the input, volatile notes, scope, subject and budget', () => {
    const task = taskFor({
      sessionId: 's1',
      workspace: '/w',
      userContent: [
        { type: 'text', text: '你好' },
        { type: 'image', image: 'data:image/png;base64,AAA' },
      ],
      history: [{ role: 'user', content: 'earlier' }],
      maxSteps: 20,
      now,
    })

    expect(task.input).toEqual([
      {
        role: 'user',
        parts: [
          { type: 'text', text: '你好' },
          { type: 'image', image: 'data:image/png;base64,AAA' },
        ],
      },
    ])
    const note = (task.volatile![0]!.parts[0] as { text: string }).text
    expect(note).toContain('Current date: 2026-10-31')
    expect(note).toContain(`Operating system: ${process.platform}`)
    expect(note).toContain('Workspace: /w')
    expect(task.scope).toEqual({ workspace: '/w' })
    expect(task.subject).toBe('s1')
    expect(task.budget).toEqual({ maxSteps: 20 })
    expect(task.history).toEqual([{ role: 'user', content: 'earlier' }])
  })

  it('AC-003 leaves out the scope and the step limit when they are not set', () => {
    const task = taskFor({
      sessionId: 's1',
      workspace: '',
      userContent: 'hi',
      history: [],
      maxSteps: 0,
      now,
    })

    expect(task.scope).toBeUndefined()
    expect(task.budget).toBeUndefined()
    expect((task.volatile![0]!.parts[0] as { text: string }).text).toContain('Workspace: (not set)')
  })

  it('maps user content and volatile notes', () => {
    expect(userPartsOf('hi')).toEqual([{ type: 'text', text: 'hi' }])
    expect(volatileOf('/w', now)[0]!.role).toBe('system')
  })
})

describe('historyOf skips notices (A5a)', () => {
  it('AC-005 leaves notice rows out of the model history', () => {
    const notice = {
      ...row('assistant', [{ type: 'text', text: 'NOTICE' }]),
      content_type: 'notice' as const,
    }
    const history = historyOf([row('user', 'hi'), notice, row('assistant', 'hello')])
    expect(history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ])
  })
})
