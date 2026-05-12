import { describe, it, expect } from 'vitest'
import {
  classify,
  hasTerminationMarker,
  hasTerminationInText,
  looksLikeOpenQuestion,
  TERMINATION_MARKERS,
} from './outcome-facts'
import type { StepOutcome } from './types'

function makeOutcome(overrides: Partial<StepOutcome> = {}): StepOutcome {
  return {
    stepText: '',
    wroteAssistantFinal: false,
    shouldContinue: true,
    durationMs: 0,
    toolNames: [],
    signature: '',
    allToolsFailed: null,
    containsSubagentFailure: false,
    ...overrides,
  }
}

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
    // 这是有意的: 接受少量假阴, 防止 fuzzy 匹配把"已完成 (无 ✓)"误判为有 marker
    expect(hasTerminationMarker('任务已完成')).toBe(false)
  })

  it('exports three markers in correct order', () => {
    expect(TERMINATION_MARKERS).toEqual(['✓ Done', '❓ Need input', '⏸ Blocked'])
  })
})

describe('hasTerminationInText (v3.6 合并信号)', () => {
  it('legacy ✓ Done → true', () => {
    expect(hasTerminationInText('all set\n✓ Done')).toBe(true)
  })

  it('talor done block → true', () => {
    expect(hasTerminationInText('```talor\n{"type":"done","summary":"ok"}\n```')).toBe(true)
  })

  it('talor need_input block → true (回归 bug: 模型问问题应触发 final, 不是 continue)', () => {
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

  it('legacy marker + talor done 同时存在 → true', () => {
    expect(hasTerminationInText('✓ Done\n```talor\n{"type":"done","summary":"x"}\n```')).toBe(true)
  })

  it('普通文本无任何 marker → false', () => {
    expect(hasTerminationInText('just running the task...')).toBe(false)
  })

  it('空字符串 → false', () => {
    expect(hasTerminationInText('')).toBe(false)
  })

  it('解析失败的 talor block + 无 legacy marker → false (不能误判为收尾)', () => {
    // invalid JSONC, parse 失败 → 不算 done/need_input/blocked
    expect(hasTerminationInText('```talor\n{not valid\n```')).toBe(false)
  })
})

describe('looksLikeOpenQuestion (v3.6 implicit-question heuristic)', () => {
  it('中文问号 → true', () => {
    expect(looksLikeOpenQuestion('目标市场是哪里?')).toBe(true)
  })

  it('英文问号 → true', () => {
    expect(looksLikeOpenQuestion('What is the target market?')).toBe(true)
  })

  it('问号在中段 → 仍 true', () => {
    expect(looksLikeOpenQuestion('你先答第一个? 其他的不急。')).toBe(true)
  })

  it('列举 3 个选项 X / Y / Z → true', () => {
    expect(looksLikeOpenQuestion('内地 / 香港 / 日本 或者其他')).toBe(true)
  })

  it('列举 5 个选项 → true (回归 bug: "内地 / 香港 / 日本 / 东南亚 / 欧美")', () => {
    expect(looksLikeOpenQuestion('内地 / 香港 / 日本 / 东南亚 / 欧美')).toBe(true)
  })

  it('档次列举 "大奖 / 中奖 / 小奖" → true', () => {
    expect(looksLikeOpenQuestion('比如大奖、中奖、小奖、参与奖')).toBe(false) // 顿号不算
    expect(looksLikeOpenQuestion('大奖 / 中奖 / 小奖 / 参与奖')).toBe(true) // 斜杠列举算
  })

  it('普通叙述无问号无列举 → false', () => {
    expect(looksLikeOpenQuestion('数据库是 game,有 39 张表。我来逐一查看每张表的建表语句。')).toBe(
      false,
    )
  })

  it('代码路径 /etc/foo → false (单层路径不命中三项列举)', () => {
    expect(looksLikeOpenQuestion('config file is at /etc/foo/bar.conf')).toBe(false)
  })

  it('SQL 中的 LIKE %game% → false (无问号且非列举)', () => {
    expect(looksLikeOpenQuestion('SELECT * FROM x WHERE name LIKE %game%')).toBe(false)
  })

  it('完整截图回归 step 1 文本 → true', () => {
    const text =
      '所以重新来,我把需要你确认的列出来,你一个个回我就行:\n' +
      '① 目标市场是哪里? 比如:内地 / 香港 / 日本 / 东南亚 / 欧美? \n' +
      '② 奖品档次怎么分? 比如想要几个档次? 每个档次放什么奖品?'
    expect(looksLikeOpenQuestion(text)).toBe(true)
  })

  it('完整截图回归 step 2 文本 → true', () => {
    const text =
      '好的,那就一个一个来。\n① 目标市场是哪里?\n内地 / 香港 / 日本 / 东南亚 / 欧美 或者其他?'
    expect(looksLikeOpenQuestion(text)).toBe(true)
  })

  it('空字符串 → false', () => {
    expect(looksLikeOpenQuestion('')).toBe(false)
  })

  it('只有空白 → false', () => {
    expect(looksLikeOpenQuestion('   \n\t')).toBe(false)
  })
})

describe('classify', () => {
  it('无工具 + 有 text + 有 marker → 标识正确', () => {
    const outcome = makeOutcome({ stepText: 'done\n\n✓ Done', toolNames: [] })
    const facts = classify(outcome)
    expect(facts.hasToolCall).toBe(false)
    expect(facts.hasText).toBe(true)
    expect(facts.hasMarker).toBe(true)
    expect(facts.noMarkerExit).toBe(false)
  })

  it('无工具 + 有 text + 无 marker + exitReason=no_tool_calls_no_marker → noMarkerExit=true (Fix C 信号)', () => {
    const outcome = makeOutcome({
      stepText: 'preparing to start',
      toolNames: [],
      exitReason: 'no_tool_calls_no_marker',
    })
    const facts = classify(outcome)
    expect(facts.hasText).toBe(true)
    expect(facts.hasMarker).toBe(false)
    expect(facts.noMarkerExit).toBe(true)
  })

  it('有工具 + 无 text → hasToolCall=true, hasText=false', () => {
    const outcome = makeOutcome({ toolNames: ['read', 'write'], stepText: '' })
    const facts = classify(outcome)
    expect(facts.hasToolCall).toBe(true)
    expect(facts.hasText).toBe(false)
  })

  it('allToolsFailed 三态原样透传', () => {
    expect(classify(makeOutcome({ allToolsFailed: null })).allToolsFailed).toBe(null)
    expect(classify(makeOutcome({ allToolsFailed: true })).allToolsFailed).toBe(true)
    expect(classify(makeOutcome({ allToolsFailed: false })).allToolsFailed).toBe(false)
  })

  it('isSubagentFailure 从 containsSubagentFailure 取', () => {
    expect(classify(makeOutcome({ containsSubagentFailure: true })).isSubagentFailure).toBe(true)
    expect(classify(makeOutcome({ containsSubagentFailure: false })).isSubagentFailure).toBe(false)
  })

  it('signature 原样透传', () => {
    expect(classify(makeOutcome({ signature: 'read#abc:def' })).signature).toBe('read#abc:def')
    expect(classify(makeOutcome({ signature: '' })).signature).toBe('')
  })

  it('stepText 仅含空白 → hasText=false', () => {
    expect(classify(makeOutcome({ stepText: '   \n\t  ' })).hasText).toBe(false)
  })
})

describe('classify — v3.6 talor blocks', () => {
  it('done block → hasDone=true, hasTermination=true, hasMarker=true', () => {
    const text = 'all set\n\n```talor\n{"type":"done","summary":"ok"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasDone).toBe(true)
    expect(facts.hasTermination).toBe(true)
    expect(facts.hasMarker).toBe(true) // 别名
    expect(facts.blocks.length).toBe(1)
    expect(facts.blocks[0].type).toBe('done')
  })

  it('need_input block → hasNeedInput=true, hasTermination=true', () => {
    const text = '```talor\n{"type":"need_input","question":"哪种货币?"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasNeedInput).toBe(true)
    expect(facts.hasTermination).toBe(true)
  })

  it('blocked block → hasBlocked=true, hasTermination=true', () => {
    const text = '```talor\n{"type":"blocked","reason":"missing creds"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasBlocked).toBe(true)
    expect(facts.hasTermination).toBe(true)
  })

  it('pending_confirm block → hasPendingConfirm=true, hasTermination=false (mid-turn)', () => {
    const text = '```talor\n{"type":"pending_confirm","summary":"insert row"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasPendingConfirm).toBe(true)
    expect(facts.hasTermination).toBe(false) // mid-turn, 不算收尾
  })

  it('warning block → hasWarning=true, hasTermination=false', () => {
    const text = '```talor\n{"type":"warning","message":"低风险"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasWarning).toBe(true)
    expect(facts.hasTermination).toBe(false)
  })

  it('多个 block 共存 → 各 has* 都置位', () => {
    const text =
      '```talor\n{"type":"pending_confirm","summary":"a"}\n```\n\n' +
      '```talor\n{"type":"warning","message":"b"}\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.hasPendingConfirm).toBe(true)
    expect(facts.hasWarning).toBe(true)
    expect(facts.blocks.length).toBe(2)
  })

  it('legacy 文字 marker (✓ Done) 单独存在 → hasLegacyMarker=true, hasTermination=true', () => {
    const facts = classify(makeOutcome({ stepText: 'done\n\n✓ Done' }))
    expect(facts.hasLegacyMarker).toBe(true)
    expect(facts.hasDone).toBe(false) // 不是 talor block 的 done
    expect(facts.hasTermination).toBe(true)
  })

  it('解析失败的 block → invalidBlocks 非空, blocks 不变', () => {
    const text = '```talor\n{not json at all\n```'
    const facts = classify(makeOutcome({ stepText: text }))
    expect(facts.blocks.length).toBe(0)
    expect(facts.invalidBlocks.length).toBe(1)
    expect(facts.hasTermination).toBe(false)
  })

  it('无 talor + 无 legacy marker → 所有 has* 全 false, hasTermination=false', () => {
    const facts = classify(makeOutcome({ stepText: '普通文本无标记' }))
    expect(facts.hasDone).toBe(false)
    expect(facts.hasNeedInput).toBe(false)
    expect(facts.hasBlocked).toBe(false)
    expect(facts.hasPendingConfirm).toBe(false)
    expect(facts.hasWarning).toBe(false)
    expect(facts.hasLegacyMarker).toBe(false)
    expect(facts.hasTermination).toBe(false)
  })
})
