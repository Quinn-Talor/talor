// fetch_metric:有序试通道(MCP 优先)→ 抽值 + REPORT_DATE 派生 → sanity → 盖 provenance(mock 通道 + 固定 clock)
import { describe, it, expect } from 'vitest'
import { fetchMetric } from './fetch-metric'
import type { FactObservation } from '../../../shared/types/invest'

const CLOCK = (): Date => new Date('2026-07-22T00:00:00.000Z')
const isEnv = (o: unknown): boolean =>
  typeof o === 'object' && o !== null && (o as { __talor_error?: boolean }).__talor_error === true
const obs = (o: unknown): FactObservation => o as FactObservation

describe('fetch_metric(单权威源 + sanity)', () => {
  it('(AC-003) json 财报 → value + as_of=REPORT_DATE 归一 + provenance + T2', async () => {
    const fetchJson = async (): Promise<unknown> => ({
      result: {
        data: [
          { SECUCODE: '002594.SZ', REPORT_DATE: '2026-03-31 00:00:00', TOTALOPERATEREVETZ: 3.46 },
        ],
      },
    })
    const r = await fetchMetric(
      { code: '002594', metric_key: 'rev_yoy' },
      { fetchJson, clock: CLOCK },
    )
    expect(isEnv(r)).toBe(false)
    const o = obs(r)
    expect(o.value).toBe(3.46)
    expect(o.as_of).toBe('2026-03')
    expect(o.tier).toBe('T2')
    expect(o.source).toBe('定期报告')
    expect(o.provenance?.method).toBe('fetch')
    expect(o.provenance?.channel).toBe('json:eastmoney')
    expect(o.provenance?.field).toBe('TOTALOPERATEREVETZ')
    expect(o.provenance?.retrieved_at).toBe('2026-07-22T00:00:00.000Z')
  })

  it('(AC-004) MCP 优先:callMcp 提供→用 MCP(T1);缺省→回落 json(T2)', async () => {
    const fetchJson = async (): Promise<unknown> => ({
      result: { data: [{ REPORT_DATE: '2026-03-31', TOTALOPERATEREVETZ: 3.46 }] },
    })
    const callMcp = async (): Promise<unknown> => ({
      TOTALOPERATEREVETZ: 9.99,
      end_date: '2026-03-31',
    })
    const withMcp = obs(
      await fetchMetric(
        { code: '002594', metric_key: 'rev_yoy' },
        { fetchJson, callMcp, clock: CLOCK },
      ),
    )
    expect(withMcp.value).toBe(9.99)
    expect(withMcp.tier).toBe('T1')
    expect(withMcp.provenance?.channel).toBe('mcp:financial.report')
    const noMcp = obs(
      await fetchMetric({ code: '002594', metric_key: 'rev_yoy' }, { fetchJson, clock: CLOCK }),
    )
    expect(noMcp.value).toBe(3.46)
    expect(noMcp.tier).toBe('T2')
  })

  it('(AC-005) sanity 越界(gross_margin=500%)→ METRIC_VALUE_INSANE(不写)', async () => {
    const fetchJson = async (): Promise<unknown> => ({
      result: { data: [{ REPORT_DATE: '2026-03-31', XSMLL: 500 }] },
    })
    const r = await fetchMetric(
      { code: '002594', metric_key: 'gross_margin' },
      { fetchJson, clock: CLOCK },
    )
    expect(isEnv(r)).toBe(true)
    expect((r as { code: string }).code).toBe('METRIC_VALUE_INSANE')
  })

  it('(AC-006) 全通道不可达(fetchJson 抛 + callMcp 缺省)→ METRIC_UNAVAILABLE', async () => {
    const fetchJson = async (): Promise<unknown> => {
      throw new Error('network')
    }
    const r = await fetchMetric(
      { code: '002594', metric_key: 'rev_yoy' },
      { fetchJson, clock: CLOCK },
    )
    expect(isEnv(r)).toBe(true)
    expect((r as { code: string }).code).toBe('METRIC_UNAVAILABLE')
  })

  it('未映射 key(同店)→ METRIC_UNAVAILABLE', async () => {
    const r = await fetchMetric(
      { code: '002594', metric_key: 'same_store' },
      { fetchJson: async () => ({}), clock: CLOCK },
    )
    expect((r as { code: string }).code).toBe('METRIC_UNAVAILABLE')
  })

  it('price → push2 f43 × 0.01,as_of=取数日', async () => {
    const fetchJson = async (): Promise<unknown> => ({ data: { f43: 9099 } })
    const o = obs(
      await fetchMetric({ code: '002594', metric_key: 'price' }, { fetchJson, clock: CLOCK }),
    )
    expect(o.value).toBeCloseTo(90.99)
    expect(o.as_of).toBe('2026-07-22')
    expect(o.tier).toBe('T2')
  })
})
