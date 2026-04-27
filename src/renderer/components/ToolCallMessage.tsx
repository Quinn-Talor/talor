import { useState } from 'react'

interface ToolUseBlock {
  type: 'tool_use'
  toolCallId: string
  toolName: string
  input: unknown
}

interface ToolResultBlock {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  output: string
  isError: boolean
}

interface ToolCallMessageProps {
  toolUses: ToolUseBlock[]
  toolResults: ToolResultBlock[]
}

function ToolCallCard({ toolUse, toolResult }: { toolUse: ToolUseBlock; toolResult?: ToolResultBlock }) {
  const [expanded, setExpanded] = useState(false)

  const isSkill = toolUse.toolName === 'skill'
  const isError = toolResult?.isError
  const hasResult = !!toolResult

  const inputStr = JSON.stringify(toolUse.input, null, 2)
  const resultPreview = toolResult?.output
    ? toolResult.output.length > 200
      ? toolResult.output.slice(0, 200) + '...'
      : toolResult.output
    : null

  return (
    <div className="text-xs border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(prev => !prev)}
      >
        {!hasResult ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
        ) : isError ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 shrink-0">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500 shrink-0">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span className="font-mono text-gray-700 font-medium">{toolUse.toolName}</span>
        {isSkill && (
          <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">技能</span>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`ml-auto text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2 bg-white">
          <div>
            <div className="text-gray-400 mb-1 uppercase tracking-wide text-[10px]">Input</div>
            <pre className="bg-gray-50 rounded p-2 text-gray-700 overflow-x-auto text-[11px] leading-relaxed max-h-40 overflow-y-auto">{inputStr}</pre>
          </div>
          {resultPreview && (
            <div>
              <div className="text-gray-400 mb-1 uppercase tracking-wide text-[10px]">Result</div>
              <pre className={`bg-gray-50 rounded p-2 overflow-x-auto text-[11px] leading-relaxed max-h-60 overflow-y-auto ${isError ? 'text-red-700' : 'text-gray-700'}`}>{resultPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallMessage({ toolUses, toolResults }: ToolCallMessageProps) {
  if (toolUses.length === 0) return null

  const resultMap = new Map(toolResults.map(r => [r.toolCallId, r]))

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[85%] w-full space-y-1.5">
        {toolUses.map(tu => (
          <ToolCallCard
            key={tu.toolCallId}
            toolUse={tu}
            toolResult={resultMap.get(tu.toolCallId)}
          />
        ))}
      </div>
    </div>
  )
}
