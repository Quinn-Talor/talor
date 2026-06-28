// src/main/invest/compute/percentile.ts —— 业务层: 历史分位(确定性)
//
// 当前值在历史序列中的分位 = (历史中 ≤ current 的个数) / 有效样本数(理杏仁口径)。
// 用于 PE/PB/股息 历史分位。空序列/当前 NaN 返回 null。
// 注: [10,20,30,40,50] @ 30 = 3/5 = 0.6(含自身,≤口径),非 0.5。
//
// 允许依赖: 无
// 禁止依赖: ipc/* / repos/* / mcp/*

export function computePercentile(history: number[], current: number): number | null {
  const valid = history.filter((x) => Number.isFinite(x))
  if (valid.length === 0 || !Number.isFinite(current)) return null
  const below = valid.filter((x) => x <= current).length
  return below / valid.length
}
