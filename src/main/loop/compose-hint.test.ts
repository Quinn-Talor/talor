import { describe, it, expect } from 'vitest'
import { composeHint } from './compose-hint'
import type { LoopDetector, DetectorVerdict } from './detectors/types'
import { NO_TRIGGER } from './detectors/types'

/** 测试用 mock detector,nextHint 可选; observe 总返回 NO_TRIGGER。 */
function makeDetector(name: string, hint: string | null = null): LoopDetector {
  return {
    name,
    observe(): DetectorVerdict {
      return NO_TRIGGER
    },
    nextHint() {
      return hint
    },
  }
}

/** 没声明 nextHint 方法的 detector (合法的接口实现 — nextHint 可选)。 */
function makeDetectorNoHint(name: string): LoopDetector {
  return {
    name,
    observe(): DetectorVerdict {
      return NO_TRIGGER
    },
  }
}

describe('composeHint', () => {
  it('空 detector 数组 → null', () => {
    expect(composeHint([])).toBeNull()
  })

  it('单个 detector 有 hint → 返回该 hint', () => {
    expect(composeHint([makeDetector('a', 'hint-a')])).toBe('hint-a')
  })

  it('单个 detector nextHint=null → null', () => {
    expect(composeHint([makeDetector('a', null)])).toBeNull()
  })

  it('单个 detector 不实现 nextHint → null (不抛错)', () => {
    expect(composeHint([makeDetectorNoHint('a')])).toBeNull()
  })

  it('多个 detector: 第一个有 hint → 返回第一个 (priority 优先)', () => {
    // 模拟主循环顺序: failure-streak > no-marker-streak
    const detectors = [
      makeDetector('failure', 'failure-hint'),
      makeDetector('marker', 'marker-hint'),
    ]
    expect(composeHint(detectors)).toBe('failure-hint')
  })

  it('多个 detector: 第一个无 hint, 第二个有 → 返回第二个 (fallthrough)', () => {
    const detectors = [makeDetector('failure', null), makeDetector('marker', 'marker-hint')]
    expect(composeHint(detectors)).toBe('marker-hint')
  })

  it('多个 detector 都无 hint → null', () => {
    const detectors = [makeDetector('a', null), makeDetectorNoHint('b'), makeDetector('c', null)]
    expect(composeHint(detectors)).toBeNull()
  })

  it('空字符串视为无 hint (falsy check) → 继续 fallthrough', () => {
    // 注: composeHint 用 `if (hint)` 判定, 空字符串走 falsy 分支
    const detectors = [makeDetector('a', ''), makeDetector('b', 'b-hint')]
    expect(composeHint(detectors)).toBe('b-hint')
  })
})
