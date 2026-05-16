// src/renderer/components/talor-blocks/DonePill.tsx
//
// 渲染层: done block — 末尾行内戳。
// Spec §11.1: 4px 绿圆点 + 摘要，无 "Done" 字。

interface DonePillProps {
  summary: string
  metrics?: { tools?: number; duration_ms?: number; files_modified?: number }
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function DonePill({ summary, metrics }: DonePillProps) {
  const parts: string[] = []
  if (metrics?.tools != null) {
    parts.push(`${metrics.tools} tool${metrics.tools === 1 ? '' : 's'}`)
  }
  if (metrics?.duration_ms != null) {
    parts.push(fmt(metrics.duration_ms))
  }
  if (metrics?.files_modified != null) {
    parts.push(`${metrics.files_modified} file${metrics.files_modified === 1 ? '' : 's'}`)
  }

  return (
    <span className="done-pill">
      <span className="done-dot" />
      {parts.length > 0 ? parts.join(' · ') : summary}
    </span>
  )
}
