import { useEffect, useState, useCallback, useMemo } from 'react'
import { useChatStore } from '../../store/chatStore'
import { talorAPI } from '../../api/talorAPI'
import type { PermissionRule, PermissionRuleView } from '@shared/types/permissions'

/**
 * Workspace permission rule management.
 *
 * Workspace 下拉默认选中当前 session 的 workspace。下拉项由两部分合并：
 *   1. 当前 session 的 workspace（可能尚无持久化规则，但仍应可选）
 *   2. 所有已有持久化规则的 workspace（从磁盘扫出来）
 *
 * Session rules 按 workspacePath 分 key 存内存，和 persisted 对齐；切下拉时
 * 会显示对应 workspace 的全部规则（session + persisted）。
 */

interface WorkspaceEntry {
  workspacePath: string
  ruleCount: number   // persisted 规则数（session 不计入）
}

export function PermissionsSettings() {
  const { currentSessionId, sessions } = useChatStore()
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const currentWorkspacePath = currentSession?.workspace ?? ''

  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [selectedWorkspace, setSelectedWorkspace] = useState<string>(currentWorkspacePath)
  const [view, setView] = useState<PermissionRuleView>({ session: [], persisted: [] })
  const [loading, setLoading] = useState(false)

  // 合并下拉列表：当前 session workspace + 所有有 persisted rules 的 workspace
  const workspaceOptions = useMemo<WorkspaceEntry[]>(() => {
    const map = new Map<string, WorkspaceEntry>()
    if (currentWorkspacePath) {
      map.set(currentWorkspacePath, {
        workspacePath: currentWorkspacePath,
        ruleCount: 0,   // 占位，会被持久化数覆盖
      })
    }
    for (const ws of workspaces) {
      map.set(ws.workspacePath, ws)
    }
    return Array.from(map.values())
  }, [workspaces, currentWorkspacePath])

  // 扫盘加载 workspace 列表
  const loadWorkspaces = useCallback(async () => {
    const list = await talorAPI.permissions.listWorkspaces()
    setWorkspaces(list)
  }, [])

  useEffect(() => { loadWorkspaces() }, [loadWorkspaces])

  // 当前 session 切换时同步选中
  useEffect(() => {
    if (currentWorkspacePath && !selectedWorkspace) {
      setSelectedWorkspace(currentWorkspacePath)
    }
  }, [currentWorkspacePath, selectedWorkspace])

  // 选中 workspace 变化时刷新 rules
  const refresh = useCallback(async () => {
    if (!selectedWorkspace) {
      setView({ session: [], persisted: [] })
      return
    }
    setLoading(true)
    try {
      const v = await talorAPI.permissions.list(selectedWorkspace)
      setView(v)
    } finally {
      setLoading(false)
    }
  }, [selectedWorkspace])

  useEffect(() => { refresh() }, [refresh])

  const handleRemove = async (ruleId: string) => {
    if (!selectedWorkspace) return
    await talorAPI.permissions.remove(selectedWorkspace, ruleId)
    await refresh()
    await loadWorkspaces()   // persisted 删空后 workspace 可能从列表消失
  }

  const handleClearSession = async () => {
    if (!selectedWorkspace) return
    if (!confirm('Clear all session permission rules for this workspace?')) return
    await talorAPI.permissions.clearSession(selectedWorkspace)
    await refresh()
  }

  if (workspaceOptions.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">Workspace Permissions</h2>
        <p className="text-sm text-gray-500">
          No workspaces with saved permission rules yet. Open a chat session with a workspace set
          and approve a cross-workspace access to create one.
        </p>
      </div>
    )
  }

  const isCurrentSessionWs = selectedWorkspace === currentWorkspacePath

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Workspace Permissions</h2>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600">Workspace:</label>
          <select
            value={selectedWorkspace}
            onChange={e => setSelectedWorkspace(e.target.value)}
            className="flex-1 text-xs font-mono px-2 py-1 border border-gray-300 rounded bg-white"
          >
            {workspaceOptions.map(ws => (
              <option key={ws.workspacePath} value={ws.workspacePath}>
                {ws.workspacePath}
                {ws.ruleCount > 0 && ` (${ws.ruleCount} saved)`}
                {ws.workspacePath === currentWorkspacePath && ' · current'}
              </option>
            ))}
          </select>
        </div>

        {!isCurrentSessionWs && (
          <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            Viewing rules for a workspace different from the current session. Session rules for this
            workspace belong to another open chat and may not be visible here if no tool has been
            invoked in it yet.
          </p>
        )}
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
