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
