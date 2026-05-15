// src/renderer/components/talor-blocks/BlockedRow.tsx
//
// 渲染层: blocked block — 行内 row。
// Spec §11.1: 6px 橙圆点 + body + 内联 retry link，无 "blocked" 字。

interface BlockedRowProps {
  reason: string
  retry_hint?: string
  onRetry?: () => void
}

export function BlockedRow({ reason, retry_hint, onRetry }: BlockedRowProps) {
  return (
    <div className="blocked-row">
      <span className="blocked-dot" />
      <div className="blocked-body">
        <div>{reason}</div>
        {retry_hint && (
          <div className="blocked-hint">
            {retry_hint}
            {onRetry && (
              <>
                {' '}
                <button type="button" className="blocked-retry" onClick={onRetry}>
                  retry ↻
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
