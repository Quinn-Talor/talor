// src/main/invest/compute/trend.ts —— 业务层: 多窗口趋势 + 动能(确定性)
//
// 事实不是孤立数字,是"当前值 + 多窗口趋势"。窗口频率无关(由调用方按事实频率给):
//   日频 → [5,10,30,60] 交易日;报告期 → [1,4] (QoQ/YoY)。
// series 时间序列(老→新, current=末值);window=回溯步数。
// momentum 反映"趋势的趋势"(加速/钝化/拐头),由短/长窗口归一化变化率比较得出。
// mvp-design §2.2 / §8.2。
//
// 允许依赖: ./types
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { TrendWindow, TrendResult } from './types'

const NOISE = 0.01 // 变化率噪声阈(±1%),防横盘被标 up/down
const MOM_EPS = 0.001 // 每步动能噪声阈

function dir(change: number, changePct: number | null): 'up' | 'down' | 'flat' {
  const ref = changePct ?? change
  if (ref > NOISE) return 'up'
  if (ref < -NOISE) return 'down'
  return 'flat'
}

export function computeTrend(series: number[], windows: number[]): TrendResult {
  const n = series.length
  const current = n > 0 ? series[n - 1] : NaN

  const out: TrendWindow[] = windows.map((w) => {
    const past = n >= w + 1 ? series[n - 1 - w] : NaN
    if (!Number.isFinite(current) || !Number.isFinite(past)) {
      return { window: w, change: null, change_pct: null, direction: null }
    }
    const change = current - past
    const change_pct = past !== 0 ? change / Math.abs(past) : null
    return { window: w, change, change_pct, direction: dir(change, change_pct) }
  })

  // momentum:取最短与最长两个"有 change_pct 的窗口",比较每步归一化变化率
  const usable = out.filter((t) => t.change_pct !== null).sort((a, b) => a.window - b.window)
  let momentum: TrendResult['momentum'] = null
  if (usable.length >= 2) {
    const shortW = usable[0]
    const longW = usable[usable.length - 1]
    const perShort = (shortW.change_pct as number) / shortW.window
    const perLong = (longW.change_pct as number) / longW.window
    if (Math.abs(perShort) < MOM_EPS && Math.abs(perLong) < MOM_EPS) momentum = 'flat'
    else if (perShort * perLong < 0) momentum = 'reversing'
    else if (Math.abs(perShort) > Math.abs(perLong)) momentum = 'accelerating'
    else momentum = 'decelerating'
  }

  return { windows: out, momentum }
}
