import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { HallucinatedConfirmDetector, __TEST__ } from './hallucinated-confirm'
import type { OutcomeFacts } from '../outcome-facts'
import type { TalorBlock } from '@shared/talor-blocks/talor-block-schema'

function makeFacts(overrides: Partial<OutcomeFacts> = {}): OutcomeFacts {
  return {
    hasToolCall: true,
    hasText: true,
    hasMarker: false,
    allToolsFailed: null,
    isSubagentFailure: false,
    signature: '',
    noMarkerExit: false,
    toolNames: ['edit'],
    blocks: [] as TalorBlock[],
    invalidBlocks: [],
    hasDone: false,
    hasNeedInput: false,
    hasBlocked: false,
    hasPendingConfirm: false,
    hasWarning: false,
    hasLegacyMarker: false,
    hasTermination: false,
    ...overrides,
  }
}

describe('HallucinatedConfirmDetector', () => {
  let det: HallucinatedConfirmDetector

  beforeEach(() => {
    det = new HallucinatedConfirmDetector()
  })

  it('英文 "user confirmed" + 工具调用 + 无 pending_confirm block → 触发', () => {
    det.observe(makeFacts(), 0, { stepText: 'The user confirmed the operation. Proceeding now.' })
    expect(det.nextHint()).toContain('Hallucinated confirmation')
  })

  it('英文 "approval received" → 触发', () => {
    det.observe(makeFacts(), 0, { stepText: 'Approval received. Executing the SQL.' })
    expect(det.nextHint()).toContain('Hallucinated confirmation')
  })

  it('中文 "用户已确认" → 触发', () => {
    det.observe(makeFacts(), 0, { stepText: '用户已确认,开始执行。' })
    expect(det.nextHint()).toContain('Hallucinated confirmation')
  })

  it('中文 "已获得用户的授权" → 触发', () => {
    det.observe(makeFacts(), 0, { stepText: '已获得用户的授权,开始操作。' })
    expect(det.nextHint()).toContain('Hallucinated confirmation')
  })

  it('已 emit pending_confirm block → 不触发 (走主路径,不算幻觉)', () => {
    const facts = makeFacts({ hasPendingConfirm: true })
    det.observe(facts, 0, { stepText: '用户已确认,开始执行' })
    expect(det.nextHint()).toBeNull()
  })

  it('无工具调用 → 不触发 (纯叙述,不是基于伪造确认行动)', () => {
    const facts = makeFacts({ hasToolCall: false, toolNames: [] })
    det.observe(facts, 0, { stepText: '用户已确认' })
    expect(det.nextHint()).toBeNull()
  })

  it('普通文本不命中 → 不触发', () => {
    det.observe(makeFacts(), 0, { stepText: '正在编辑文件' })
    expect(det.nextHint()).toBeNull()
  })

  it('raw 缺失 → 不触发', () => {
    det.observe(makeFacts(), 0)
    expect(det.nextHint()).toBeNull()
  })

  it('hint 只生效一次 — 下一步 observe 后清除', () => {
    det.observe(makeFacts(), 0, { stepText: 'user confirmed' })
    expect(det.nextHint()).toContain('Hallucinated confirmation')
    det.observe(makeFacts(), 1, { stepText: 'continuing normally' })
    expect(det.nextHint()).toBeNull()
  })
})

describe('__TEST__.hasHallucinatedConfirm', () => {
  const { hasHallucinatedConfirm } = __TEST__

  it('英文 user confirmed', () => {
    expect(hasHallucinatedConfirm('the user confirmed')).toBe(true)
  })

  it('英文 user approved', () => {
    expect(hasHallucinatedConfirm('User approved the change.')).toBe(true)
  })

  it('英文 approval received', () => {
    expect(hasHallucinatedConfirm('Approval received.')).toBe(true)
  })

  it('英文 got user approval', () => {
    expect(hasHallucinatedConfirm('got user approval')).toBe(true)
  })

  it('中文 用户已确认', () => {
    expect(hasHallucinatedConfirm('用户已确认')).toBe(true)
  })

  it('中文 您已批准', () => {
    expect(hasHallucinatedConfirm('您已批准此操作')).toBe(true)
  })

  it('中文 已收到用户的确认', () => {
    expect(hasHallucinatedConfirm('已收到用户的确认')).toBe(true)
  })

  it('客观叙述"用户尚未确认"不误报', () => {
    // 这不是模型自我声称已得到确认 — regex 不应命中
    expect(hasHallucinatedConfirm('用户尚未确认,需要等待')).toBe(false)
  })

  it('空字符串不命中', () => {
    expect(hasHallucinatedConfirm('')).toBe(false)
  })
})
