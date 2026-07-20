// @vitest-environment happy-dom
// U3b:活论文渲染 + 时光机拨动。mock artifact.read 返回全量 bundle,断言
// 传导链默认现在(v2)、点建立节点回拨到 v1、事实/估值呈现。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { ActivePaper } from './ActivePaper'
import type { CardBundle } from '@shared/types/invest'

const V1_CLAIM = '政策驱动·护城河建立'
const V2_CLAIM = '份额加速·上调预期'

const assumption = (over = {}) => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  anchor: { fact: 'co_share', as_of: '2026-03' },
  forecast: { mode: 'delta' as const, bear: -1, base: 0, bull: 1, horizon: '2026' },
  logic: '成本护城河',
  falsify_if: '连2季<14%',
  step: { order: 1, out: 'V' as const },
  ...over,
})

const full: CardBundle = {
  id: 'c1',
  type: 'stock_card',
  head: {
    id: 'c1',
    code: '002594',
    name: '比亚迪',
    status: 'held',
    origin_session_id: 's',
    created_at: '2026-03',
    updated_at: '2026-07',
  },
  eligibility: null,
  facts: {
    co_share: {
      level: 'company',
      label: '份额',
      unit: '%',
      series: [
        { value: '14%', as_of: '2026-03', source: '乘联会' },
        { value: '16%', as_of: '2026-07', source: '乘联会' },
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
        claim: V1_CLAIM,
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
        claim: V2_CLAIM,
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
      value_now: { V: { bear: 13, base: 14, bull: 15 }, margin_of_safety: { at_buy_point: true } },
      gate: { state: '通行' },
      spawned_v: null,
      signal: { verdict: '等', reason: 'r' },
    },
    { type: '决策', at: '2026-05-10', trade: '建', reason: '进安全边际', based_v: 1, weight: 0.1 },
    {
      // 校准复查:份额加速 → 出 v2(spawned_v=2);此节点晚于 v2@2026-06,故"现在"含 v2
      type: '复查',
      at: '2026-07-31',
      against_v: 1,
      validity: '校准',
      checks: [],
      value_now: { V: { bear: 15, base: 16, bull: 17 }, margin_of_safety: { at_buy_point: false } },
      gate: { state: '通行' },
      spawned_v: 2,
      signal: { verdict: '等', reason: 'r' },
    },
  ],
}

function stubRead(bundle: CardBundle | null) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    artifact: { read: vi.fn().mockResolvedValue(bundle), list: vi.fn().mockResolvedValue([]) },
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('ActivePaper(活论文:时光机 · 传导链 · 事实)', () => {
  it('渲染三段 + 现在态显最新逻辑 v2', async () => {
    stubRead(full)
    render(<ActivePaper cardId="c1" />)
    expect(await screen.findByText('时光机')).toBeTruthy()
    expect(screen.getByText('传导链')).toBeTruthy()
    expect(screen.getByText('事实')).toBeTruthy()
    // 默认现在 → 当前版 v2 的论点
    expect(screen.getByText(V2_CLAIM)).toBeTruthy()
    // 事实呈现份额
    expect(screen.getByText('份额')).toBeTruthy()
  })

  it('点「建立」节点 → 时光机回拨到 v1(历史冻结),传导链显 v1 论点', async () => {
    stubRead(full)
    render(<ActivePaper cardId="c1" />)
    await screen.findByText(V2_CLAIM)
    fireEvent.click(screen.getByText('建立')) // 时光机建立节点(v1@2026-03)
    await waitFor(() => expect(screen.getByText(V1_CLAIM)).toBeTruthy())
    expect(screen.getByText('历史 · 冻结只读')).toBeTruthy()
  })

  it('bundle 缺失 → 载入态,不崩', async () => {
    stubRead(null)
    render(<ActivePaper cardId="c1" />)
    expect(await screen.findByText('载入案卷…')).toBeTruthy()
  })
})
