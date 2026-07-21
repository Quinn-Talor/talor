import { describe, it, expect } from 'vitest'
import {
  summarizeHealth,
  latestCheckpoint,
  latestValidity,
  healthEmoji,
  gateEmoji,
  dualLines,
  coreLogicLines,
  factFreshness,
  reconstructCardAt,
  currentThesis,
} from './summarizeHealth'
import type {
  CardBundle,
  Checkpoint,
  GateState,
  ValuationAssumption,
  AssumptionCheck,
} from '@shared/types/invest'

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    type: '复查',
    at: '2026-04-30',
    against_v: 1,
    validity: '持有',
    checks: [],
    value_now: { V: { bear: 1, base: 2, bull: 3 }, margin_of_safety: { at_buy_point: true } },
    gate: { state: '通行' },
    spawned_v: null,
    signal: { verdict: '等', reason: 'r' },
    ...over,
  }
}
function bundle(checkpoints: Checkpoint[]): CardBundle {
  return {
    id: 'c',
    type: 'stock_card',
    head: {
      id: 'c',
      code: '1',
      name: 'x',
      status: 'held',
      origin_session_id: 's',
      created_at: 't',
      updated_at: 't',
    },
    eligibility: null,
    facts: {},
    thesis: null,
    timeline: checkpoints,
  }
}

describe('summarizeHealth', () => {
  it('无复查 → none/null', () => {
    expect(summarizeHealth(bundle([]))).toEqual({ health: 'none', gate: null })
    expect(summarizeHealth(null)).toEqual({ health: 'none', gate: null })
  })
  // validity 唯一驱动(必填,无回退)
  it('validity 强化/持有 → green', () => {
    expect(summarizeHealth(bundle([cp({ validity: '强化' })])).health).toBe('green')
    expect(summarizeHealth(bundle([cp({ validity: '持有' })])).health).toBe('green')
  })
  it('validity 校准 → yellow', () => {
    expect(summarizeHealth(bundle([cp({ validity: '校准' })])).health).toBe('yellow')
  })
  it('validity 证伪 → red', () => {
    expect(summarizeHealth(bundle([cp({ validity: '证伪' })])).health).toBe('red')
  })
  it('取最新复查 + gate 透传', () => {
    const s = summarizeHealth(
      bundle([cp({ at: '2026-01' }), cp({ at: '2026-04', gate: { state: '节流' } })]),
    )
    expect(s.gate).toBe('节流')
  })
  it('latestCheckpoint / latestValidity: 取末个复查', () => {
    const b = bundle([cp({ at: '2026-01' }), cp({ at: '2026-04', validity: '校准' })])
    expect(latestCheckpoint(b)?.at).toBe('2026-04')
    expect(latestValidity(b)).toBe('校准')
  })
})

describe('dualLines — 估(预测值)显推算后的未来值', () => {
  it('proj delta 命门:估 = 锚+增量(14.5%)+ 单位,不是原始增量(0.5)', () => {
    const b: CardBundle = {
      ...bundle([
        cp({
          checks: [
            { metric: 'co_share', predicted_value: '14.5%', actual_value: '14%', outcome: '容差' },
          ],
        }),
      ]),
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '14%', as_of: '2026-07', source: '乘联会' }],
        },
      },
      thesis: {
        current: 1,
        versions: [
          {
            v: 1,
            at: '2026-03',
            scope: '建立',
            claim: 'c',
            profit_type: '成长',
            valuation: {
              method: 'pe',
              assumptions: [
                {
                  key: 'co_share',
                  label: '份额',
                  unit: '%',
                  anchor: { fact: 'co_share', as_of: '2026-07' },
                  forecast: {
                    mode: 'delta',
                    bear: -0.5,
                    base: 0.5,
                    bull: 1.5,
                    horizon: '2026-annual',
                  },
                  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
                  logic: '成本护城河',
                },
              ],
              V: { bear: 1, base: 2, bull: 3 },
              margin_of_safety: { required: 0.25 },
            },
          },
        ],
      },
    }
    const { lines } = dualLines(b)
    expect(lines[0].projected).toBe('14.5%') // 锚 14 + delta 0.5,带单位(非 0.5)
    expect(lines[0].actual).toBe('14%')
  })
})

describe('coreLogicLines — B1 逻辑→预期(锚→估+跳变,全程可见)', () => {
  const facts = {
    co_share: {
      level: 'company' as const,
      label: '份额',
      unit: '%',
      series: [{ value: '14%', as_of: '2026-07', source: '乘联会' }],
    },
  }
  function withThesis(
    assumptions: ValuationAssumption[],
    checks: AssumptionCheck[] = [],
  ): CardBundle {
    return {
      ...bundle(checks.length ? [cp({ checks })] : []),
      facts,
      thesis: {
        current: 1,
        versions: [
          {
            v: 1,
            at: '2026-03',
            scope: '建立',
            claim: 'c',
            profit_type: '成长',
            valuation: {
              method: 'pe',
              assumptions,
              V: { bear: 1, base: 2, bull: 3 },
              margin_of_safety: { required: 0.25 },
            },
          },
        ],
      },
    }
  }

  it('proj 命门:锚(最新事实)→ 估(forecast 解析)+ 跳变=估−锚;小跳变不标黄 + 实/conv 跟踪', () => {
    const lines = coreLogicLines(
      withThesis(
        [
          {
            key: 'co_share',
            label: '份额',
            unit: '%',
            anchor: { fact: 'co_share', as_of: '2026-07' },
            forecast: { mode: 'delta', bear: -0.5, base: 0.5, bull: 1.5 },
            logic: '成本护城河',
            verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
          },
        ],
        [{ metric: 'co_share', predicted_value: '14.5%', actual_value: '14%', outcome: '容差' }],
      ),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].anchor).toBe(14)
    expect(lines[0].anchorAsOf).toBe('2026-07')
    expect(lines[0].est).toBe(14.5) // 锚 14 + delta 0.5
    expect(lines[0].jump).toBe(0.5) // 估 − 锚
    expect(lines[0].bigJump).toBe(false) // 0.5/14 < 50%
    expect(lines[0].broken).toBe(false)
    expect(lines[0].logic).toBe('成本护城河')
    expect(lines[0].actual).toBe('14%')
    expect(lines[0].conv).toBe('持有')
  })

  it('大跳变(相对幅度 >50%)→ bigJump 标黄(预期远离当前事实,需强逻辑)', () => {
    const lines = coreLogicLines(
      withThesis([
        {
          key: 'co_share',
          label: '份额',
          unit: '%',
          anchor: { fact: 'co_share', as_of: '2026-07' },
          forecast: { mode: 'factor', bear: 1.5, base: 2, bull: 2.5 }, // 锚 14 × 2 = 28
          logic: '份额翻倍',
        },
      ]),
    )
    expect(lines[0].est).toBe(28)
    expect(lines[0].jump).toBe(14) // 28 − 14
    expect(lines[0].bigJump).toBe(true) // 14/14 = 100%
  })

  it('proj 命门锚缺失(事实不在 facts)→ broken 标红,不臆造跳变', () => {
    const lines = coreLogicLines(
      withThesis([
        {
          key: 'gross_margin',
          label: '毛利率',
          unit: '%',
          anchor: { fact: 'gross_margin', as_of: '2026-07' },
          forecast: { mode: 'delta', bear: 0, base: 1, bull: 2 },
          logic: '降本',
        },
      ]),
    )
    expect(lines[0].broken).toBe(true)
    expect(lines[0].anchor).toBeNull()
    expect(lines[0].jump).toBeNull()
  })

  it('absolute 命门:est 独立设定 → 不算跳变(锚仅作立足事实,免异量减法)', () => {
    const lines = coreLogicLines(
      withThesis([
        {
          key: 'co_share',
          label: '份额',
          unit: '%',
          anchor: { fact: 'co_share', as_of: '2026-07' }, // 锚仅立足,absolute est 直取
          forecast: { mode: 'absolute', bear: 12, base: 13, bull: 15 },
          logic: '独立设定的份额预期',
        },
      ]),
    )
    expect(lines[0].anchor).toBe(14) // 锚仍显(立足事实)
    expect(lines[0].est).toBe(13) // 估独立设定
    expect(lines[0].jump).toBeNull() // 不算跳变(13 − 14 无推导意义)
    expect(lines[0].bigJump).toBe(false)
    expect(lines[0].broken).toBe(false) // absolute 不因缺锚断环
  })

  it('命门名像计算量(EPS)→ computedWarn(应由上游计算);普通命门不警告', () => {
    const lines = coreLogicLines(
      withThesis([
        {
          key: 'eps_year1',
          label: '第1年EPS',
          unit: '元',
          anchor: { fact: 'co_share', as_of: '2026-07' },
          forecast: { mode: 'factor', bear: 0.9, base: 1, bull: 1.1 },
          logic: '盈利',
        },
        {
          key: 'co_share',
          label: '份额',
          unit: '%',
          anchor: { fact: 'co_share', as_of: '2026-07' },
          forecast: { mode: 'delta', bear: -0.5, base: 0.5, bull: 1.5 },
          logic: '护城河',
        },
      ]),
    )
    expect(lines.find((l) => l.key === 'eps_year1')!.computedWarn).toBe(true)
    expect(lines.find((l) => l.key === 'co_share')!.computedWarn).toBe(false)
  })
})

describe('factFreshness — 数据新鲜度(相对今天·按 cadence·now 注入)', () => {
  it('月龄相对今天;超该 cadence 窗 → stale', () => {
    const mk = (as_of: string) => ({
      level: 'company' as const,
      label: 'x',
      series: [{ value: '1', as_of, source: '年报' }],
    })
    const now = new Date('2026-07-01') // 季度窗 5 月
    const f = factFreshness({ 新: mk('2026-06'), 旧: mk('2022-12'), 次新: mk('2025-12') }, now)
    expect(f['新'].ageMonths).toBe(1) // 2026-07 − 2026-06
    expect(f['新'].stale).toBe(false)
    expect(f['旧'].ageMonths).toBe(43) // 2026-07 − 2022-12
    expect(f['旧'].stale).toBe(true)
    expect(f['次新'].ageMonths).toBe(7) // 2026-07 − 2025-12;季度窗 5 → 过时(相对今天,非相对卡内)
    expect(f['次新'].stale).toBe(true)
  })
})

describe('emoji', () => {
  it('healthEmoji', () => {
    expect(healthEmoji('green')).toBe('🟢')
    expect(healthEmoji('red')).toBe('🔴')
    expect(healthEmoji('none')).toBe('⚪')
  })
  it('gateEmoji', () => {
    expect(gateEmoji('否决' as GateState)).toBe('🔴')
    expect(gateEmoji('节流' as GateState)).toBe('🟠')
    expect(gateEmoji(null)).toBe('⚪')
  })
})

describe('reconstructCardAt — 时光机切片(历史冻结·现在可拨)', () => {
  // 建卡 v1@2026-03 → 复查@2026-04 → 决策@2026-05 → 出 v2@2026-06 → 复查@2026-07
  const full: CardBundle = {
    ...bundle([
      cp({ at: '2026-04-30', against_v: 1 }),
      { type: '决策', at: '2026-05-10', trade: '建', reason: 'r', based_v: 1 },
      cp({ at: '2026-07-31', against_v: 2, spawned_v: null }),
    ]),
    facts: {
      co_share: {
        level: 'company',
        label: '份额',
        unit: '%',
        series: [
          { value: '14%', as_of: '2026-03', source: 's' },
          { value: '16%', as_of: '2026-07', source: 's' },
        ],
      },
    },
    thesis: {
      current: 2,
      versions: [
        {
          v: 1,
          at: '2026-03',
          scope: '建立',
          claim: 'v1',
          profit_type: '成长',
          valuation: {
            method: 'pe',
            assumptions: [],
            V: { bear: 1, base: 2, bull: 3 },
            margin_of_safety: { required: 0.2 },
          },
        },
        {
          v: 2,
          at: '2026-06',
          scope: '校准',
          claim: 'v2',
          profit_type: '成长',
          valuation: {
            method: 'pe',
            assumptions: [],
            V: { bear: 2, base: 3, bull: 4 },
            margin_of_safety: { required: 0.2 },
          },
        },
      ],
    },
  }

  it('切到决策时点 2026-05-10:事实/逻辑版本/时间线都截到 ≤T,current=v1(v2 尚未出)', () => {
    // T 取时间线节点的真实时戳(用户点节点触发);月粒度事实/版本靠前缀比较正确纳入
    const t = reconstructCardAt(full, '2026-05-10')
    expect(t.facts.co_share.series.map((p) => p.as_of)).toEqual(['2026-03']) // 丢 2026-07
    expect(t.thesis?.versions.map((v) => v.v)).toEqual([1]) // v2@2026-06 未纳入
    expect(currentThesis(t)?.v).toBe(1) // current 拨回 v1
    expect(t.timeline.map((e) => e.at)).toEqual(['2026-04-30', '2026-05-10']) // 丢 2026-07 复查
  })

  it('切到 2026-02(建卡前):无逻辑 + 无事实 + 空时间线', () => {
    const t = reconstructCardAt(full, '2026-02')
    expect(t.thesis).toBeNull()
    expect(t.facts.co_share).toBeUndefined()
    expect(t.timeline).toEqual([])
  })

  it('切到现在(2026-12):等价全量,current=v2', () => {
    const t = reconstructCardAt(full, '2026-12')
    expect(t.thesis?.versions).toHaveLength(2)
    expect(currentThesis(t)?.v).toBe(2)
    expect(t.timeline).toHaveLength(3)
  })
})
