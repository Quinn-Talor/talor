import type { ToolConfirmRequest } from '@shared/types/message'

interface ToolConfirmDialogProps {
  request: ToolConfirmRequest
  onApprove: () => void
  onReject: () => void
}

export function ToolConfirmDialog({ request, onApprove, onReject }: ToolConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[560px] mx-4 overflow-hidden">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
          <p className="text-sm text-gray-500">执行工具</p>
          <p className="text-lg font-semibold font-mono text-gray-900">{request.toolName}</p>
        </div>
        <div className="px-5 py-3 max-h-64 overflow-y-auto" style={{ backgroundColor: '#0d1117', minHeight: 64 }}>
          <pre className="text-sm font-mono whitespace-pre-wrap break-words" style={{ color: '#4ade80' }}>
            {request.inputSummary || <span style={{ color: '#6b7280', fontStyle: 'italic' }}>（无参数）</span>}
          </pre>
        </div>
        <div className="px-5 py-4 flex justify-end gap-3 border-t border-gray-200">
          <button
            onClick={onReject}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            执行
          </button>
        </div>
      </div>
    </div>
  )
}
