// @vitest-environment happy-dom
// 组件渲染测试:mock readCard → 渲染 stockCardUI.Panel,断言决策面(散户层五行)+ 三下钻(点开)。
// 验证"页面功能"=案卷渲染逻辑对不对(快·稳·可回归)。

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { stockCardUI } from './stockCardUI'
import type { CardBundle } from '@shared/types/invest'
import type { ChatMessage as RendererChatMessage } from '../types/chat'

const PLAIN = '政策让电车多卖,比亚迪成本低抢份额 → 赚钱'
const aPen = {
  key: 'ev_pen',
  label: '行业渗透率',
  unit: '%',
  anchor: { fact: 'ev_pen', as_of: '2026-06' },
  forecast: { mode: 'absolute' as const, bear: 45, base: 50, bull: 55, horizon: '2026-annual' },
  verify: [{ fact: 'ev_pen', at: 'annual', role: '终验' as const }],
  logic: '政策驱动消费',
  falsify_if: '年报<45%',
}
const aShare = (base: number, falsify: string) => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  anchor: { fact: 'co_share', as_of: '2026-07' },
  forecast: {
    mode: 'absolute' as const,
    bear: base - 1,
    base,
    bull: base + 1,
    horizon: '2026-annual',
  },
  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' as const }],
  logic: '成本护城河',
  falsify_if: falsify,
})
const aMargin = {
  key: 'net_margin',
  label: '净利率',
  unit: '%',
  forecast: { mode: 'absolute' as const, bear: 8, base: 9, bull: 10 },
}
// pe 恒等式支撑/常量(让 ladder 真渲染)
const aCap = {
  key: 'mkt_capacity',
  label: '行业容量',
  unit: '万辆',
  forecast: { mode: 'absolute' as const, bear: 2826, base: 2826, bull: 2826 },
}
const aAsp = {
  key: 'asp',
  label: '单价',
  unit: '万元',
  forecast: { mode: 'absolute' as const, bear: 16.5, base: 16.5, bull: 16.5 },
}
const aShares = {
  key: 'shares',
  label: '股本',
  unit: '亿股',
  forecast: { mode: 'absolute' as const, bear: 29, base: 29, bull: 29 },
}
const aPe = {
  key: 'pe_central',
  label: 'PE中枢',
  unit: 'x',
  forecast: { mode: 'absolute' as const, bear: 23, base: 25, bull: 27 },
}

const bundle: CardBundle = {
  id: '002594-x',
  type: 'stock_card',
  head: {
    id: '002594-x',
    code: '002594',
    name: '比亚迪',
    status: 'held',
    bucket: 'satellite',
    origin_session_id: 's',
    created_at: 't',
    updated_at: 't',
  },
  eligibility: {
    red_flags: 0,
    source_positive: true,
    in_circle: true,
    pass: true,
    good_business: {
      quality_gate: 'pass',
      moat: { type: '成本优势·规模', durability: '中' },
      grade: '良',
    },
  },
  facts: {
    ev_pen: {
      level: 'industry',
      label: '行业渗透率',
      unit: '%',
      role: '同步',
      series: [
        {
          value: '42%',
          as_of: '2026-06',
          source: '中汽协',
          structure: { note: '高端先行', quality: 'mixed' },
        },
      ],
    },
    co_share: {
      level: 'company',
      label: '公司份额',
      unit: '%',
      role: '同步',
      series: [
        {
          value: '14%',
          as_of: '2026-07',
          source: '乘联会',
          change: { trend: 'down', trend_note: '16→14·连2季' },
        },
      ],
    },
    inventory: {
      level: 'company',
      label: '存货',
      unit: '亿元',
      role: '排雷',
      series: [
        {
          value: '340亿',
          as_of: '2026-06',
          source: '巨潮:附注',
          change: { turnover_days: 61, turnover_trend: '52→61·放缓' },
          structure: {
            note: '产成品激增·滞销苗头',
            quality: 'deteriorating',
            components: [{ name: '产成品', value: '185亿 +31%', signal: 'bad' }],
          },
        },
      ],
    },
    policy_ev: {
      level: 'macro',
      label: '购置税',
      role: '先行',
      series: [{ value: '延续2027', as_of: '2026-03', source: '财政部' }],
    },
  },
  thesis: {
    versions: [
      {
        v: 1,
        at: '2026-03-31',
        scope: '建立',
        claim: PLAIN,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [aPen, aCap, aShare(16, '连2季<14%'), aAsp, aMargin, aShares, aPe],
          V: { bear: 200, base: 289, bull: 406 },
          margin_of_safety: { required: 0.25, anchor: 'base' },
        },
      },
      {
        v: 2,
        at: '2026-07-31',
        scope: '校准',
        claim: PLAIN,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [aPen, aCap, aShare(14.5, '连2季<13%'), aAsp, aMargin, aShares, aPe],
          V: { bear: 180, base: 262, bull: 370 },
          margin_of_safety: { required: 0.25, anchor: 'base' },
        },
        ref_checkpoint: 'cp-0731',
      },
    ],
    current: 2,
  },
  timeline: [
    {
      type: '复查',
      at: '2026-04-30',
      against_v: 1,
      validity: '持有',
      conviction: 'mid',
      checks: [
        {
          metric: 'co_share',
          predicted_value: '16%',
          actual_value: '15.5%',
          outcome: '容差',
          attribution: { cause: '季节性', type: '外生' },
        },
      ],
      value_now: {
        V: { bear: 210, base: 265, bull: 350 },
        price: 195,
        realized_pct: 0.2,
        margin_of_safety: {
          to_bear: '-7%',
          vs_required: '达标',
          at_buy_point: true,
          buy_trigger: 199,
        },
      },
      gate: { state: '通行' },
      spawned_v: null,
      signal: { verdict: '买', reason: '边际达标' },
    },
    {
      type: '决策',
      at: '2026-05-15',
      trade: '建',
      price: 195,
      weight: 0.05,
      based_v: 1,
      reason: '边际达标,命门holding',
    },
    {
      type: '复查',
      at: '2026-07-31',
      against_v: 1,
      validity: '校准',
      conviction: 'mid',
      checks: [
        {
          metric: 'co_share',
          predicted_value: '16%',
          actual_value: '14%',
          outcome: '偏离',
          deviation: { 变化: '连2季减速' },
          attribution: { cause: '价格战', type: '参数错' },
        },
        {
          metric: 'ev_pen',
          predicted_value: '50%',
          actual_value: '51%',
          outcome: '兑现',
        },
      ],
      value_now: {
        V: { bear: 180, base: 262, bull: 370 },
        price: 248,
        realized_pct: 0.3,
        margin_of_safety: {
          to_bear: '+21%',
          vs_required: '不足',
          at_buy_point: false,
          buy_trigger: 210,
        },
      },
      gate: { state: '通行' },
      spawned_v: 2,
      signal: { verdict: '等', reason: '价格回升,边际不足' },
    },
    {
      type: '复盘',
      at: '2026-12-31',
      vs_benchmark: { satellite: 0.18, index: 0.12, verdict: '跑赢' },
      lesson: '拐点阈值更严',
      ref_v: 2,
    },
  ],
}

beforeEach(() => {
  ;(globalThis as unknown as { window: { talorAPI: unknown } }).window = globalThis.window ?? {}
  ;(window as unknown as { talorAPI: { artifact: { read: () => Promise<CardBundle> } } }).talorAPI =
    {
      artifact: { read: vi.fn().mockResolvedValue(bundle) },
    }
})
afterEach(() => cleanup())

const Panel = stockCardUI.Panel
const Inline = stockCardUI.Inline
const has = (re: RegExp | string) => screen.getAllByText(re).length > 0

describe('决策面(散户层五行)', () => {
  it('顶条:代码/卫星仓 + verdict(等)+ gate(通行),无价格头条', async () => {
    render(<Panel id="002594-x" />)
    expect(await screen.findByText(/002594 比亚迪/)).toBeTruthy()
    expect(has('卫星仓')).toBe(true)
    expect(has(/等/)).toBe(true) // 最近复查 signal.verdict
    expect(has(/gate 通行/)).toBe(true)
  })

  it('好生意体检徽章(grade + 护城河)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/002594 比亚迪/)
    expect(has(/好生意/)).toBe(true)
    expect(has(/护城河成本优势·规模/)).toBe(true)
  })

  it('① 大白话逻辑(claim)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    expect(has(/政策让电车多卖,比亚迪成本低抢份额/)).toBe(true)
  })

  it('① 逻辑成立?validity(校准)+ 双向双线(强化+背离)+ 兑现度', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    expect(has('公司份额')).toBe(true)
    expect(has(/校准/)).toBe(true) // validity 校准·动摇(双向验证产物)
    expect(has(/强化/)).toBe(true) // 渗透率兑现 → 强化(正向)
    expect(has(/背离/)).toBe(true) // 份额偏离 → 背离
    expect(has(/兑现度 30%/)).toBe(true) // realized_pct 0.3
  })

  it('③ 安全边际:未到买点 + 等回调¥210(buy_trigger)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    expect(has(/未到买点/)).toBe(true) // at_buy_point=false
    expect(has(/等回调/)).toBe(true)
    expect(has(/210/)).toBe(true) // buy_trigger
  })

  it('④ 红线(命门证伪 ∪ 排雷恶化)+ ⑤ 非荐股', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    expect(has(/连2季<13%/)).toBe(true) // v2 命门 falsify
    expect(has(/产成品激增/)).toBe(true) // 排雷 deteriorating 事实
    expect(has(/非荐股/)).toBe(true)
  })

  it('卡不存在 → 提示', async () => {
    ;(window as unknown as { talorAPI: { artifact: { read: () => Promise<null> } } }).talorAPI = {
      artifact: { read: vi.fn().mockResolvedValue(null) },
    }
    render(<Panel id="missing" />)
    expect(await screen.findByText(/卡不存在/)).toBeTruthy()
  })
})

describe('下钻(默认折叠,点开)', () => {
  it('事实:三维(周转 + 结构恶化)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    fireEvent.click(screen.getByRole('button', { name: /事实/ }))
    expect(has('存货')).toBe(true)
    expect(has(/周转61天/)).toBe(true)
    expect(has(/恶化/)).toBe(true)
    expect(has(/@2026-0/)).toBe(true) // 每个事实项显数据最新时点(as_of)
  })

  it('逻辑:claim + 恒等式阶梯 + 重算(命门审计)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    fireEvent.click(screen.getByRole('button', { name: /逻辑/ }))
    expect(has(/政策让电车多卖/)).toBe(true) // 大白话 claim
    expect(has(/成本护城河/)).toBe(true) // 命门 logic(审计)
    expect(has(/行业销量/)).toBe(true) // 恒等式阶梯渲染
    expect(has(/容量 2826万辆/)).toBe(true) // 具体数值代入(非黑盒,命门/支撑参数代入值)
    expect(has(/PE中枢 25/)).toBe(true) // V 步代入 PE中枢(链路可验;命门参数蓝)
    expect(has(/计算/)).toBe(true) // 中间量/结果标「计算」(区别于命门叶子)
    expect(has(/本期校准/)).toBe(true) // 重算驱动事实(v1→v2)
  })

  it('逻辑:命门显示 锚→推算→未来(计算过程)+ 断环标红', async () => {
    // co_share:proj delta,锚=facts 最新 14% → 未来 14.5%;ghost:锚缺失 → 估值链断
    const projBundle: CardBundle = {
      ...bundle,
      thesis: {
        current: 1,
        versions: [
          {
            ...bundle.thesis!.versions[0],
            valuation: {
              method: 'pe',
              assumptions: [
                {
                  key: 'co_share',
                  label: '公司份额',
                  unit: '%',
                  anchor: { fact: 'co_share', as_of: '2026-07' },
                  forecast: {
                    mode: 'delta' as const,
                    bear: -0.5,
                    base: 0.5,
                    bull: 1.5,
                    horizon: '2026-annual',
                  },
                  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' as const }],
                  logic: '成本护城河',
                  falsify_if: '<13%',
                },
                {
                  key: 'ghost',
                  label: '幽灵参数',
                  unit: '%',
                  anchor: { fact: 'nonexist' },
                  forecast: { mode: 'delta' as const, bear: 1, base: 2, bull: 3 },
                  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' as const }],
                  logic: '断环测试',
                  falsify_if: 'x',
                },
              ],
              V: { bear: 1, base: 2, bull: 3 },
              margin_of_safety: { required: 0.25 },
            },
          },
        ],
      },
      timeline: [],
    }
    ;(
      window as unknown as { talorAPI: { artifact: { read: () => Promise<CardBundle> } } }
    ).talorAPI = { artifact: { read: vi.fn().mockResolvedValue(projBundle) } }
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    fireEvent.click(screen.getByRole('button', { name: /逻辑/ }))
    expect(has(/锚/)).toBe(true) // 锚(最新事实)
    expect(has(/未来/)).toBe(true) // 推算出的未来值
    expect(has(/14\.5/)).toBe(true) // 锚 14 + delta 0.5 = 14.5
    expect(has(/估值链断/)).toBe(true) // ghost 锚缺失标红
  })

  it('时间线:整合轴(校准台阶 v1→v2 + 决策基于v1 + 复盘跑赢)', async () => {
    render(<Panel id="002594-x" />)
    await screen.findByText(/盯逻辑/)
    fireEvent.click(screen.getByRole('button', { name: /时间线/ }))
    expect(has(/289→262/)).toBe(true) // 轨迹条:V 走势
    expect(has(/校准 v1→v2/)).toBe(true) // 版本台阶
    expect(has(/基于 v1/)).toBe(true) // 决策基于逻辑
    expect(has(/跑赢/)).toBe(true) // 复盘
    expect(has(/挡噪声/)).toBe(true) // cp1 逻辑不动
  })
})

describe('stockCardUI.Inline chip', () => {
  it('消息含 stock_card 块 → 渲出 chip(可点)', () => {
    const msg = {
      content: JSON.stringify([
        { type: 'text', text: 'x' },
        { type: 'stock_card', id: '002594-x', head: { code: '002594', name: '比亚迪' } },
      ]),
    } as unknown as RendererChatMessage
    const onSelect = vi.fn()
    render(<Inline message={msg} onSelect={onSelect} />)
    const btn = screen.getByRole('button', { name: /002594 比亚迪/ })
    expect(btn).toBeTruthy()
    btn.click()
    expect(onSelect).toHaveBeenCalledWith('002594-x')
  })

  it('无卡引用 → 不渲染', () => {
    const msg = { content: 'plain text' } as unknown as RendererChatMessage
    const { container } = render(<Inline message={msg} onSelect={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })
})
