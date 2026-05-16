// src/renderer/components/tool-calls/ToolDispatch.tsx
//
// 渲染层: 工具调用分发器 — 替代旧 ToolCallMessage。
//
// 设计 (spec §10):
//   - 内置 7 工具 (bash / read / write / edit / grep / glob / ls) 有 row + 特化输出
//   - 其他工具 (MCP) 走 ToolRow + 可展开 JSON  (不为特定 MCP 工具写专门 UI)
//
// 当前 v1 实现仅给 row。后续可在 renderBuiltinOutput 里接入 BashOutput / DiffView /
// GrepResults。

import { ToolRow, type ToolStatus } from './ToolRow'

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

interface ToolDispatchProps {
  use: ToolCallPart
  result?: ToolResultPart
}

const BUILTIN_TOOLS = new Set(['bash', 'read', 'write', 'edit', 'grep', 'glob', 'ls'])
const MAX_TARGET_LEN = 50

export function ToolDispatch({ use, result }: ToolDispatchProps) {
  const status: ToolStatus = !result ? 'running' : result.isError ? 'error' : 'done'
  const target = buildSummary(use.toolName, use.input)
  const isMcp = !BUILTIN_TOOLS.has(use.toolName)

  // MCP — generic row + expandable JSON
  if (isMcp) {
    return (
      <ToolRow status={status} name={use.toolName} target={target} expandable={!!result}>
        {result && (
          <>
            <div className="tool-body-label">Input</div>
            <pre>{JSON.stringify(use.input, null, 2)}</pre>
            <div className="tool-body-label">Output</div>
            <pre className={result.isError ? 'tool-err-pre' : ''}>
              {truncate(result.output, 500)}
            </pre>
          </>
        )}
      </ToolRow>
    )
  }

  // Built-in — row (specialized output renderers e.g. DiffView/BashOutput can be wired
  // here in a follow-up; v1 just shows the row which is already a big improvement).
  return (
    <ToolRow status={status} name={use.toolName} target={target} expandable={!!result}>
      {result && (
        <>
          <div className="tool-body-label">Input</div>
          <pre>{JSON.stringify(use.input, null, 2)}</pre>
          <div className="tool-body-label">Output</div>
          <pre className={result.isError ? 'tool-err-pre' : ''}>{truncate(result.output, 500)}</pre>
        </>
      )}
    </ToolRow>
  )
}

function buildSummary(name: string, input: unknown): string {
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  let raw = ''
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
      raw = String(obj.path ?? '')
      break
    case 'bash':
      raw = String(obj.command ?? '')
      break
    case 'grep':
      raw = `"${obj.pattern ?? ''}"${obj.path ? ' ' + obj.path : ''}`
      break
    case 'glob':
      raw = String(obj.pattern ?? '')
      break
    case 'ls':
      raw = String(obj.path ?? '.')
      break
    default: {
      const json = JSON.stringify(input)
      raw = json === '{}' || json === 'null' ? '(no args)' : json
    }
  }
  return raw.length <= MAX_TARGET_LEN ? raw : raw.slice(0, MAX_TARGET_LEN - 1) + '…'
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '\n[truncated]'
}
