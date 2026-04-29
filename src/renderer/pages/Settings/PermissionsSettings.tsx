import { useEffect, useState, useCallback } from 'react'
import { useChatStore } from '../../store/chatStore'
import { talorAPI } from '../../api/talorAPI'
import type { PermissionRule, PermissionRuleView } from '@shared/types/permissions'

/**
 * Workspace permission rule management.
 *
 * Grouped by scope (session / persisted) as per design:
 *   - Session: in-memory rules, dropped when the app restarts
 *   - Persisted: saved to ~/.talor/workspaces/<hash>/permissions.json
 *
 * Workspace is taken from the currently-selected session. If no session is
 * active, the panel renders an empty-state hint.
 */
export function PermissionsSettings() {
  const { currentSessionId, sessions } = useChatStore()
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const workspacePath = currentSession?.workspace ?? ''

  const [view, setView] = useState<PermissionRuleView>({ session: [], persisted: [] })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setView({ session: [], persisted: [] })
      return
    }
    setLoading(true)
    try {
      const v = await talorAPI.permissions.list(workspacePath)
      setView(v)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => { refresh() }, [refresh])

  const handleRemove = async (ruleId: string) => {
    if (!workspacePath) return
    await talorAPI.permissions.remove(workspacePath, ruleId)
    await refresh()
  }

  const handleClearSession = async () => {
    if (!workspacePath) return
    if (!confirm('Clear all session permission rules for this workspace?')) return
    await talorAPI.permissions.clearSession(workspacePath)
    await refresh()
  }

  if (!workspacePath) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">Workspace Permissions</h2>
        <p className="text-sm text-gray-500">
          Open a chat session with a workspace set to view its permission rules.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Workspace Permissions</h2>
        <p className="text-xs font-mono text-gray-500 truncate" title={workspacePath}>
          {workspacePath}
        </p>
      </div>

      <RuleGroup
        title="Persisted rules"
        subtitle="Saved to this workspace, survive restarts"
        emptyText='No persisted rules. Approving a pattern with "Remember across sessions" adds one here.'
        rules={view.persisted}
        onRemove={handleRemove}
      />

      <RuleGroup
        title="Session rules"
        subtitle="In-memory only, cleared when Talor restarts"
        emptyText="No active session rules."
        rules={view.session}
        onRemove={handleRemove}
        extraAction={
          view.session.length > 0
            ? { label: 'Clear all session rules', onClick: handleClearSession }
            : undefined
        }
      />

      {loading && <p className="text-xs text-gray-400">Refreshing...</p>}
    </div>
  )
}

interface RuleGroupProps {
  title: string
  subtitle: string
  emptyText: string
  rules: PermissionRule[]
  onRemove: (id: string) => void
  extraAction?: { label: string; onClick: () => void }
}

function RuleGroup({ title, subtitle, emptyText, rules, onRemove, extraAction }: RuleGroupProps) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {title} <span className="text-gray-400 font-normal">({rules.length})</span>
          </h3>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        {extraAction && (
          <button
            onClick={extraAction.onClick}
            className="text-xs text-red-600 hover:text-red-800"
          >
            {extraAction.label}
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-gray-400 border border-dashed border-gray-200 rounded px-3 py-4 text-center">
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map(rule => (
            <RuleRow key={rule.id} rule={rule} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  )
}

function RuleRow({ rule, onRemove }: { rule: PermissionRule; onRemove: (id: string) => void }) {
  const effectColor = rule.effect === 'allow' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
  const patternDisplay = renderPattern(rule)
  const createdShort = new Date(rule.createdAt).toLocaleDateString()

  return (
    <li className="flex items-start gap-3 px-3 py-2 bg-gray-50 rounded border border-gray-200">
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${effectColor}`}>
        {rule.effect}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-mono font-medium text-gray-900">{rule.tool}</span>
          <span className="text-xs font-mono text-gray-600 truncate" title={patternDisplay}>
            {patternDisplay}
          </span>
        </div>
        <p className="text-xs text-gray-400">Created {createdShort}</p>
      </div>
      <button
        onClick={() => onRemove(rule.id)}
        className="text-xs text-gray-500 hover:text-red-600"
        title="Remove this rule"
      >
        Remove
      </button>
    </li>
  )
}

function renderPattern(rule: PermissionRule): string {
  // bash: regex source — show verbatim
  if (rule.tool === 'bash') return rule.argPattern
  // file tools: trailing '/' = dir prefix; show with '**' suffix for clarity
  return rule.argPattern.endsWith('/') ? rule.argPattern + '**' : rule.argPattern
}
