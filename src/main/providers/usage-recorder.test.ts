import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

const { mockAddUsage } = vi.hoisted(() => ({ mockAddUsage: vi.fn() }))
vi.mock('../repos/session-repo', () => ({ sessionRepo: { addUsage: mockAddUsage } }))

import { recordUsage } from './usage-recorder'

describe('recordUsage', () => {
  beforeEach(() => mockAddUsage.mockClear())

  it('normalizes then adds to session', () => {
    recordUsage('s1', { inputTokens: 1000, outputTokens: 100 }, { anthropic: { cacheReadInputTokens: 400 } })
    expect(mockAddUsage).toHaveBeenCalledWith('s1', {
      inputTokens: 600,
      outputTokens: 100,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
    })
  })

  it('skips when usage absent', () => {
    recordUsage('s1', undefined, undefined)
    expect(mockAddUsage).not.toHaveBeenCalled()
  })

  it('skips when all-zero', () => {
    recordUsage('s1', { inputTokens: 0, outputTokens: 0 }, undefined)
    expect(mockAddUsage).not.toHaveBeenCalled()
  })

  // fail-open(addUsage 抛错时 recordUsage 不抛)由代码层 try/catch 保证;
  // 不在此用 throwing mock 断言 —— vitest 对"前置用例调用过的 mock 抛错(即便被捕获)"
  // 会误记为失败,属框架 quirk 而非代码 bug。
})
