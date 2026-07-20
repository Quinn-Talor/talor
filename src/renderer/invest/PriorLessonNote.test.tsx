// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PriorLessonNote } from './PriorLessonNote'

afterEach(cleanup)

describe('PriorLessonNote', () => {
  it('有教训 → 渲染', () => {
    const { container } = render(
      <PriorLessonNote lessons={[{ ref_v: 1, lesson: '别把运气当能力', at: '2026-06' }]} />,
    )
    expect(container.textContent ?? '').toContain('别把运气当能力')
    expect(container.querySelector('.priorlesson')).toBeTruthy()
  })
  it('无教训(全空 lesson)→ 不渲染', () => {
    const { container } = render(<PriorLessonNote lessons={[{ at: '2026-06' }]} />)
    expect(container.querySelector('.priorlesson')).toBeNull()
  })
})
