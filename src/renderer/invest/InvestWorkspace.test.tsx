// @vitest-environment happy-dom
// U1 壳渲染测试:三区(池子/活论文/分析过程)呈现 + 返回入口 wiring。
// 与 stockCardUI.test.tsx 同范式(happy-dom + testing-library,快·稳·可回归)。

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { InvestWorkspace } from './InvestWorkspace'

afterEach(() => cleanup())

describe('InvestWorkspace(投研工作台 shell)', () => {
  it('渲染身份 + 三区(池子/活论文/分析过程)', () => {
    render(<InvestWorkspace onBack={() => {}} />)
    expect(screen.getByText('投研工作台')).toBeTruthy()
    expect(screen.getByText('池子')).toBeTruthy()
    expect(screen.getByText('活论文')).toBeTruthy()
    expect(screen.getByText('分析过程')).toBeTruthy()
  })

  it('点「返回对话」触发 onBack', () => {
    const onBack = vi.fn()
    render(<InvestWorkspace onBack={onBack} />)
    fireEvent.click(screen.getByText('← 返回对话'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
