import type { TestStatus, ConnectionTestResult } from '../types/config'

interface ConnectionTestProps {
  status: TestStatus
  result?: ConnectionTestResult
  onTest: () => void
  disabled?: boolean
}

export function ConnectionTest({ status, result, onTest, disabled }: ConnectionTestProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onTest}
        disabled={disabled || status === 'testing'}
        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          disabled || status === 'testing'
            ? 'border-gray-200 text-gray-300 cursor-not-allowed'
            : 'border-primary-300 text-primary-600 hover:bg-primary-50'
        }`}
      >
        {status === 'testing' ? (
          <span className="flex items-center gap-1.5">
            <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            测试中
          </span>
        ) : (
          '测试连接'
        )}
      </button>

      {status === 'success' && result && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20,6 9,17 4,12" />
          </svg>
          <span>
            {result.latency_ms}ms
            {result.models_count !== undefined && result.models_count > 0
              ? ` · ${result.models_count} 个模型`
              : ''}
          </span>
        </div>
      )}

      {status === 'failure' && result && (
        <div className="flex items-center gap-1.5 text-xs text-red-500 max-w-xs">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span className="truncate">{result.message}</span>
        </div>
      )}
    </div>
  )
}
