// src/main/invest/tools/card-tools.schema.test.ts —— challenge 字段 + ReviewEvent 扩容(Zod 保留)
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createCardTools } from './card-tools'
import { CardRepo, createCardTables } from '../store'

function toolSchema(name: string) {
  const db = new Database(':memory:')
  createCardTables(db)
  const t = createCardTools(new CardRepo(db)).find((x) => x.name === name)
  if (!t?.zodSchema) throw new Error(`tool ${name} missing zodSchema`)

  return t.zodSchema as any
}

describe('schema: challenge + review 扩容(不被 strip)', () => {
  it('add_thesis 保留 challenge', () => {
    const parsed = toolSchema('add_thesis').safeParse({
      card_id: 'c1',
      snapshot: {
        v: 1,
        at: '2026-03',
        scope: '建立',
        claim: 'x',
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [],
          V: { bear: 1, base: 2, bull: 3 },
          margin_of_safety: { required: 0.2 },
        },
        challenge: {
          output: {
            target: 'thesis',
            weakest_assumption: 'co_share',
            refutation: 'r',
            suggested_verdict: '维持',
            severity: 'mid',
          },
          adjudication: { verdict: 'reject', note: 'n' },
        },
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data.snapshot.challenge?.output?.weakest_assumption).toBe('co_share')
    expect(parsed.data.snapshot.challenge?.adjudication?.verdict).toBe('reject')
  })

  it('add_facts 保留 Fact.cadence', () => {
    const parsed = toolSchema('add_facts').safeParse({
      card_id: 'c1',
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          cadence: 'quarterly',
          series: [{ value: '16%', as_of: '2026-03', source: '乘联会' }],
        },
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data.facts.co_share.cadence).toBe('quarterly')
  })

  it('add_facts 保留 provenance + basis(不被 strip)', () => {
    const parsed = toolSchema('add_facts').safeParse({
      card_id: 'c1',
      facts: {
        rev_yoy: {
          level: 'company',
          label: '营收增速',
          unit: '%',
          series: [
            {
              value: 3.46,
              as_of: '2026-03',
              source: '定期报告',
              tier: 'T2',
              basis: 'TTM',
              provenance: {
                method: 'fetch',
                channel: 'json:eastmoney',
                official_source: '定期报告',
                field: 'TOTALOPERATEREVETZ',
                retrieved_at: '2026-07-22T00:00:00.000Z',
              },
            },
          ],
        },
      },
    })
    expect(parsed.success).toBe(true)
    const obs = parsed.data.facts.rev_yoy.series[0]
    expect(obs.provenance?.method).toBe('fetch')
    expect(obs.provenance?.channel).toBe('json:eastmoney')
    expect(obs.provenance?.field).toBe('TOTALOPERATEREVETZ')
    expect(obs.basis).toBe('TTM')
  })

  it('add_review 保留 thesis_realized/attribution/ref_decisions', () => {
    const parsed = toolSchema('add_review').safeParse({
      card_id: 'c1',
      review: {
        type: '复盘',
        at: '2026-06',
        vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        thesis_realized: [{ assumption: 'co_share', outcome: '兑现' }],
        attribution: { correctness: '对', luck_skill: '能力', alpha_beta: 'alpha' },
        lesson: 'l',
        ref_v: 1,
        ref_decisions: ['d1'],
      },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data.review.thesis_realized).toHaveLength(1)
    expect(parsed.data.review.ref_decisions).toEqual(['d1'])
  })
})
