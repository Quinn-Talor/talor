import { describe, it, expect } from 'vitest'
import type { ToolExecuteContext } from '../../tools/types'
import { createComputeTools } from './compute-tools'

const ctx = {} as ToolExecuteContext // compute 工具不依赖 context

function get(name: string) {
  const t = createComputeTools().find((x) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

describe('createComputeTools', () => {
  it('返回 14 个工具,名称齐全', () => {
    const names = createComputeTools().map((t) => t.name)
    expect(names).toEqual([
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
    ])
  })

  it('每个工具有 zodSchema + parameters(JSON Schema)', () => {
    for (const t of createComputeTools()) {
      expect(t.zodSchema).toBeDefined()
      expect(t.parameters).toBeTypeOf('object')
    }
  })

  it('compute_red_flags 返回 8 红灯', async () => {
    const { output } = await get('compute_red_flags').execute(
      {
        ocf: 50,
        net_income: 50,
        deducted_ni_history: [10, 8],
        rev_yoy: 30,
        ar_yoy: 30,
        inv_yoy: 30,
        goodwill: 10,
        equity: 100,
        interest_debt: 30,
        total_assets: 100,
        cash: 30,
        audit_nonstandard: false,
      },
      ctx,
    )
    expect(output).toHaveLength(8)
  })

  it('compute_percentile ≤口径', async () => {
    const { output } = await get('compute_percentile').execute(
      { series: [10, 20, 30, 40, 50], current: 30 },
      ctx,
    )
    expect(output).toBeCloseTo(0.6, 5)
  })

  it('compute_trend 返回 windows + momentum', async () => {
    const { output } = await get('compute_trend').execute(
      { series: [10, 11, 12, 13], windows: [1, 2] },
      ctx,
    )
    expect((output as { windows: unknown[] }).windows).toHaveLength(2)
    expect(output).toHaveProperty('momentum')
  })

  it('check_falsification 阈破信号', async () => {
    const { output } = await get('check_falsification').execute(
      { rule: { metric: 'gm', op: '<', value: 40, persistence: 2 }, series: [38, 39, 42] },
      ctx,
    )
    expect((output as { triggered: boolean }).triggered).toBe(true)
  })

  it('compute_macro_clock 定位象限 + 权益态度', async () => {
    const { output } = await get('compute_macro_clock').execute(
      { growth: { pmi: 52, pmi_trend: 'up' }, inflation: { ppi_trend: 'down' } },
      ctx,
    )
    const r = output as { quadrant: string; equity_stance: string; favored_asset: string }
    expect(r.quadrant).toBe('复苏')
    expect(r.equity_stance).toBe('重配')
    expect(r.favored_asset).toBe('股票')
  })

  it('compute_industry_score 6 维信号 + 汇总', async () => {
    const { output } = await get('compute_industry_score').execute(
      {
        demand: { penetration_pct: 12, growth_pct: 25 },
        price_inventory: { price_trend: 'down' },
        policy: { stance: 'support' },
      },
      ctx,
    )
    const r = output as { dimensions: unknown[]; overall: string }
    expect(r.dimensions).toHaveLength(3)
    expect(r.overall).toBe('up') // 2 good(需求/政策) vs 1 bad(价格)
  })

  it('compute_valuation pe 三情景 + 概率加权期望', async () => {
    const { output } = await get('compute_valuation').execute(
      {
        method: 'pe',
        scenarios: [
          { label: '悲观', prob: 0.3, eps: 11.7, pe: 18 },
          { label: '中性', prob: 0.5, eps: 12.8, pe: 22 },
          { label: '乐观', prob: 0.2, eps: 13.6, pe: 26 },
        ],
      },
      ctx,
    )
    const r = output as { scenarios: { value: number }[]; expected: number }
    expect(r.scenarios).toHaveLength(3)
    expect(r.expected).toBeCloseTo(0.3 * 11.7 * 18 + 0.5 * 12.8 * 22 + 0.2 * 13.6 * 26, 6)
  })

  it('compute_valuation pb-roe 用 ROE 折算合理 PB', async () => {
    const { output } = await get('compute_valuation').execute(
      {
        method: 'pb-roe',
        scenarios: [{ label: '中性', prob: 1, bvps: 10, roe: 0.18, g: 0.05, discount: 0.1 }],
      },
      ctx,
    )
    const r = output as { scenarios: { value: number }[] }
    expect(r.scenarios[0].value).toBeCloseTo((10 * (0.18 - 0.05)) / (0.1 - 0.05), 6)
  })

  it('compute_projection 自下而上 EPS 测算', async () => {
    const { output } = await get('compute_projection').execute(
      {
        base_revenue: 1000,
        industry_growth_pct: 15,
        share_delta_pct: 5,
        net_margin_pct: 12,
        shares: 100,
      },
      ctx,
    )
    const r = output as { end_eps: number; years: unknown[] }
    expect(r.years).toHaveLength(1)
    expect(r.end_eps).toBeCloseTo(1.449, 6)
  })

  it('compute_projection 不触发: 股本≤0 → null', async () => {
    const { output } = await get('compute_projection').execute(
      {
        base_revenue: 1000,
        industry_growth_pct: 15,
        share_delta_pct: 5,
        net_margin_pct: 12,
        shares: 0,
      },
      ctx,
    )
    expect((output as { end_eps: number | null }).end_eps).toBeNull()
  })

  it('compute_dupont 三因子拆解 + 主驱动', async () => {
    const { output } = await get('compute_dupont').execute(
      { net_income: 18, revenue: 100, total_assets: 200, equity: 100 },
      ctx,
    )
    const r = output as { roe: number; driver: string }
    expect(r.roe).toBeCloseTo(0.18, 6)
    expect(r.driver).toBe('leverage') // 乘数−1=1 最大
  })

  it('compute_decision 好公司好价格 → 买 + 仓位反推', async () => {
    const { output } = await get('compute_decision').execute(
      { quality: 'good', valuation_state: 'cheap', max_loss_pct: 20 },
      ctx,
    )
    const r = output as { action: string; matrix_cell: string; suggested_position_pct: number }
    expect(r.action).toBe('买')
    expect(r.matrix_cell).toBe('好公司好价格')
    expect(r.suggested_position_pct).toBe(10)
  })

  it('compute_decision 不触发: 价值陷阱 → 弃 + 仓位 0', async () => {
    const { output } = await get('compute_decision').execute(
      { quality: 'poor', valuation_state: 'cheap', max_loss_pct: 20 },
      ctx,
    )
    const r = output as { action: string; suggested_position_pct: number }
    expect(r.action).toBe('弃')
    expect(r.suggested_position_pct).toBe(0)
  })

  it('compute_turnover 周转天数', async () => {
    const { output } = await get('compute_turnover').execute(
      { opening: 100, closing: 140, base: 600 },
      ctx,
    )
    expect((output as { turnover_days: number }).turnover_days).toBeCloseTo(73, 6)
  })

  it('compute_gate: veto 触发 → 否决', async () => {
    const { output } = await get('compute_gate').execute(
      {
        regime: { systemic: 'normal', direction: '持平' },
        riskBounds: {
          marginOfSafety: { required: 0.2, current: 0.3 },
          veto: [{ rule: 'audit', status: 'triggered' }],
        },
      },
      ctx,
    )
    expect((output as { state: string }).state).toBe('否决')
  })
})
