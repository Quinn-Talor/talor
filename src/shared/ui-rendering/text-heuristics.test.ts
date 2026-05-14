import { describe, it, expect } from 'vitest'
import {
  hasTerminationMarker,
  hasTerminationInText,
  looksLikeOpenQuestion,
  TERMINATION_MARKERS,
} from './text-heuristics'

describe('hasTerminationMarker', () => {
  it('✓ Done → true', () => {
    expect(hasTerminationMarker('task complete\n\n✓ Done')).toBe(true)
  })

  it('❓ Need input → true', () => {
    expect(hasTerminationMarker('I need workspace id\n❓ Need input — provide path')).toBe(true)
  })

  it('⏸ Blocked → true', () => {
    expect(hasTerminationMarker('⏸ Blocked — missing API key')).toBe(true)
  })

  it('marker 出现在文本中间也算', () => {
    expect(hasTerminationMarker('start ✓ Done end')).toBe(true)
  })

  it('完全无 marker → false', () => {
    expect(hasTerminationMarker('plain text without any marker')).toBe(false)
  })

  it('空字符串 → false', () => {
    expect(hasTerminationMarker('')).toBe(false)
  })

  it('"已完成" (中文同义) 不匹配 (严格 includes 设计)', () => {
    expect(hasTerminationMarker('任务已完成')).toBe(false)
  })

  it('exports three markers in correct order', () => {
    expect(TERMINATION_MARKERS).toEqual(['✓ Done', '❓ Need input', '⏸ Blocked'])
  })
})

describe('hasTerminationInText (lightweight, UI 用)', () => {
  it('legacy ✓ Done → true', () => {
    expect(hasTerminationInText('all set\n✓ Done')).toBe(true)
  })

  it('talor done block → true', () => {
    expect(hasTerminationInText('```talor\n{"type":"done","summary":"ok"}\n```')).toBe(true)
  })

  it('talor need_input block → true', () => {
    expect(hasTerminationInText('```talor\n{"type":"need_input","question":"X?"}\n```')).toBe(true)
  })

  it('talor blocked block → true', () => {
    expect(hasTerminationInText('```talor\n{"type":"blocked","reason":"missing creds"}\n```')).toBe(
      true,
    )
  })

  it('talor pending_confirm 不算收尾 (mid-turn,要配 tool call)', () => {
    expect(hasTerminationInText('```talor\n{"type":"pending_confirm","summary":"X"}\n```')).toBe(
      false,
    )
  })

  it('talor warning 不算收尾', () => {
    expect(hasTerminationInText('```talor\n{"type":"warning","message":"X"}\n```')).toBe(false)
  })

  it('普通文本无任何 marker → false', () => {
    expect(hasTerminationInText('just running the task...')).toBe(false)
  })

  it('空字符串 → false', () => {
    expect(hasTerminationInText('')).toBe(false)
  })

  it('损坏的 talor block (无 type) → false', () => {
    expect(hasTerminationInText('```talor\n{not valid\n```')).toBe(false)
  })
})

describe('looksLikeOpenQuestion', () => {
  it('中文问号 → true', () => {
    expect(looksLikeOpenQuestion('目标市场是哪里?')).toBe(true)
  })

  it('英文问号 → true', () => {
    expect(looksLikeOpenQuestion('What is the target market?')).toBe(true)
  })

  it('斜杠列举 X / Y / Z → true', () => {
    expect(looksLikeOpenQuestion('内地 / 香港 / 日本 或者其他')).toBe(true)
  })

  it('截图回归: 多选项斜杠列举 → true', () => {
    expect(looksLikeOpenQuestion('内地 / 香港 / 日本 / 东南亚 / 欧美')).toBe(true)
  })

  it('普通陈述无信号 → false', () => {
    expect(looksLikeOpenQuestion('数据库是 game,有 39 张表。')).toBe(false)
  })

  it('代码路径 /etc/foo/bar → 不误命中 (无空白斜杠)', () => {
    expect(looksLikeOpenQuestion('config at /etc/foo/bar.conf')).toBe(false)
  })

  it('空字符串 → false', () => {
    expect(looksLikeOpenQuestion('')).toBe(false)
  })
})
