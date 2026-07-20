// src/main/invest/feature.short-thesis.test.ts —— 空方·证伪官注册:read-only + PM 必备 subagent
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { investFeatureMain } from './feature'

describe('空方 agent 注册', () => {
  beforeEach(() => investFeatureMain.init({ db: new Database(':memory:') }))

  it('short-thesis 已注册且零写卡权(读/compute 保留)', () => {
    const agents = investFeatureMain.agents!()
    const st = agents.find((a) => a.profile.id === 'short-thesis')
    expect(st).toBeTruthy()
    const names = (st!.tools ?? []).map((t) => t.name)
    for (const w of [
      'create_card',
      'set_eligibility',
      'add_facts',
      'add_thesis',
      'add_checkpoint',
      'add_decision',
      'add_review',
    ]) {
      expect(names).not.toContain(w)
    }
    expect(names).toContain('get_card')
    expect(names).toContain('check_falsification')
    expect(names).toContain('reverse_dcf')
    expect(names).toContain('get_prior_lessons')
  })

  it('PM(stock-research)把 short-thesis 列为 subagent', () => {
    const pm = investFeatureMain.agents!().find((a) => a.profile.id === 'stock-research')!
    const ids = pm.profile.subagents?.ids?.map((r) => r.id) ?? []
    expect(ids).toContain('short-thesis')
  })
})
