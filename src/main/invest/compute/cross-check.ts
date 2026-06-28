// src/main/invest/compute/cross-check.ts —— 业务层: 多源可靠性交叉校验(确定性)
//
// 关键字段多源取值:相对偏差 (max−min)/|median| > tolerance 则标"存疑"。
// consistent=null 表示单源(无法交叉)。mvp-design §8(可靠性兜底)。
//
// 允许依赖: ./types
// 禁止依赖: ipc/* / repos/* / mcp/*

import type { SourcedValue } from './types'

export interface CrossCheckResult {
  value: number | null // 采用值(中位数); null=无有效输入
  consistent: boolean | null // true=一致; false=存疑; null=单源无法校验
  note: string
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function crossCheck(values: SourcedValue[], tolerance: number): CrossCheckResult {
  const valid = values.filter((v) => Number.isFinite(v.value)).map((v) => v.value)
  if (valid.length === 0) return { value: null, consistent: null, note: '无有效数据' }
  const med = median(valid)
  if (valid.length === 1) return { value: med, consistent: null, note: '单源,无法交叉校验' }
  const spread = (Math.max(...valid) - Math.min(...valid)) / (Math.abs(med) || 1)
  return spread > tolerance
    ? { value: med, consistent: false, note: `多源分歧(偏差${(spread * 100).toFixed(1)}%>阈),存疑` }
    : { value: med, consistent: true, note: '多源一致' }
}
