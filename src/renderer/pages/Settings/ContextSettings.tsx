import { useEffect, useState, useCallback } from 'react'
import { talorAPI } from '../../api/talorAPI'

const CONTEXT_LIMIT_STOPS = [8_000, 32_000, 128_000, 512_000, 1_000_000, 2_000_000] as const

function formatContextLimit(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
  return String(v)
}

function nearestStopIndex(value: number): number {
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < CONTEXT_LIMIT_STOPS.length; i++) {
    const d = Math.abs(CONTEXT_LIMIT_STOPS[i] - value)
    if (d < bestDiff) { bestDiff = d; best = i }
  }
  return best
}

export function ContextSettings() {
  const [contextLimit, setContextLimit] = useState<number>(1_000_000)
  const [recentRatio, setRecentRatio] = useState<number>(0.05)
  const [summaryRatio, setSummaryRatio] = useState<number>(0.05)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    talorAPI.config.get().then((cfg: unknown) => {
      const c = cfg as { default_context_limit?: number; default_recent_ratio?: number; default_summary_ratio?: number }
      if (typeof c.default_context_limit === 'number') setContextLimit(c.default_context_limit)
      if (typeof c.default_recent_ratio === 'number') setRecentRatio(c.default_recent_ratio)
      if (typeof c.default_summary_ratio === 'number') setSummaryRatio(c.default_summary_ratio)
      setLoaded(true)
    })
  }, [])

  const save = useCallback(async (patch: Record<string, number>) => {
    await talorAPI.config.save(patch)
  }, [])

  if (!loaded) return null

  const limitIdx = nearestStopIndex(contextLimit)

  return (
    <div className="bg-white rounded-xl p-5 space-y-5" style={{ border: '1px solid #e8eaed' }}>
      <div>
        <div className="text-[13px] font-medium text-gray-700 mb-1">上下文窗口（Context Limit）</div>
        <div className="text-[11px] text-gray-400 mb-2">
          Provider 未单独设置时使用此值。下次对话立即生效。
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <input
              type="range"
              min={0}
              max={CONTEXT_LIMIT_STOPS.length - 1}
              step={1}
              value={limitIdx}
              onChange={(e) => {
                const v = CONTEXT_LIMIT_STOPS[Number(e.target.value)]
                setContextLimit(v)
                save({ default_context_limit: v })
              }}
              className="w-full block"
            />
            <div className="relative h-4 mt-1">
              {CONTEXT_LIMIT_STOPS.map((v, i) => {
                const pct = (i / (CONTEXT_LIMIT_STOPS.length - 1)) * 100
                return (
                  <span
                    key={v}
                    className="absolute text-[10px] text-gray-400 tabular-nums"
                    style={{ left: `${pct}%`, transform: 'translateX(-50%)', top: 0 }}
                  >
                    {formatContextLimit(v)}
                  </span>
                )
              })}
            </div>
          </div>
          <span className="text-[13px] font-medium text-gray-700 w-14 text-right tabular-nums">
            {formatContextLimit(contextLimit)}
          </span>
        </div>
      </div>

      <div>
        <div className="text-[13px] font-medium text-gray-700 mb-1">最近消息保留比例（Recent Ratio）</div>
        <div className="text-[11px] text-gray-400 mb-2">
          压缩触发时，保留最近 {Math.round(recentRatio * 100)}% 窗口的原始消息不参与摘要。
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={Math.round(recentRatio * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setRecentRatio(v)
              save({ default_recent_ratio: v })
            }}
            className="flex-1"
          />
          <span className="text-[13px] font-medium text-gray-700 w-14 text-right tabular-nums">
            {Math.round(recentRatio * 100)}%
          </span>
        </div>
      </div>

      <div>
        <div className="text-[13px] font-medium text-gray-700 mb-1">摘要预算比例（Summary Ratio）</div>
        <div className="text-[11px] text-gray-400 mb-2">
          压缩后摘要占窗口 {Math.round(summaryRatio * 100)}%；过大会占用有效上下文，过小摘要不完整。
        </div>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={Math.round(summaryRatio * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100
              setSummaryRatio(v)
              save({ default_summary_ratio: v })
            }}
            className="flex-1"
          />
          <span className="text-[13px] font-medium text-gray-700 w-14 text-right tabular-nums">
            {Math.round(summaryRatio * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}
