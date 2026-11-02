import { describe, it, expect } from 'vitest'
import { phaseMarker, phaseOfParts } from './turn-phase'

describe('turn phase markers', () => {
  it('builds the marker stored on text and tool-call parts', () => {
    expect(phaseMarker('process')).toEqual({ talor: { phase: 'process' } })
    expect(phaseMarker('answer')).toEqual({ talor: { phase: 'answer' } })
  })

  it('reads the phase from the first marked text or tool-call part', () => {
    expect(
      phaseOfParts([
        { type: 'reasoning', text: 'x', providerOptions: { talor: { phase: 'process' } } },
        { type: 'tool-call', toolCallId: 'c', providerOptions: phaseMarker('answer') },
      ]),
    ).toBe('answer')
    expect(
      phaseOfParts([{ type: 'text', text: 'a', providerOptions: phaseMarker('process') }]),
    ).toBe('process')
  })

  it('returns null for rows without a valid marker', () => {
    expect(phaseOfParts([{ type: 'text', text: 'legacy' }])).toBeNull()
    expect(
      phaseOfParts([{ type: 'text', text: 'a', providerOptions: { talor: { phase: 'other' } } }]),
    ).toBeNull()
    expect(phaseOfParts([null, 'x', { type: 'text', providerOptions: null }])).toBeNull()
    expect(phaseOfParts([])).toBeNull()
  })
})
