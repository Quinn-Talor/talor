// @vitest-environment happy-dom
// src/renderer/invest/workspace.integration.test.tsx —— 前端端到端功能测试
//
// 把整座工作台 wired 起来驱动一遍(非单区隔离):talorAPI 三口(artifact.list /
// artifact.read / session.getMessages)喂真实 shape 数据(与后端 feature.integration
// 断言的 CardSummary/CardBundle 同契约)→ InvestWorkspace 全流程:
//   池子渲染 → 自动选首卡 → 活论文(时光机+传导链+事实)与分析过程同时就位
//   → 点历史节点 → 传导链回拨到旧版本(reconstruct 全栈打通)。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, configure } from '@testing-library/react'
import { InvestWorkspace } from './InvestWorkspace'

configure({ asyncUtilTimeout: 3000 }) // 全量并行下抗初始异步加载抖动
import type { CardBundle, CardSummary } from '@shared/types/invest'
import type { ChatMessage } from '../types/chat'

const V1_CLAIM = '政策驱动·护城河建立'
const V2_CLAIM = '份额加速·上调预期'
const SESSION = 'sess-byd'
const CARD_ID = 'c-byd'

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

const bundle: CardBundle = {
  id: CARD_ID,
  type: 'stock_card',
  head: {
    id: CARD_ID,
    code: '002594',
    name: '比亚迪',
    status: 'held',
    origin_session_id: SESSION,
    created_at: '2026-03',
    updated_at: '2026-07',
  },
  eligibility: { red_flags: 0, source_positive: true, in_circle: true, pass: true },
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

// 池子摘要 —— 与后端 store.listAll 同 shape(当前逻辑 v2 + 最新有效性 校准)
const summary: CardSummary = {
  id: CARD_ID,
  code: '002594',
  name: '比亚迪',
  status: 'held',
  origin_session_id: SESSION,
  claim: V2_CLAIM,
  profit_type: '成长',
  validity: '校准',
  updated_at: '2026-07',
}

const messages: ChatMessage[] = [
  {
    id: 'm1',
    session_id: SESSION,
    role: 'user',
    content: '这只票逻辑还成立吗',
    created_at: '2026-07',
  },
  {
    id: 'm2',
    session_id: SESSION,
    role: 'assistant',
    content: '份额加速兑现，上调预期',
    created_at: '2026-07',
  },
]

function wireAPI() {
  const read = vi.fn().mockResolvedValue(bundle)
  const getMessages = vi.fn().mockResolvedValue(messages)
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    artifact: { list: vi.fn().mockResolvedValue([summary]), read },
    session: { getMessages },
  }
  return { read, getMessages }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('工作台端到端(池子 → 选卡 → 活论文时光机 + 分析过程)', () => {
  it('三区 wired 一次跑通:选卡后活论文与对话同时就位', async () => {
    const { read, getMessages } = wireAPI()
    const { container } = render(<InvestWorkspace onBack={vi.fn()} />)

    // 池子渲染真实卡
    await waitFor(() => expect(container.textContent ?? '').toContain('比亚迪'))

    // 自动选首卡 → 活论文取该卡 bundle、分析过程取该卡会话
    await waitFor(() => expect(read).toHaveBeenCalledWith('stock_card', CARD_ID))
    await waitFor(() => expect(getMessages).toHaveBeenCalledWith(SESSION))

    // 活论文·传导链恒等式 ladder 就位 + 现在态 concl = 最新逻辑 v2
    await waitFor(() => expect(container.querySelector('.ladder')).toBeTruthy())
    const txt = () => container.textContent ?? ''
    expect(txt()).toContain(V2_CLAIM)
    expect(txt()).toContain('份额') // 事实
    // 分析过程:研究对话呈现(desk 气泡)
    expect(txt()).toContain('份额加速兑现，上调预期')
  })

  it('时光机回拨:点建立节点 → 传导链切到旧版本 v1(reconstruct 全栈)', async () => {
    wireAPI()
    const { container } = render(<InvestWorkspace onBack={vi.fn()} />)
    await waitFor(() => expect(container.textContent ?? '').toContain(V2_CLAIM)) // 现在=v2
    fireEvent.click(container.querySelectorAll('.tltk')[0]) // 时光机首节点=建立(v1@2026-03)
    await waitFor(() => expect(container.textContent ?? '').toContain(V1_CLAIM))
    expect(container.textContent ?? '').toContain('历史·只读·已冻结')
  })
})
