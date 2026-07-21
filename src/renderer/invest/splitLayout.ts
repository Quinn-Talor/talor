// src/renderer/invest/splitLayout.ts —— 中|右 分区拖拽:convo(右)宽度夹取
// 右栏可拖,中间 canvas(flex-grow)吸收增减;保证 canvas 不被压过 CANVAS_MIN。
export const CONVO_MIN = 280
export const CONVO_MAX = 560
export const POOL_W = 190
export const SPLIT_W = 6
export const CANVAS_MIN = 250
export const CONVO_DEFAULT = 320

/** 期望 convo 宽 → 夹到 [CONVO_MIN, min(CONVO_MAX, 窗内为 canvas 留够 CANVAS_MIN 的上限)]。 */
export function clampConvoWidth(desired: number, bodyWidth: number): number {
  const hi = Math.max(CONVO_MIN, Math.min(CONVO_MAX, bodyWidth - POOL_W - SPLIT_W - CANVAS_MIN))
  return Math.round(Math.min(Math.max(desired, CONVO_MIN), hi))
}
