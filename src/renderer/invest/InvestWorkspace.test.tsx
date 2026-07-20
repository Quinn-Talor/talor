// @vitest-environment happy-dom
// 池子接真数据 + 三区布局(demo 版):池子渲染 / 返回 wiring / artifact:list / 选中驱动 ActivePaper 取卡。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InvestWorkspace } from './InvestWorkspace'
import type { CardSummary } from '@shared/types/invest'

const sample: CardSummary[] = [
  {
    id: 'c1',
    code: '600519',
    name: '贵州茅台',
    status: 'watching',
    origin_session_id: 's1',
    claim: '极好的生意，只是现在偏贵',
    profit_type: '成长',
    validity: '持有',
    updated_at: '2026-06',
  },
  {
    id: 'c2',
    code: '002594',
    name: '比亚迪',
    status: 'held',
    origin_session_id: 's2',
    claim: '好生意，但要求更大边际',
    profit_type: '成长',
    validity: '证伪',
    updated_at: '2026-07',
  },
]

function stubAPI(list: CardSummary[], read = vi.fn().mockResolvedValue(null)) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    artifact: { list: vi.fn().mockResolvedValue(list), read },
    session: { getMessages: vi.fn().mockResolvedValue([]) },
  }
  return read
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('InvestWorkspace(投研工作台 · demo 版)', () => {
  it('头部 + 三区壳 + 池子渲染真实卡', async () => {
    stubAPI(sample)
    const { container } = render(<InvestWorkspace onBack={() => {}} />)
    expect(container.querySelector('.invest-surface')).toBeTruthy()
    expect(container.querySelector('.pool')).toBeTruthy()
    expect(container.querySelector('.convo')).toBeTruthy() // 分析过程列
    const txt = () => container.textContent ?? ''
    expect(txt()).toContain('投研工作台')
    expect(txt()).toContain('分析过程')
    await waitFor(() => expect(txt()).toContain('我的论文 · 2'))
    expect(txt()).toContain('比亚迪')
    expect(txt()).toContain('002594')
  })

  it('空池 → 暂无标的', async () => {
    stubAPI([])
    const { container } = render(<InvestWorkspace onBack={() => {}} />)
    await waitFor(() => expect(container.textContent ?? '').toContain('暂无标的'))
  })

  it('点「返回对话」触发 onBack', () => {
    stubAPI([])
    const onBack = vi.fn()
    const { container } = render(<InvestWorkspace onBack={onBack} />)
    fireEvent.click(container.querySelector('.iv-back')!)
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('默认选首卡,点池子行切换(活论文据此取该卡)', async () => {
    const read = vi.fn().mockResolvedValue(null)
    stubAPI(sample, read)
    const { getByText } = render(<InvestWorkspace onBack={() => {}} />)
    await waitFor(() => expect(read).toHaveBeenCalledWith('stock_card', 'c1'))
    fireEvent.click(getByText('比亚迪'))
    await waitFor(() => expect(read).toHaveBeenCalledWith('stock_card', 'c2'))
  })
})
