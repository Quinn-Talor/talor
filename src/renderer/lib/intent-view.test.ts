import { describe, it, expect } from 'vitest'
import { phaseMarker } from '@shared/turn-phase'
import { intentViewOf, proposalReply } from './intent-view'

const answer = phaseMarker('answer')
const call = (name: string, input: unknown, providerOptions: unknown = answer, id = 'c1') => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: name,
  input,
  ...(providerOptions ? { providerOptions } : {}),
})
const text = (t: string, providerOptions: unknown = answer) => ({
  type: 'text',
  text: t,
  providerOptions,
})
const row = (...parts: unknown[]) => JSON.stringify(parts)
const toolRow = (isError: boolean, id = 'c1') =>
  JSON.stringify([
    {
      type: 'tool-result',
      toolCallId: id,
      toolName: 'x',
      output: { type: 'text', value: 'ok' },
      isError,
    },
  ])

describe('intentViewOf', () => {
  it('AC-004 reads the intent of an answer row and ignores everything else', () => {
    const actions = [
      { tool: 'bash', input: { command: 'rm a.log' } },
      { tool: 'write', input: { path: 'b' } },
    ]
    expect(intentViewOf(row(call('finish', { summary: '完成' })))).toEqual({
      kind: 'finish',
      text: '',
      summary: '完成',
    })
    expect(
      intentViewOf(row(text('结果如下'), call('finish', { summary: '完成' })), toolRow(false)),
    ).toEqual({ kind: 'finish', text: '结果如下', summary: '完成' })
    expect(
      intentViewOf(row(call('ask_user', { question: '用哪个目录？', options: ['a', 'b'] }))),
    ).toEqual({ kind: 'ask_user', text: '', question: '用哪个目录？', options: ['a', 'b'] })
    expect(
      intentViewOf(row(call('propose', { summary: '清理日志', preview: '两步', actions }))),
    ).toEqual({ kind: 'propose', text: '', summary: '清理日志', preview: '两步', actions })
    expect(intentViewOf(row(call('report_blocked', { reason: '缺少权限' })))).toEqual({
      kind: 'report_blocked',
      text: '',
      reason: '缺少权限',
    })
    expect(intentViewOf(row(call('read', { path: 'a' })))).toBeNull()
    expect(intentViewOf(row(text('纯文本')))).toBeNull()

    expect(
      intentViewOf(row(call('ask_user', { question: 'q' }, phaseMarker('process')))),
    ).toBeNull()
    expect(intentViewOf(row(call('ask_user', { question: 'q' }, null)))).toBeNull()
    expect(intentViewOf(row(call('ask_user', { question: 'q' })), toolRow(true))).toBeNull()
  })

  it('tolerates bad JSON, missing options and non-object input', () => {
    expect(intentViewOf('not json')).toBeNull()
    expect(intentViewOf(JSON.stringify('text'))).toBeNull()
    expect(intentViewOf(row(call('ask_user', { question: 'q', options: [1] })))).toMatchObject({
      options: [],
    })
    expect(intentViewOf(row(call('finish', 'x')))).toEqual({
      kind: 'finish',
      text: '',
      summary: '',
    })
    expect(
      intentViewOf(row(call('ask_user', { question: 'q' })), toolRow(true, 'other')),
    ).toMatchObject({ kind: 'ask_user' })
  })
})

describe('proposalReply', () => {
  it('AC-005 builds the accept and reject replies', () => {
    const view = {
      kind: 'propose' as const,
      text: '',
      summary: '清理日志',
      preview: '',
      actions: [
        { tool: 'bash', input: { command: 'rm a.log' } },
        { tool: 'write', input: { path: 'b' } },
      ],
    }
    expect(proposalReply(view, true)).toBe(
      '确认执行提议：清理日志\n1. bash {"command":"rm a.log"}\n2. write {"path":"b"}',
    )
    expect(proposalReply(view, false)).toBe('不执行这个提议：清理日志')
  })
})
