// registry:metric_key → 有序多通道(MCP 优先 → 东财 json);字段实证于 fact-keys §六 + live 探测
import { describe, it, expect } from 'vitest'
import { getMetricSource } from './registry'

describe('取数 registry', () => {
  it('rev_yoy → 东财 report 通道(TOTALOPERATEREVETZ/REPORT_DATE)+ MCP 优先', () => {
    const s = getMetricSource('rev_yoy')!
    expect(s.cadence).toBe('quarterly')
    expect(s.channels[0].kind).toBe('mcp') // MCP-first
    const json = s.channels.find((c) => c.kind === 'json')!
    if (json.kind !== 'json' || json.vendor !== 'eastmoney-report') throw new Error('shape')
    expect(json.reportName).toBe('RPT_F10_FINANCE_MAINFINADATA')
    expect(json.valueField).toBe('TOTALOPERATEREVETZ')
    expect(json.asOfField).toBe('REPORT_DATE')
    expect(json.official_source).toBe('定期报告')
    expect(json.tier).toBe('T2')
  })
  it('price → 东财 push2 f43(scale 0.01)+ MCP 优先', () => {
    const s = getMetricSource('price')!
    expect(s.cadence).toBe('daily')
    expect(s.sanity?.min).toBe(0)
    expect(s.channels[0].kind).toBe('mcp')
    const q = s.channels.find((c) => c.kind === 'json')!
    if (q.kind !== 'json' || q.vendor !== 'eastmoney-quote') throw new Error('shape')
    expect(q.valueField).toBe('f43')
    expect(q.scale).toBe(0.01)
  })
  it('gross_margin sanity 上界 100(挡越界)', () => {
    expect(getMetricSource('gross_margin')!.sanity?.max).toBe(100)
  })
  it('未映射 key(同店)→ null', () => {
    expect(getMetricSource('same_store')).toBeNull()
  })
})
