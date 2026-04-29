import { useState, useMemo } from 'react'
import type { PermissionRequest, PermissionResponse, PatternSuggestion } from '@shared/types/permissions'

interface Props {
  request: PermissionRequest
  onDecide: (response: Omit<PermissionResponse, 'requestId'>) => void
}

type ScopeId = 'once' | PatternSuggestion['id']

/**
 * Permission dialog for cross-workspace tool calls.
 *
 * Default selection: "Allow once" (conservative — user must opt into pattern grants).
 * Bulk grant: for read-only file tools (read/ls/glob/grep), shows a checkbox
 * group so one approval can cover several tools with the same pattern.
 */
export function PermissionDialog({ request, onDecide }: Props) {
  // 保守默认：Allow once（不写规则）
  const [scope, setScope] = useState<ScopeId>('once')
  const [remember, setRemember] = useState(false)
  const [bulkTools, setBulkTools] = useState<string[]>(
    request.bulkGrantGroup ? [request.toolName] : [],
  )

  const scopes = useMemo<Array<{ id: ScopeId; label: string; preview?: PatternSuggestion['preview'] }>>(() => {
    const out: Array<{ id: ScopeId; label: string; preview?: PatternSuggestion['preview'] }> = [
      { id: 'once', label: 'Allow once (do not remember)' },
    ]
    for (const s of request.suggestedPatterns) {
      out.push({ id: s.id, label: s.label, preview: s.preview })
    }
    return out
  }, [request.suggestedPatterns])

  const selectedPreview = useMemo(() => {
    if (scope === 'once') return null
    return request.suggestedPatterns.find(s => s.id === scope)?.preview ?? null
  }, [scope, request.suggestedPatterns])

  const handleAllow = () => {
    onDecide({
      decision: 'approved',
      grantPatternId: scope === 'once' ? undefined : scope,
      rememberAcrossSessions: scope !== 'once' && remember,
      bulkGrantTools: scope === 'once' ? undefined : bulkTools,
    })
  }

  const handleDeny = () => {
    onDecide({ decision: 'rejected' })
  }

  const toggleBulkTool = (tool: string) => {
    setBulkTools(prev =>
      prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool],
    )
  }

  const title = request.reason === 'path_outside_workspace'
    ? `${request.toolName} wants to access a path outside the workspace`
    : `${request.toolName} wants to run`

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-[640px] mx-4 overflow-hidden">
        <div className="px-5 py-4 bg-gray-50 border-b border-gray-200">
          <p className="text-sm text-gray-500">Permission required</p>
          <p className="text-base font-semibold text-gray-900">{title}</p>
        </div>

        <div className="px-5 py-3 max-h-48 overflow-y-auto" style={{ backgroundColor: '#0d1117' }}>
          <pre className="text-sm font-mono whitespace-pre-wrap break-words" style={{ color: '#4ade80' }}>
            {request.inputSummary || <span style={{ color: '#6b7280', fontStyle: 'italic' }}>(no arguments)</span>}
          </pre>
          {request.absPath && request.absPath !== request.inputSummary && (
            <p className="text-xs font-mono mt-2" style={{ color: '#9ca3af' }}>
              Resolves to: {request.absPath}
            </p>
          )}
        </div>

        <div className="px-5 py-4 border-b border-gray-200">
          <p className="text-sm font-medium text-gray-700 mb-2">If approved, apply to:</p>
          <div className="space-y-2">
            {scopes.map(s => (
              <label
                key={s.id}
                className="flex items-start gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1.5 rounded"
              >
                <input
                  type="radio"
                  name="scope"
                  value={s.id}
                  checked={scope === s.id}
                  onChange={() => setScope(s.id)}
                  className="mt-1"
                />
                <span className="text-sm text-gray-900">{s.label}</span>
              </label>
            ))}
          </div>

          {selectedPreview && (selectedPreview.matches.length > 0 || selectedPreview.doesNotMatch.length > 0) && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded px-3 py-2 text-xs space-y-1">
              {selectedPreview.matches.length > 0 && (
                <div>
                  <span className="font-medium text-green-700">Matches: </span>
                  <span className="font-mono text-gray-700">{selectedPreview.matches.slice(0, 3).join(', ')}</span>
                </div>
              )}
              {selectedPreview.doesNotMatch.length > 0 && (
                <div>
                  <span className="font-medium text-red-700">Does NOT match: </span>
                  <span className="font-mono text-gray-700">{selectedPreview.doesNotMatch.slice(0, 3).join(', ')}</span>
                </div>
              )}
            </div>
          )}

          {request.bulkGrantGroup && request.bulkGrantGroup.length > 1 && scope !== 'once' && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded px-3 py-2">
              <p className="text-xs font-medium text-gray-700 mb-1.5">
                Also grant these read-only tools the same access?
              </p>
              <div className="flex flex-wrap gap-3">
                {request.bulkGrantGroup.map(t => (
                  <label key={t} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bulkTools.includes(t)}
                      onChange={() => toggleBulkTool(t)}
                      disabled={t === request.toolName}
                    />
                    <span className="font-mono">{t}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {scope !== 'once' && (
            <label className="flex items-center gap-2 mt-3 cursor-pointer">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span className="text-xs text-gray-700">
                Remember across sessions (saved to this workspace)
              </span>
            </label>
          )}
        </div>

        <div className="px-5 py-4 flex justify-end gap-3">
          <button
            onClick={handleDeny}
            className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            Deny
          </button>
          <button
            onClick={handleAllow}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}
