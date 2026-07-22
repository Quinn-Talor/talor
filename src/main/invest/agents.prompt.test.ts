// A1 取数纪律纠偏:数值主路 = fetch_metric(非浏览器检索);数值禁手抄/爬
import { describe, it, expect } from 'vitest'
import { INVEST_SEED_AGENTS } from './agents'

const main = INVEST_SEED_AGENTS.find((a) => a.id === 'stock-research')!.agentPrompt

describe('取数纪律 prompt(A1 纠偏)', () => {
  it('(AC-001) 数值主路 = fetch_metric,旧"浏览器检索主路"句已移除', () => {
    expect(main).toContain('数值主路')
    expect(main).toContain('fetch_metric')
    expect(main).not.toContain('取数主路 = **浏览器检索')
  })
  it('(AC-001) 明确数值禁手抄/爬 + 手填立不了命门', () => {
    expect(main).toMatch(/禁手抄|禁 bash|爬取/)
    expect(main).toContain('立不了命门')
  })
})
