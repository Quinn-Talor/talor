// @vitest-environment happy-dom
// U1 壳 + U2 池子接真数据:三区呈现 / 返回 wiring / artifact:list 渲染 / 选中驱动活论文。
// 同范式 stockCardUI.test.tsx(happy-dom + testing-library,快·稳·可回归)。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { InvestWorkspace } from './InvestWorkspace'
import type { CardSummary } from '@shared/types/invest'

const sample: CardSummary[] = [
  {
    id: 'c1',
    code: '600519',
    name: '贵州茅台',
    status: 'held',
    claim: '高端白酒护城河',
    profit_type: '成长',
    validity: '持有',
    updated_at: '2026-07-01',
  },
  {
    id: 'c2',
    code: '002594',
    name: '比亚迪',
    status: 'watching',
    claim: '成本护城河抢份额',
    profit_type: '成长',
    validity: '证伪',
    updated_at: '2026-06-01',
  },
]

function stubAPI(list: CardSummary[], read = vi.fn().mockResolvedValue(null)) {
  ;(window as unknown as { talorAPI: unknown }).talorAPI = {
    artifact: { list: vi.fn().mockResolvedValue(list), read },
  }
  return read
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { talorAPI?: unknown }).talorAPI
})

describe('InvestWorkspace(投研工作台)', () => {
  it('渲染身份 + 三区(池子/活论文/分析过程)', async () => {
    stubAPI([])
    render(<InvestWorkspace onBack={() => {}} />)
    expect(screen.getByText('投研工作台')).toBeTruthy()
    expect(screen.getByText('池子')).toBeTruthy()
    expect(screen.getByText('活论文')).toBeTruthy()
    expect(screen.getByText('分析过程')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('暂无标的 —— 建卡后在此归池')).toBeTruthy())
  })

  it('点「返回对话」触发 onBack', () => {
    stubAPI([])
    const onBack = vi.fn()
    render(<InvestWorkspace onBack={onBack} />)
    fireEvent.click(screen.getByText('← 返回对话'))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('U2: 池子渲染真实卡(artifact:list),证伪标红 + 计数', async () => {
    stubAPI(sample)
    render(<InvestWorkspace onBack={() => {}} />)
    expect(await screen.findByText('贵州茅台')).toBeTruthy()
    expect(screen.getByText('比亚迪')).toBeTruthy()
    expect(screen.getByText('600519')).toBeTruthy()
    expect(screen.getByText('证伪')).toBeTruthy()
    expect(screen.getByText(/候选与在研 · 2/)).toBeTruthy()
  })

  it('U2: 默认选首卡,点行切换选中(活论文据此取该卡)', async () => {
    const read = vi.fn().mockResolvedValue(null)
    stubAPI(sample, read)
    render(<InvestWorkspace onBack={() => {}} />)
    // 默认选首卡(茅台)→ 活论文 ActivePaper 取 c1
    await waitFor(() => expect(read).toHaveBeenCalledWith('stock_card', 'c1'))
    fireEvent.click(screen.getByText('比亚迪'))
    await waitFor(() => expect(read).toHaveBeenCalledWith('stock_card', 'c2'))
  })
})
