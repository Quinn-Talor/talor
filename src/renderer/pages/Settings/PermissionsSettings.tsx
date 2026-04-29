import { useEffect, useState, useCallback, useMemo } from 'react'
import { useChatStore } from '../../store/chatStore'
import { talorAPI } from '../../api/talorAPI'
import type { PermissionRule, PermissionRuleView } from '@shared/types/permissions'

/**
 * Workspace permission rule management.
 *
 * 每个有规则的 workspace 独立一个可折叠 section。当前 session 的 workspace
 * 默认展开；其他 workspace 默认折叠，点击展开时按需拉取规则。
 *
 * 下拉方案被弃——用户一次只能看一个 workspace，规则分布一眼看不清。
 * 平铺 + 折叠对比"我有几个 workspace / 各自规则多少"更直观。
 */

interface WorkspaceEntry {
  workspacePath: string
  ruleCount: number   // persisted 规则数
}

export function PermissionsSettings() {
  const { currentSessionId, sessions } = useChatStore()
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const currentWorkspacePath = currentSession?.workspace ?? ''

  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])

  // 合并下拉列表：当前 session workspace + 所有有 persisted rules 的 workspace
  const workspaceList = useMemo<WorkspaceEntry[]>(() => {
    const map = new Map<string, WorkspaceEntry>()
    if (currentWorkspacePath) {
      map.set(currentWorkspacePath, {
        workspacePath: currentWorkspacePath,
        ruleCount: 0,   // 占位，会被后续合并覆盖
      })
    }
    for (const ws of workspaces) {
      map.set(ws.workspacePath, ws)
    }
    return Array.from(map.values()).sort((a, b) => {
      // 当前 session workspace 排第一，其余按路径字典序
      if (a.workspacePath === currentWorkspacePath) return -1
      if (b.workspacePath === currentWorkspacePath) return 1
      return a.workspacePath.localeCompare(b.workspacePath)
    })
  }, [workspaces, currentWorkspacePath])

  const loadWorkspaces = useCallback(async () => {
    const list = await talorAPI.permissions.listWorkspaces()
    setWorkspaces(list)
  }, [])

  useEffect(() => { loadWorkspaces() }, [loadWorkspaces])

  if (workspaceList.length === 0) {
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

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Workspace Permissions</h2>
        <p className="text-xs text-gray-500">
          Rules are stored per workspace at <code className="bg-gray-100 px-1 rounded">~/.talor/workspaces/</code>.
        </p>
      </div>

      {workspaceList.map(ws => (
        <WorkspaceSection
          key={ws.workspacePath}
          workspacePath={ws.workspacePath}
          isCurrent={ws.workspacePath === currentWorkspacePath}
          defaultExpanded={ws.workspacePath === currentWorkspacePath}
          onAfterMutate={loadWorkspaces}
        />
      ))}
    </div>
  )
}

interface WorkspaceSectionProps {
  workspacePath: string
  isCurrent: boolean
  defaultExpanded: boolean
  /** 通知外层：某 workspace 的规则变动，可能导致 workspace 列表本身变化（如 ruleCount 归零） */
  onAfterMutate: () => Promise<void>
}

function WorkspaceSection({ workspacePath, isCurrent, defaultExpanded, onAfterMutate }: WorkspaceSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [view, setView] = useState<PermissionRuleView>({ session: [], persisted: [] })
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const v = await talorAPI.permissions.list(workspacePath)
      setView(v)
      setLoaded(true)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  // 首次展开时 lazy-load；默认展开的当前 session workspace 会立刻拉一次
  useEffect(() => {
    if (expanded && !loaded) refresh()
  }, [expanded, loaded, refresh])

  const handleRemove = async (ruleId: string) => {
    await talorAPI.permissions.remove(workspacePath, ruleId)
    await refresh()
    await onAfterMutate()
  }

  const handleClearSession = async () => {
    if (!confirm(`Clear all session permission rules for ${workspacePath}?`)) return
    await talorAPI.permissions.clearSession(workspacePath)
    await refresh()
  }

  const total = view.session.length + view.persisted.length
  const countHint = loaded
    ? `${view.persisted.length} persisted · ${view.session.length} session`
    : ''

  return (
    <section className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left"
      >
        <span className="text-gray-400 text-xs w-4">{expanded ? '▼' : '▶'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-mono font-medium text-gray-900 truncate">
              {workspacePath}
            </span>
            {isCurrent && (
              <span className="text-[10px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                current
              </span>
            )}
          </div>
          {loaded && (
            <p className="text-xs text-gray-500">{countHint || `${total} rules`}</p>
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 py-4 space-y-4 border-t border-gray-200">
          <RuleGroup
            title="Persisted rules"
            subtitle="Saved to this workspace, survive restarts"
            emptyText='No persisted rules. Approve a pattern with "Remember across sessions" to add one.'
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
      )}
    </section>
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
