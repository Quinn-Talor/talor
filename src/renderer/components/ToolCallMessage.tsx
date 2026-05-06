import { useState } from 'react'

interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
}

interface ToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: string
  isError: boolean
}

interface ToolCallMessageProps {
  toolUses: ToolCallPart[]
  toolResults: ToolResultPart[]
}

function buildInputSummary(toolName: string, input: unknown): string {
  const MAX_LEN = 50
  const truncate = (s: string) => (s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1) + '…')
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
      return truncate(String(obj.path ?? ''))
    case 'bash':
      return truncate(String(obj.command ?? ''))
    case 'grep':
      return truncate(`"${obj.pattern ?? ''}"${obj.path ? ` ${obj.path}` : ''}`)
    case 'glob':
      return truncate(String(obj.pattern ?? ''))
    case 'ls':
      return truncate(String(obj.path ?? '.'))
    case 'subagent':
      return truncate(String(obj.goal ?? ''))
    default: {
      const json = JSON.stringify(input)
      if (json === '{}' || json === 'null') return '(no args)'
      return truncate(json)
    }
  }
}

function PersistedToolRow({
  toolUse,
  toolResult,
}: {
  toolUse: ToolCallPart
  toolResult?: ToolResultPart
}) {
  const [expanded, setExpanded] = useState(false)

  const hasResult = !!toolResult
  const isError = toolResult?.isError
  const summary = buildInputSummary(toolUse.toolName, toolUse.input)

  return (
    <div data-testid="tool-call-item" data-tool-name={toolUse.toolName}>
      <button
        className={`w-full flex items-center gap-2 px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-left ${isError ? 'opacity-70' : ''}`}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {!hasResult ? (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
        ) : isError ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-red-500 shrink-0"
            aria-label="failed"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-500 shrink-0"
            aria-label="done"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span className="font-medium text-zinc-700 dark:text-zinc-300 w-14 truncate shrink-0">
          {toolUse.toolName}
        </span>
        <span className="flex-1 text-zinc-500 dark:text-zinc-400 truncate">{summary}</span>
      </button>

      {expanded && (
        <div className="ml-6 mt-0.5 mb-1 p-2 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 max-h-48 overflow-y-auto">
          <div className="text-zinc-400 text-[10px] uppercase tracking-wide mb-1">Input</div>
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">
            {JSON.stringify(toolUse.input, null, 2)}
          </pre>
          {toolResult && (
            <>
              <hr className="my-2 border-zinc-200 dark:border-zinc-700" />
              <div className="text-zinc-400 text-[10px] uppercase tracking-wide mb-1">Output</div>
              <pre
                className={`text-xs whitespace-pre-wrap break-all ${isError ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'}`}
              >
                {(() => {
                  const raw = toolResult.output ?? ''
                  return raw.length > 500 ? raw.slice(0, 500) + '\n[truncated]' : raw
                })()}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ToolCallMessage({ toolUses, toolResults }: ToolCallMessageProps) {
  if (toolUses.length === 0) return null

  const resultMap = new Map(toolResults.map((r) => [r.toolCallId, r]))

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] w-full">
        <div className="flex flex-col gap-0.5 py-0.5 px-2 pl-5 font-mono text-xs">
          {toolUses.map((tu) => (
            <PersistedToolRow
              key={tu.toolCallId}
              toolUse={tu}
              toolResult={resultMap.get(tu.toolCallId)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
