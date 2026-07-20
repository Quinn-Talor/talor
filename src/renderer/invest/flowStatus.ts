// src/renderer/invest/flowStatus.ts —— 每卡流程状态(从 CardSummary 的 status/claim/validity 派生)
import type { CardSummary } from '@shared/types/invest'

export type FlowStatus = '建立' | '持有' | '待复查' | '校准中' | '已平仓'

/** 循环状态:平仓 > 校准/证伪中 > 尚无逻辑=建立 > 其余=持有。 */
export function flowStatus(c: CardSummary): FlowStatus {
  if (c.status === 'closed') return '已平仓'
  if (!c.claim && !c.validity) return '建立'
  if (c.validity === '校准' || c.validity === '证伪') return '校准中'
  return '持有'
}
