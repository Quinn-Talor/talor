// src/renderer/components/talor-blocks/WarningRow.tsx
//
// 渲染层: warning block — 行内 row，severity 决定圆点颜色。
// Spec §11.1: low=blue, medium=orange, high=red。high 时 body 红色加粗。无 "warning" 字。

interface WarningRowProps {
  message: string
  severity?: 'low' | 'medium' | 'high'
}

export function WarningRow({ message, severity = 'medium' }: WarningRowProps) {
  return (
    <div className={`warn-row warn-${severity}`}>
      <span className="warn-dot" />
      <span className="warn-body">{message}</span>
    </div>
  )
}
