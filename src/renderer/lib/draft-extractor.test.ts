import { describe, it, expect } from 'vitest'
import { detectDraftInText } from './draft-extractor'

describe('detectDraftInText (renderer-side)', () => {
  it('detects a valid ```json``` block with id field', () => {
    const text =
      '我提议这样定义：\n```json\n{ "id": "love-letter-writer", "name": "挽回助手" }\n```\n请确认。'
    const r = detectDraftInText(text)
    expect(r.detected).toBe(true)
    expect(r.profile?.id).toBe('love-letter-writer')
  })

  it('returns detected=false when no fenced block present', () => {
    const r = detectDraftInText('plain text without json block')
    expect(r.detected).toBe(false)
    expect(r.profile).toBeUndefined()
  })

  it('returns detected=false when JSON has no id field', () => {
    const r = detectDraftInText('```json\n{ "name": "x" }\n```')
    expect(r.detected).toBe(false)
  })

  it('picks the LAST valid block when multiple present (AC-007)', () => {
    const text =
      '草稿 v1：\n```json\n{ "id": "v1" }\n```\n反馈后：\n```json\n{ "id": "v2-final" }\n```'
    const r = detectDraftInText(text)
    expect(r.detected).toBe(true)
    expect(r.profile?.id).toBe('v2-final')
  })

  it('falls back to earlier block when last block is malformed', () => {
    const text = '```json\n{ "id": "good" }\n```\n```json\n{ broken json\n```'
    const r = detectDraftInText(text)
    expect(r.detected).toBe(true)
    expect(r.profile?.id).toBe('good')
  })
})
