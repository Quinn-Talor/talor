import { useState } from 'react'
import type { ModelInfo, ModelCapability } from '@shared/types/models'
import { getCapabilityDetail } from '../lib/capability-detail'

interface ModelCardProps {
  model: ModelInfo
  isSelected?: boolean
  onSelect?: (modelId: string) => void
  compact?: boolean
}

interface CapabilityBadgeProps {
  capability: ModelCapability
  compact?: boolean
}

function CapabilityBadge({ capability, compact = false }: CapabilityBadgeProps) {
  const [showDetail, setShowDetail] = useState(false)
  const detail = getCapabilityDetail(capability)

  const CATEGORY_STYLES: Record<
    ModelCapability['category'],
    { bg: string; text: string; icon: string }
  > = {
    text: { bg: 'bg-gray-100', text: 'text-gray-700', icon: '📝' },
    vision: { bg: 'bg-blue-100', text: 'text-blue-700', icon: '🖼️' },
    tools: { bg: 'bg-amber-100', text: 'text-amber-700', icon: '🔧' },
    video: { bg: 'bg-purple-100', text: 'text-purple-700', icon: '🎥' },
    audio: { bg: 'bg-green-100', text: 'text-green-700', icon: '🎵' },
  }

  const style = CATEGORY_STYLES[capability.category] ?? {
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    icon: '❓',
  }

  if (compact) {
    return (
      <div className="inline-block">
        <span
          className={`px-1.5 py-0.5 text-xs rounded ${style.bg} ${style.text} cursor-pointer hover:opacity-80 inline-flex items-center gap-0.5`}
          title={`${detail.label} — 点击查看详情`}
          onClick={(e) => {
            e.stopPropagation()
            setShowDetail(!showDetail)
          }}
          data-testid={`capability-badge-${capability.type}`}
          role="button"
          aria-expanded={showDetail}
        >
          {style.icon}
        </span>
        {showDetail && (
          <div
            className="absolute z-10 mt-1 p-3 rounded-lg border border-gray-200 bg-white shadow-lg text-xs space-y-2 w-64"
            data-testid={`capability-detail-${capability.type}`}
          >
            <div className="font-medium text-gray-800">{detail.label}</div>
            <p className="text-gray-600">{detail.description}</p>
            {detail.examples.length > 0 && (
              <ul className="space-y-0.5">
                {detail.examples.map((ex, i) => (
                  <li key={i} className="text-gray-500 flex items-start gap-1">
                    <span className="text-gray-400 shrink-0">•</span>
                    <span>{ex}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail.testHint && (
              <p
                className="text-primary-600 flex items-center gap-1"
                data-testid={`capability-test-hint-${capability.type}`}
              >
                <span>💡</span>
                <span>{detail.testHint}</span>
              </p>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="inline-block">
      <button
        type="button"
        className={`px-2 py-1 text-xs font-medium rounded-full flex items-center gap-1 transition-colors ${
          showDetail
            ? `${style.bg} ${style.text} ring-2 ring-offset-1 ring-current`
            : `${style.bg} ${style.text} hover:opacity-80`
        }`}
        onClick={(e) => {
          e.stopPropagation()
          setShowDetail(!showDetail)
        }}
        data-testid={`capability-badge-${capability.type}`}
        aria-expanded={showDetail}
        aria-label={`${detail.label} — 点击查看详情`}
      >
        <span>{style.icon}</span>
        <span>{detail.label}</span>
      </button>

      {showDetail && (
        <div
          className="mt-2 p-3 rounded-lg border border-gray-200 bg-gray-50 text-xs space-y-2"
          data-testid={`capability-detail-${capability.type}`}
        >
          <p className="text-gray-700">{detail.description}</p>

          {detail.examples.length > 0 && (
            <div>
              <p className="font-medium text-gray-500 mb-1">使用示例</p>
              <ul className="space-y-0.5">
                {detail.examples.map((example, i) => (
                  <li key={i} className="text-gray-600 flex items-start gap-1">
                    <span className="text-gray-400 shrink-0">•</span>
                    <span>{example}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {detail.testHint && (
            <p
              className="text-primary-600 cursor-default flex items-center gap-1"
              data-testid={`capability-test-hint-${capability.type}`}
            >
              <span>💡</span>
              <span>{detail.testHint}</span>
            </p>
          )}

          {capability.detected_at && (
            <p className="text-gray-400">
              检测时间: {new Date(capability.detected_at).toLocaleString()}
              {capability.source !== 'auto' && (
                <span className="ml-2 px-1 py-0.5 rounded bg-yellow-100 text-yellow-700">
                  {capability.source === 'manual' ? '用户指定' : '默认值'}
                </span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function ModelCard({
  model,
  isSelected = false,
  onSelect,
  compact = false,
}: ModelCardProps) {
  const handleClick = () => {
    if (onSelect) {
      onSelect(model.id)
    }
  }

  if (compact) {
    const supportedCaps = model.capabilities.filter((c) => c.supported)
    return (
      <div
        className={`p-3 rounded-lg border transition-colors cursor-pointer ${
          isSelected
            ? 'border-primary-400 bg-primary-50'
            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
        }`}
        onClick={handleClick}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">{model.display_name}</h4>
            <p className="text-xs text-gray-500 truncate mt-0.5">{model.name}</p>
          </div>
          <div className="flex items-center gap-1 ml-2 shrink-0 relative">
            {supportedCaps.length > 0 ? (
              supportedCaps.map((cap) => (
                <CapabilityBadge key={cap.type} capability={cap} compact={true} />
              ))
            ) : (
              <>
                {model.supports_vision && (
                  <span
                    className="px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-600"
                    title="图片理解"
                  >
                    🖼️
                  </span>
                )}
                {model.supports_tools && (
                  <span
                    className="px-1.5 py-0.5 text-xs rounded bg-amber-100 text-amber-600"
                    title="工具调用"
                  >
                    🔧
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        {model.description && (
          <p className="text-xs text-gray-400 mt-2 line-clamp-2">{model.description}</p>
        )}
      </div>
    )
  }

  return (
    <div
      className={`p-4 rounded-xl border transition-colors ${onSelect ? 'cursor-pointer' : ''} ${
        isSelected
          ? 'border-primary-400 bg-primary-50'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
      }`}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium text-gray-900 truncate">{model.display_name}</h4>
            <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
              {model.provider_id.split('/')[0]}
            </span>
          </div>
          <p className="text-xs text-gray-500 truncate mb-2">{model.id}</p>

          {model.description && <p className="text-sm text-gray-600 mb-3">{model.description}</p>}

          <div className="flex flex-wrap gap-1.5">
            {model.capabilities
              .filter((c) => c.supported)
              .map((cap) => (
                <CapabilityBadge key={cap.type} capability={cap} />
              ))}
            {model.max_tokens && (
              <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                {model.max_tokens.toLocaleString()} tokens
              </span>
            )}
          </div>
        </div>

        {onSelect && (
          <div className="shrink-0">
            {isSelected ? (
              <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                >
                  <polyline points="20,6 9,17 4,12" />
                </svg>
              </div>
            ) : (
              <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
