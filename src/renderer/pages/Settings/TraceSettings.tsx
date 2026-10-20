// src/renderer/pages/Settings/TraceSettings.tsx — 渲染层: 对话追踪(turn trace)设置
//
// 读写 config.trace(经通用 config:get / config:save,与 ContextSettings 同路径);下一轮对话生效。

import { useCallback, useEffect, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'
import { resolveTraceConfig, type TraceConfig } from '@shared/types/trace'

const DAYS_PATTERN = /^\d+$/

export function TraceSettings() {
  const [config, setConfig] = useState<TraceConfig | null>(null)
  const [daysInput, setDaysInput] = useState('')

  useEffect(() => {
    talorAPI.config.get().then((raw: unknown) => {
      const c = resolveTraceConfig((raw as { trace?: unknown }).trace)
      setConfig(c)
      setDaysInput(String(c.retentionDays))
    })
  }, [])

  const save = useCallback(
    async (patch: Partial<TraceConfig>) => {
      if (!config) return
      const next = { ...config, ...patch }
      setConfig(next)
      await talorAPI.config.save({ trace: next })
    },
    [config],
  )

  if (!config) return null

  const daysValid = DAYS_PATTERN.test(daysInput)
  const commitDays = () => {
    if (daysValid && Number(daysInput) !== config.retentionDays) {
      void save({ retentionDays: Number(daysInput) })
    }
  }

  return (
    <div className="bg-white rounded-xl p-5 space-y-5" style={{ border: '1px solid #e8eaed' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-gray-700 mb-1">对话追踪（Trace）</div>
          <div className="text-[11px] text-gray-400">
            记录每轮对话的模型调用、工具、守卫判断与耗时，可在对话末尾的 Trace
            入口查看。下一轮对话生效。
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-gray-600 shrink-0">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          启用
        </label>
      </div>

      <div>
        <div className="text-[13px] font-medium text-gray-700 mb-1">保留天数（Retention Days）</div>
        <div className="text-[11px] text-gray-400 mb-2">启动时清理更早的 trace；0 表示不清理。</div>
        <input
          type="text"
          inputMode="numeric"
          value={daysInput}
          onChange={(e) => setDaysInput(e.target.value.trim())}
          onBlur={commitDays}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDays()
          }}
          className="w-24 rounded-md px-2 py-1 text-[13px] tabular-nums outline-none"
          style={{ border: `1px solid ${daysValid ? '#e8eaed' : '#ef4444'}` }}
          aria-invalid={!daysValid}
        />
      </div>
    </div>
  )
}
