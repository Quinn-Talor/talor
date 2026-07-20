// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ChallengeCard } from './ChallengeCard'
import type { ThesisChallenge } from '@shared/types/invest'

afterEach(cleanup)

const challenge: ThesisChallenge = {
  output: {
    target: 'thesis',
    weakest_assumption: 'co_share',
    refutation: '现价已隐含 25% 增速,过高',
    suggested_verdict: '校准',
    severity: 'high',
  },
  adjudication: { verdict: 'reject', note: '先行销量仍支撑,维持' },
}

describe('ChallengeCard(红蓝对抗)', () => {
  it('渲染空方论据 + PM 裁决', () => {
    const { container } = render(<ChallengeCard challenge={challenge} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('现价已隐含 25% 增速')
    expect(txt).toContain('先行销量仍支撑')
    expect(txt).toContain('驳回')
    expect(container.querySelector('.challenge')).toBeTruthy()
  })
  it('challenge 为空 → 不渲染', () => {
    const { container } = render(<ChallengeCard challenge={undefined} />)
    expect(container.querySelector('.challenge')).toBeNull()
  })
})
