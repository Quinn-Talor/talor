// GitHub 风格的紧凑计数缩写,用于 token 统计展示。
//   < 1,000          → 原样整数        (96, 942)
//   1,000 – 9,999    → 1 位小数 + k     (1.9k, 9.4k;去掉 .0 → 2k)
//   10,000 – 999,999 → 整数 + k         (25k, 106k)
//   ≥ 1,000,000      → 1 位小数 + M     (1.3M, 12M;去掉 .0 → 3M)
// 精确值另放 UI 的 title 悬浮提示,这里只负责紧凑显示。

function stripDotZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'

  if (n < 1000) return String(Math.round(n))

  if (n < 1_000_000) {
    const k = n / 1000
    if (k < 10) {
      // 9.96k → toFixed(1)="10.0" → "10k",自然过渡到整数 k,符合预期
      return stripDotZero(k.toFixed(1)) + 'k'
    }
    const ik = Math.round(k)
    if (ik >= 1000) return '1M' // 999,500 等边界四舍五入升到 M
    return ik + 'k'
  }

  const m = n / 1_000_000
  return stripDotZero(m.toFixed(1)) + 'M'
}
