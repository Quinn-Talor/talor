import { useState, useEffect } from 'react'
import { useChatStore, type ToolCallEntry, type StreamItem } from '../store/chatStore'

function useElapsedTimer(startedAt: number, active: boolean): string {
  const [elapsed, setElapsed] = useState(() => (Date.now() - startedAt) / 1000)

  useEffect(() => {
    if (!active) return
    setElapsed((Date.now() - startedAt) / 1000)
    const id = setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000)
    }, 100)
    return () => clearInterval(id)
  }, [startedAt, active])

  return `${elapsed.toFixed(1)}s`
}

function formatDuration(ms: number): string {
  if (ms < 10) return '<0.01s'
  if (ms < 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 1000).toFixed(1)}s`
}

function buildInputSummary(toolName: string, input: Record<string, unknown>): string {
  const MAX_LEN = 50
  const truncate = (s: string) => (s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN - 1) + '…')

  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
      return truncate(String(input.path ?? ''))
    case 'bash':
      return truncate(String(input.command ?? ''))
    case 'grep':
      return truncate(`"${input.pattern ?? ''}"${input.path ? ` ${input.path}` : ''}`)
    case 'glob':
      return truncate(String(input.pattern ?? ''))
    case 'ls':
      return truncate(String(input.path ?? '.'))
    case 'subagent':
      return truncate(String(input.goal ?? ''))
    default: {
      const json = JSON.stringify(input)
      if (json === '{}') return '(no args)'
      return truncate(json)
    }
  }
}

function StatusIcon({ status }: { status: ToolCallEntry['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <span
          className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"
          aria-label="executing"
        />
      )
    case 'done':
      return (
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
      )
    case 'error':
      return (
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
      )
    case 'timeout':
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-yellow-500 shrink-0"
          aria-label="timeout"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
  }
}

function TimeDisplay({ entry }: { entry: ToolCallEntry }) {
  const elapsedStr = useElapsedTimer(entry.startedAt, entry.status === 'pending')

  switch (entry.status) {
    case 'pending':
      return <span className="text-blue-500 tabular-nums">{elapsedStr}</span>
    case 'done':
      return (
        <span className="text-green-600 dark:text-green-400 tabular-nums">
          {formatDuration(entry.durationMs ?? 0)}
        </span>
      )
    case 'error':
      return (
        <span className="text-red-500 tabular-nums">{formatDuration(entry.durationMs ?? 0)}</span>
      )
    case 'timeout':
      return <span className="text-yellow-500 tabular-nums">timeout</span>
  }
}

function ToolCallRow({ entry }: { entry: ToolCallEntry }) {
  const [expanded, setExpanded] = useState(false)
  const summary = buildInputSummary(entry.toolName, entry.input)
  const isError = entry.status === 'error'

  return (
    <div data-testid="tool-call-item" data-tool-name={entry.toolName} data-status={entry.status}>
      <button
        className={`w-full flex items-center gap-2 px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer text-left ${isError ? 'opacity-70' : ''}`}
        onClick={() => setExpanded((prev) => !prev)}
        data-testid="tool-call-toggle"
      >
        <StatusIcon status={entry.status} />
        <span className="font-medium text-zinc-700 dark:text-zinc-300 w-14 truncate shrink-0">
          {entry.toolName}
        </span>
        <span className="flex-1 text-zinc-500 dark:text-zinc-400 truncate">{summary}</span>
        <span className="text-right w-16 shrink-0 text-[11px]">
          <TimeDisplay entry={entry} />
        </span>
      </button>

      {expanded && (
        <div
          className="ml-6 mt-0.5 mb-1 p-2 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 max-h-48 overflow-y-auto"
          data-testid="tool-call-details"
        >
          <div className="text-zinc-400 text-[10px] uppercase tracking-wide mb-1">Input</div>
          <pre className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">
            {JSON.stringify(entry.input, null, 2)}
          </pre>
          {entry.result !== undefined && (
            <>
              <hr className="my-2 border-zinc-200 dark:border-zinc-700" />
              <div className="text-zinc-400 text-[10px] uppercase tracking-wide mb-1">Output</div>
              <pre className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap break-all">
                {(() => {
                  const raw =
                    typeof entry.result === 'string'
                      ? entry.result
                      : JSON.stringify(entry.result, null, 2)
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

function groupByStep(items: StreamItem[]): Array<{ stepIndex: number; items: StreamItem[] }> {
  const groups: Array<{ stepIndex: number; items: StreamItem[] }> = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.stepIndex === item.stepIndex) {
      last.items.push(item)
    } else {
      groups.push({ stepIndex: item.stepIndex, items: [item] })
    }
  }
  return groups
}

function StepGroup({ items, isLast }: { items: StreamItem[]; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const textContent = items
    .filter((i): i is Extract<StreamItem, { type: 'text' }> => i.type === 'text')
    .map((i) => i.content)
    .join('')
  const toolItems = items.filter(
    (i): i is Extract<StreamItem, { type: 'tool_call' }> => i.type === 'tool_call',
  )
  const hasText = textContent.trim().length > 0
  const hasTools = toolItems.length > 0

  if (!hasText && !hasTools) return null

  const showTextExpanded = isLast || expanded

  return (
    <div>
      {hasText &&
        (hasTools ? (
          <button
            className="text-zinc-500 dark:text-zinc-400 text-[12px] leading-relaxed mb-0.5 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer text-left truncate max-w-full block"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {showTextExpanded
              ? textContent.trim()
              : `${textContent.trim().slice(0, 60)}${textContent.trim().length > 60 ? '…' : ''}`}
          </button>
        ) : (
          <div className="text-zinc-700 dark:text-zinc-300 text-[13px] leading-relaxed mb-1 whitespace-pre-wrap">
            {textContent}
          </div>
        ))}
      {hasTools && (
        <div className="flex flex-col gap-0.5 font-mono text-xs pl-3">
          {toolItems.map((item) => (
            <ToolCallRow key={item.entry.toolCallId} entry={item.entry} />
          ))}
        </div>
      )}
    </div>
  )
}

export function ToolCallLog() {
  const streamItems = useChatStore((s) => s.streamItems)

  if (streamItems.length === 0) return null

  const groups = groupByStep(streamItems)

  return (
    <div className="flex flex-col gap-1 py-1 px-2 mb-3" data-testid="tool-call-log">
      {groups.map((group, idx) => (
        <StepGroup key={group.stepIndex} items={group.items} isLast={idx === groups.length - 1} />
      ))}
    </div>
  )
}
