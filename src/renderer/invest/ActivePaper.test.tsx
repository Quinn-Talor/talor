// @vitest-environment happy-dom
// 活论文(demo 版):时光机 + 传导链(ler + 恒等式 ladder)+ 事实 + 时光机回拨。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, configure } from '@testing-library/react'
import { ActivePaper } from './ActivePaper'

configure({ asyncUtilTimeout: 5000 }) // 全量并行下抗初始异步加载抖动
import type { CardBundle } from '@shared/types/invest'

const V1 = '政策驱动·护城河建立'
const V2 = '份额加速·上调预期'

const assumption = () => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  anchor: { fact: 'co_share', as_of: '2026-03' },
  forecast: { mode: 'delta' as const, bear: -1, base: 0, bull: 1, horizon: '2026' },
  logic: '成本护城河',
  falsify_if: '连2季<14%',
  step: { order: 1, out: 'V' as const },
})

const full: CardBundle = {
  id: 'c-byd',
  type: 'stock_card',
  head: {
    id: 'c-byd',
    code: '002594',
    name: '比亚迪',
    status: 'held',
    origin_session_id: 's',
    created_at: '2026-03',
    updated_at: '2026-07',
  },
  eligibility: { red_flags: 0, source_positive: true, in_circle: true, pass: true },
  facts: {
    co_share: {
      level: 'company',
      label: '份额',
      unit: '%',
      role: '先行',
      series: [
        {
          value: '14%',
          as_of: '2026-03',
          source: '乘联会',
          change: { trend: 'up', trend_note: '13→14' },
        },
        {
          value: '16%',
          as_of: '2026-07',
          source: '乘联会',
          change: { trend: 'up', trend_note: '14→16' },
        },
      ],
    },
    rev: {
      level: 'company',
      label: '营收',
      unit: '亿',
      series: [{ value: '6800亿', as_of: '2026-03', source: '年报' }],
    },
  },
  thesis: {
    current: 2,
    versions: [
      {
        v: 1,
        at: '2026-03',
        scope: '建立',
        claim: V1,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [assumption()],
          V: { bear: 13, base: 14, bull: 15 },
          margin_of_safety: { required: 0.2, anchor: 'bear' },
        },
      },
      {
        v: 2,
        at: '2026-06',
        scope: '校准',
        claim: V2,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [assumption()],
          V: { bear: 15, base: 16, bull: 17 },
          margin_of_safety: { required: 0.2, anchor: 'bear' },
        },
      },
    ],
  },
  timeline: [
    {
      type: '复查',
      at: '2026-04-30',
      against_v: 1,
      validity: '持有',
      checks: [],
      value_now: {
        V: { bear: 13, base: 14, bull: 15 },
        price: 11,
        margin_of_safety: { at_buy_point: true, buy_trigger: 10 },
      },
      gate: { state: '通行' },
      spawned_v: null,
      signal: { verdict: '等', reason: '持有观察' },
    },
    {
      type: '复查',
      at: '2026-07-31',
      against_v: 1,
      validity: '校准',
      checks: [{ metric: '份额', predicted_value: '15%', actual_value: '16%', outcome: '超预期' }],
      value_now: {
        V: { bear: 15, base: 16, bull: 17 },
        price: 16,
        margin_of_safety: { at_buy_point: false, buy_trigger: 12 },
      },
      gate: { state: '通行' },
      spawned_v: 2,
      signal: { verdict: '等', reason: '份额加速,上调' },
    },
  ],
}

function stubRead(bundle: CardBundle | null) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    artifact: { read: vi.fn().mockResolvedValue(bundle), list: vi.fn().mockResolvedValue([]) },
    session: { getMessages: vi.fn().mockResolvedValue([]) },
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('ActivePaper(活论文 · demo 版)', () => {
  it('渲染时光机 + 传导链(ler+ladder) + 事实;现在态显 v2', async () => {
    stubRead(full)
    const { container } = render(<ActivePaper cardId="c-byd" />)
    await waitFor(() => expect(container.querySelector('.tlwrap')).toBeTruthy())
    expect(container.querySelector('.chainflow')).toBeTruthy() // 竖直因果链
    expect(container.querySelectorAll('.cstation').length).toBeGreaterThanOrEqual(3) // 站点
    expect(container.querySelector('.ler')).toBeTruthy() // 逻辑→预期
    expect(container.querySelector('.ladder')).toBeTruthy() // 恒等式阶梯
    expect(container.querySelectorAll('.tltk').length).toBeGreaterThanOrEqual(3) // 建立+2复查节点
    const txt = container.textContent ?? ''
    expect(txt).toContain('时光机')
    expect(txt).toContain(V2) // 现在=最新逻辑 v2 的 concl
    expect(txt).toContain('份额') // 事实
  })

  it('点建立节点 → 回拨 v1 + 冻结 banner', async () => {
    stubRead(full)
    const { container } = render(<ActivePaper cardId="c-byd" />)
    await waitFor(() => expect(container.querySelector('.tltk')).toBeTruthy())
    fireEvent.click(container.querySelectorAll('.tltk')[0]) // 首节点=建立(最早)
    await waitFor(() => expect(container.querySelector('.tmbanner')).toBeTruthy())
    const txt = container.textContent ?? ''
    expect(txt).toContain('历史·只读·已冻结')
    expect(txt).toContain(V1)
  })

  it('事实三维可折叠:先行默认展开,展开全部铺开其余', async () => {
    stubRead(full)
    const { container, getByText } = render(<ActivePaper cardId="c-byd" />)
    await waitFor(() => expect(container.querySelector('.fcard')).toBeTruthy())
    // 先行(份额)默认展开 → 1 个三维体,含"数据/趋势"维标签
    expect(container.querySelectorAll('.fbody').length).toBe(1)
    const txt = container.textContent ?? ''
    expect(txt).toContain('数据')
    expect(txt).toContain('趋势')
    // 展开全部 → 两条事实(份额 + 营收)都铺开
    fireEvent.click(getByText('展开全部'))
    await waitFor(() => expect(container.querySelectorAll('.fbody').length).toBe(2))
  })

  it('bundle 缺失 → 载入态,不崩', async () => {
    stubRead(null)
    const { container } = render(<ActivePaper cardId="c-byd" />)
    await waitFor(() => expect(container.textContent ?? '').toContain('载入案卷'))
  })
})
