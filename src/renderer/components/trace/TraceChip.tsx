// src/renderer/components/trace/TraceChip.tsx — 渲染层: 一轮对话末尾的 Trace 入口

export interface TraceChipProps {
  traceId: string
  onOpen: (traceId: string) => void
}

export function TraceChip({ traceId, onOpen }: TraceChipProps) {
  return (
    <div className="pl-[32px] mb-3">
      <button
        type="button"
        onClick={() => onOpen(traceId)}
        title={`trace ${traceId}`}
        className="rounded border border-line px-2 py-0.5 text-[11px] text-mute transition-colors hover:bg-surface hover:text-text"
      >
        Trace
      </button>
    </div>
  )
}
