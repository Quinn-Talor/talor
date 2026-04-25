import { useState } from 'react'
import { useChatStore, type ToolCallEntry } from '../store/chatStore'

function ToolCallItem({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)

  const inputStr = JSON.stringify(entry.input, null, 2)
  const resultStr = entry.result !== undefined ? JSON.stringify(entry.result, null, 2) : null

  return (
    <div
      className="text-xs border border-gray-200 rounded-lg overflow-hidden"
      data-testid="tool-call-item"
      data-tool-name={entry.toolName}
      data-status={entry.status}
    >
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(prev => !prev)}
        data-testid="tool-call-toggle"
      >
        {entry.status === 'pending' ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
        ) : entry.status === 'done' ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : entry.status === 'timeout' ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
        <span className="font-mono text-gray-700 font-medium">{entry.toolName}</span>
        {entry.status === 'timeout' && (
          <span className="text-amber-600 text-[10px]">超时</span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 bg-white" data-testid="tool-call-details">
          <div>
            <div className="text-gray-400 mb-1 uppercase tracking-wide text-[10px]">Input</div>
            <pre className="bg-gray-50 rounded p-2 text-gray-700 overflow-x-auto text-[11px] leading-relaxed">{inputStr}</pre>
          </div>
          {resultStr !== null && (
            <div>
              <div className="text-gray-400 mb-1 uppercase tracking-wide text-[10px]">Result</div>
              <pre className={`bg-gray-50 rounded p-2 overflow-x-auto text-[11px] leading-relaxed ${entry.status === 'timeout' ? 'text-amber-700' : 'text-gray-700'}`}>{resultStr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallLog() {
  const toolCalls = useChatStore((s) => s.toolCalls)

  if (toolCalls.length === 0) return null

  return (
    <div className="space-y-1.5 mb-3" data-testid="tool-call-log">
      {toolCalls.map((entry) => (
        <ToolCallItem key={entry.toolCallId} entry={entry} />
      ))}
    </div>
  )
}
