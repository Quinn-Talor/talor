import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { createInvestTools } from './index'
import { CardRepo, createCardTables } from '../store'

function store(): CardRepo {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createCardTables(db)
  return new CardRepo(db)
}

describe('createInvestTools', () => {
  it('返回 23 工具(14 compute + 9 card),name 唯一', () => {
    const tools = createInvestTools({ store: store() })
    expect(tools).toHaveLength(23)
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(23)
    for (const n of [
      'compute_red_flags',
      'compute_percentile',
      'reverse_dcf',
      'compute_trend',
      'check_falsification',
      'cross_check',
      'compute_macro_clock',
      'compute_industry_score',
      'compute_valuation',
      'compute_projection',
      'compute_dupont',
      'compute_decision',
      'compute_turnover',
      'compute_gate',
      'create_card',
      'get_card',
      'set_eligibility',
      'add_facts',
      'add_thesis',
      'add_checkpoint',
      'add_decision',
      'add_review',
      'get_timeline',
    ]) {
      expect(names).toContain(n)
    }
  })
})
