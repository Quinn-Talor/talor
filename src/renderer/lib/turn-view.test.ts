import { describe, it, expect } from 'vitest'
import { phaseMarker } from '@shared/turn-phase'
import { assistantView, stepPreview } from './turn-view'

const row = (parts: unknown) => JSON.stringify(parts)

describe('assistantView', () => {
  it('AC-007 reads the phase, text and reasoning of an assistant row', () => {
    expect(
      assistantView(row([{ type: 'text', text: '过程', providerOptions: phaseMarker('process') }])),
    ).toEqual({ phase: 'process', text: '过程', reasoning: '' })
    expect(
      assistantView(
        row([
          { type: 'reasoning', text: '甲' },
          { type: 'reasoning', text: '乙' },
          { type: 'text', text: '答复', providerOptions: phaseMarker('answer') },
        ]),
      ),
    ).toEqual({ phase: 'answer', text: '答复', reasoning: '甲\n乙' })
    expect(
      assistantView(
        row([
          { type: 'reasoning', text: '丙' },
          { type: 'text', text: '旧' },
        ]),
      ),
    ).toEqual({ phase: null, text: '旧', reasoning: '丙' })
    expect(assistantView(JSON.stringify('纯字符串'))).toEqual({
      phase: null,
      text: '纯字符串',
      reasoning: '',
    })
    expect(
      assistantView(
        row([{ type: 'tool-call', toolCallId: 'c', providerOptions: phaseMarker('answer') }]),
      ),
    ).toEqual({ phase: 'answer', text: '', reasoning: '' })
  })

  it('AC-007 falls back to the raw content when it is not a JSON array', () => {
    expect(assistantView('not json')).toEqual({ phase: null, text: 'not json', reasoning: '' })
    expect(assistantView('{"a":1}')).toEqual({ phase: null, text: '{"a":1}', reasoning: '' })
  })
})

describe('stepPreview', () => {
  it('AC-001 trims and cuts long text with an ellipsis, keeps short text whole', () => {
    expect(stepPreview('a'.repeat(100), 80)).toBe(`${'a'.repeat(80)}…`)
    expect(stepPreview('abc', 80)).toBe('abc')
    expect(stepPreview('  x  ', 80)).toBe('x')
  })
})
