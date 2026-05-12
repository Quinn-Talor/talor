// src/main/loop/streak-counter.ts —— 业务层: 计数器原语
//
// 抽取主循环中重复出现的"streak 计数器"模式: 累计到阈值即触发, 否则可 reset。
// 对应原 4 个散落 counter (consecutiveFailureCount / consecutiveToolOnlySteps /
// consecutiveNoMarkerExits / signature 重复计数)。
//
// 注意: 本类不知道"什么时候应该 bump / 什么时候应该 reset" — 这是业务决策,
// 由调用方 (Detector) 根据 OutcomeFacts 判断。本类只管计数 + 阈值判定。
//
// 允许依赖: 无
// 禁止依赖: ipc/*

export class StreakCounter {
  private count = 0

  /**
   * @param limit 阈值; bump 累计 >= limit 时 bump() 返回 true (触发)。
   *              典型值: failure-streak=3 / tool-only=8 / no-marker=3 / signature-with-error=1 / signature-no-error=2
   */
  constructor(public readonly limit: number) {
    if (limit < 1) throw new Error(`StreakCounter limit must be >= 1, got ${limit}`)
  }

  /**
   * 累计计数。返回 true 表示达到阈值 (调用方应触发对应动作)。
   *
   * @param weight 加权步长 (默认 1)。subagent 失败用 +2 让 forced-recovery 更早触发。
   */
  bump(weight = 1): boolean {
    this.count += weight
    return this.count >= this.limit
  }

  /** 计数清零 (业务条件满足时调用方主动 reset)。 */
  reset(): void {
    this.count = 0
  }

  /** 当前计数 (供 hint 注入等场景读取, 如 streak == limit-1 时发警告 hint)。 */
  get value(): number {
    return this.count
  }
}
