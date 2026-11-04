import { describe, it, expect } from 'vitest'
import { RULES_CHANGED_NOTE, taskFor, userPartsOf, volatileOf } from './task'

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
    // 前文由引擎会话提供，任务不带 history
    expect(task.history).toBeUndefined()
  })

  it('AC-003 leaves out the scope and the step limit when they are not set', () => {
    const task = taskFor({
      sessionId: 's1',
      workspace: '',
      userContent: 'hi',
      maxSteps: 0,
      now,
    })

    expect(task.scope).toBeUndefined()
    expect(task.budget).toBeUndefined()
    expect((task.volatile![0]!.parts[0] as { text: string }).text).toContain('Workspace: (not set)')
  })

  it('tells the model when the permission rules changed since the previous turn', () => {
    const text = (rulesChanged?: boolean) =>
      (
        taskFor({
          sessionId: 's1',
          workspace: '/w',
          userContent: 'hi',
          now,
          rulesChanged,
        }).volatile![0]!.parts[0] as { text: string }
      ).text
    expect(text(true)).toContain(RULES_CHANGED_NOTE)
    expect(text(false)).not.toContain(RULES_CHANGED_NOTE)
    expect(text(undefined)).not.toContain(RULES_CHANGED_NOTE)
  })

  it('AC-008 puts each preface before the user input as its own segment', () => {
    const task = taskFor({
      sessionId: 's1',
      workspace: '/w',
      userContent: 'hi',
      preface: ['源对话快照', '更新'],
      now,
    })
    expect(task.input).toEqual([
      { role: 'user', parts: [{ type: 'text', text: '源对话快照' }] },
      { role: 'user', parts: [{ type: 'text', text: '更新' }] },
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ])
    expect(
      taskFor({ sessionId: 's1', workspace: '/w', userContent: 'hi', now }).input,
    ).toHaveLength(1)
  })

  it('maps user content and volatile notes', () => {
    expect(userPartsOf('hi')).toEqual([{ type: 'text', text: 'hi' }])
    expect(volatileOf('/w', now)[0]!.role).toBe('system')
  })
})
