import { describe, it, expect } from 'vitest'
import { DEFAULT_TRACE_CONFIG, resolveTraceConfig, toToolDurationMap } from './trace'

describe('resolveTraceConfig', () => {
  it('AC-029: falls back to defaults for missing or invalid fields, keeps valid values', () => {
    expect(resolveTraceConfig(undefined)).toEqual({
      enabled: true,
      retentionDays: 30,
      maxPayloadBytes: 1048576,
    })
    expect(resolveTraceConfig({ enabled: false, retentionDays: -1, maxPayloadBytes: 10 })).toEqual({
      enabled: false,
      retentionDays: 30,
      maxPayloadBytes: 1048576,
    })
    expect(resolveTraceConfig({ enabled: true, retentionDays: 7, maxPayloadBytes: 4096 })).toEqual({
      enabled: true,
      retentionDays: 7,
      maxPayloadBytes: 4096,
    })
  })

  it('rejects non-object input, non-boolean enabled and non-integer numbers', () => {
    expect(resolveTraceConfig(null)).toEqual(DEFAULT_TRACE_CONFIG)
    expect(resolveTraceConfig('on')).toEqual(DEFAULT_TRACE_CONFIG)
    expect(
      resolveTraceConfig({ enabled: 'no', retentionDays: 1.5, maxPayloadBytes: '4096' }),
    ).toEqual(DEFAULT_TRACE_CONFIG)
    expect(resolveTraceConfig({ retentionDays: 0, maxPayloadBytes: 1024 })).toEqual({
      enabled: true,
      retentionDays: 0,
      maxPayloadBytes: 1024,
    })
  })

  it('returns a fresh object (callers may mutate it)', () => {
    const a = resolveTraceConfig(undefined)
    a.enabled = false
    expect(resolveTraceConfig(undefined).enabled).toBe(true)
    expect(DEFAULT_TRACE_CONFIG.enabled).toBe(true)
  })
})

describe('toToolDurationMap', () => {
  it('AC-026: maps tool_call_id → duration_ms; later rows win on duplicate keys', () => {
    expect(toToolDurationMap([{ tool_call_id: 'call-1', duration_ms: 412 }])).toEqual({
      'call-1': 412,
    })
    expect(
      toToolDurationMap([
        { tool_call_id: 'call-1', duration_ms: 1 },
        { tool_call_id: 'call-1', duration_ms: 2 },
      ]),
    ).toEqual({ 'call-1': 2 })
  })

  it('drops rows with an empty id or a negative / non-finite duration', () => {
    expect(
      toToolDurationMap([
        { tool_call_id: '', duration_ms: 5 },
        { tool_call_id: 'neg', duration_ms: -1 },
        { tool_call_id: 'nan', duration_ms: Number.NaN },
        { tool_call_id: 'ok', duration_ms: 0 },
      ]),
    ).toEqual({ ok: 0 })
  })
})
