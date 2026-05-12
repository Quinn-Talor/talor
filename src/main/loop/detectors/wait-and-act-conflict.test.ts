import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { WaitAndActConflictDetector, __TEST__ } from './wait-and-act-conflict'
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

describe('WaitAndActConflictDetector', () => {
  let det: WaitAndActConflictDetector

  beforeEach(() => {
    det = new WaitAndActConflictDetector()
  })

  it('英文 wait 意图 + side-effect 工具 → 触发 (hint 出现)', () => {
    const facts = makeFacts({ toolNames: ['edit'] })
    const raw = { stepText: 'I will wait for your approval before proceeding.' }
    const v = det.observe(facts, 0, raw)
    expect(v.triggered).toBe(false) // 不 break 主循环
    const hint = det.nextHint()
    expect(hint).toContain('Wait/Act conflict')
    // hint 教模型用 talor need_input block (不是只写 legacy marker)
    expect(hint).toContain('```talor')
    expect(hint).toContain('"type":"need_input"')
    // pending_confirm 引导 (有副作用时的另一选项)
    expect(hint).toContain('pending_confirm')
  })

  it('中文 "等用户确认" + side-effect 工具 → 触发', () => {
    const facts = makeFacts({ toolNames: ['bash'] })
    const raw = { stepText: '让我等您确认后再执行。' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toContain('Wait/Act conflict')
  })

  it('wait 意图 + 只读工具 (read) → 不触发', () => {
    const facts = makeFacts({ toolNames: ['read'] })
    const raw = { stepText: 'waiting for your input' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toBeNull()
  })

  it('wait 意图 + 已 emit need_input block → 不触发 (结构化等待已表达)', () => {
    const facts = makeFacts({
      toolNames: ['edit'],
      hasNeedInput: true,
    })
    const raw = { stepText: '等您回复后再继续' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toBeNull()
  })

  it('wait 意图 + 已 emit pending_confirm block → 不触发', () => {
    const facts = makeFacts({
      toolNames: ['bash'],
      hasPendingConfirm: true,
    })
    const raw = { stepText: 'waiting for confirmation' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toBeNull()
  })

  it('无工具调用 → 不触发', () => {
    const facts = makeFacts({ hasToolCall: false, toolNames: [] })
    const raw = { stepText: 'I will wait for your reply' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toBeNull()
  })

  it('无 wait 意图 + 调工具 → 不触发', () => {
    const facts = makeFacts({ toolNames: ['edit'] })
    const raw = { stepText: 'Editing the config file now.' }
    det.observe(facts, 0, raw)
    expect(det.nextHint()).toBeNull()
  })

  it('raw 缺失 → 不触发 (向后兼容)', () => {
    const facts = makeFacts({ toolNames: ['edit'] })
    det.observe(facts, 0)
    expect(det.nextHint()).toBeNull()
  })

  it('hint 只生效一次 — 下一步 observe 后即清除', () => {
    const facts = makeFacts({ toolNames: ['edit'] })
    det.observe(facts, 0, { stepText: 'I will wait for you' })
    expect(det.nextHint()).toContain('Wait/Act conflict')
    // 下一步无冲突
    det.observe(makeFacts({ toolNames: ['edit'] }), 1, { stepText: 'normal' })
    expect(det.nextHint()).toBeNull()
  })

  it('extraReadOnlyTools 把 MCP 工具加入只读 → 不触发', () => {
    const customDet = new WaitAndActConflictDetector({
      extraReadOnlyTools: new Set(['mysql_query']),
    })
    const facts = makeFacts({ toolNames: ['mysql_query'] })
    customDet.observe(facts, 0, { stepText: 'wait for your approval' })
    expect(customDet.nextHint()).toBeNull()
  })
})

describe('__TEST__.hasWaitIntent', () => {
  const { hasWaitIntent } = __TEST__

  it('英文 waiting for', () => {
    expect(hasWaitIntent('waiting for user input')).toBe(true)
  })

  it('英文 hold off', () => {
    expect(hasWaitIntent("Let's hold off until tomorrow")).toBe(true)
  })

  it('英文 before proceeding', () => {
    expect(hasWaitIntent('Before proceeding, I need clarification.')).toBe(true)
  })

  it('中文 等用户确认', () => {
    expect(hasWaitIntent('等用户确认')).toBe(true)
  })

  it('中文 暂停', () => {
    expect(hasWaitIntent('我先暂停操作')).toBe(true)
  })

  it('中文 等您回复后', () => {
    expect(hasWaitIntent('等您回复后我继续')).toBe(true)
  })

  it('普通描述不命中', () => {
    expect(hasWaitIntent('正在执行编辑操作')).toBe(false)
  })

  it('空字符串不命中', () => {
    expect(hasWaitIntent('')).toBe(false)
  })
})
