import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { talorAPI } from '../api/talorAPI'
import { useChatStore } from '../store/chatStore'
import type {
  PermissionRule,
  PermissionRuleView,
  PermissionRequest,
  PermissionResponse,
  PatternSuggestion,
} from '@shared/types/permissions'

interface Props {
  workspacePath: string
}

/**
 * 输入框上方的权限入口。集合两件事：
 *   1. 当前 workspace 的所有规则（Allowed / Denied 分组，支持删除）
 *   2. **待授权请求（Pending）**——agent 调用 workspace 外路径时弹到这里，
 *      不再另开 PermissionDialog，保持 popover 内操作一致
 *
 * Auto-open：pendingPermission 从 null → 非 null 时，popover 自动展开；用户
 * 看到待授权卡片后做决定。新请求到来时若 popover 已是关闭状态，也会重新展开。
 */
export function PermissionsPopover({ workspacePath }: Props) {
  const pendingPermission = useChatStore(s => s.pendingPermission)
  const setPendingPermission = useChatStore(s => s.setPendingPermission)
  const autoOpenTick = useChatStore(s => s.permissionAutoOpenTick)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PermissionRuleView>({ session: [], persisted: [] })
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const v = await talorAPI.permissions.list(workspacePath)
      setView(v)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // 有新 pending permission 请求 → 自动展开 popover
  useEffect(() => {
    if (autoOpenTick > 0 && pendingPermission) {
      setOpen(true)
    }
  }, [autoOpenTick, pendingPermission])

  // 点外部收起——但有 pending 时不允许关闭（强制用户处理）
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (pendingPermission) return   // 待授权时点外面不关，避免"遗忘"一个阻塞的请求
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, pendingPermission])

  const handleRemove = async (ruleId: string) => {
    await talorAPI.permissions.remove(workspacePath, ruleId)
    await refresh()
  }

  const handleClearSession = async () => {
    await talorAPI.permissions.clearSession(workspacePath)
    await refresh()
  }

  const handlePermissionDecide = (resp: Omit<PermissionResponse, 'requestId'>) => {
    if (!pendingPermission) return
    talorAPI.chat.sendPermissionResponse({ requestId: pendingPermission.requestId, ...resp })
    setPendingPermission(null)
    // 规则可能被新增 → 立即刷新列表
    setTimeout(() => { refresh() }, 100)
  }

  // Deny 规则在当前 UX 里不产生——Pending 的 Deny 按钮只拒绝本次不落库——
  // 所以这里仅展示 allow 规则，避免出现永远为 0 的 Denied 分组。
  const allRules = [...view.session, ...view.persisted]
  const allowedRules = allRules.filter(r => r.effect === 'allow')
  const totalCount = allowedRules.length
  const hasSessionRules = view.session.some(r => r.effect === 'allow')
  const hasPending = !!pendingPermission

  const buttonStyle: React.CSSProperties = {
    background: hasPending
      ? 'rgba(234,179,8,0.15)'   // 待授权时金色提示
      : (open ? 'rgba(59,130,246,0.12)' : 'transparent'),
    color: hasPending
      ? '#a16207'
      : (open ? '#2563eb' : (totalCount > 0 ? '#64748b' : '#94a3b8')),
    border: '1px solid',
    borderColor: hasPending
      ? 'rgba(234,179,8,0.4)'
      : (open ? 'rgba(59,130,246,0.3)' : '#e2e8f0'),
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[11px] font-medium transition-all"
        style={buttonStyle}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Permissions</span>
        {hasPending && (
          <span className="font-semibold text-[10px]">· needs review</span>
        )}
        {!hasPending && totalCount > 0 && (
          <span className="font-mono text-[10px] opacity-80">· {totalCount}</span>
        )}
        <span className="text-[9px] opacity-60">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full right-0 mb-1 w-[420px] rounded-lg shadow-xl z-40"
          style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-gray-900">
                {pendingPermission ? 'Permission required' : 'Permissions'}
              </p>
              {!pendingPermission && (
                <p className="text-xs text-gray-400">
                  {totalCount} rule{totalCount === 1 ? '' : 's'}
                </p>
              )}
            </div>
            <p className="text-xs font-mono text-gray-500 truncate mt-0.5" title={workspacePath}>
              {workspacePath}
            </p>
          </div>

          <div className="max-h-[480px] overflow-y-auto">
            {pendingPermission ? (
              // 有待审批时只展示请求卡片，隐藏现有规则列表——避免用户被
              // 已有规则分散注意力，同时也节省纵向空间。
              <PendingRequestCard
                request={pendingPermission}
                onDecide={handlePermissionDecide}
              />
            ) : (
              <RuleGroup
                title="Allowed"
                rules={allowedRules}
                effect="allow"
                onRemove={handleRemove}
              />
            )}
          </div>

          {(hasSessionRules || totalCount === 0) && !hasPending && (
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500">
              {totalCount === 0 && !loading && (
                <p>No permissions yet. Agent will ask you when accessing a path outside the workspace.</p>
              )}
              {hasSessionRules && (
                <button
                  onClick={handleClearSession}
                  className="text-red-600 hover:text-red-800 font-medium"
                >
                  Clear {view.session.length} session rule{view.session.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pending request card (内嵌授权) ───────────────────────────────────

type ScopeChoice = 'once' | PatternSuggestion['id']

interface PendingRequestCardProps {
  request: PermissionRequest
  onDecide: (resp: Omit<PermissionResponse, 'requestId'>) => void
}

function PendingRequestCard({ request, onDecide }: PendingRequestCardProps) {
  const [scope, setScope] = useState<ScopeChoice>('once')
  const [remember, setRemember] = useState(false)
  const [bulkTools, setBulkTools] = useState<string[]>(
    request.bulkGrantGroup ? [request.toolName] : [],
  )

  const scopes = useMemo<Array<{ id: ScopeChoice; label: string; preview?: PatternSuggestion['preview'] }>>(() => {
    const out: Array<{ id: ScopeChoice; label: string; preview?: PatternSuggestion['preview'] }> = [
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

  const toggleBulkTool = (tool: string) => {
    if (tool === request.toolName) return   // 主工具不可取消
    setBulkTools(prev =>
      prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool],
    )
  }

  const title = request.reason === 'path_outside_workspace'
    ? `${request.toolName} wants to access a path outside the workspace`
    : `${request.toolName} wants to run`

  return (
    <div className="mx-3 my-3 rounded-lg border-2 border-amber-300 bg-amber-50 overflow-hidden">
      <div className="px-3 py-2 bg-amber-100 border-b border-amber-200">
        <p className="text-[11px] font-semibold text-amber-900">Pending approval</p>
        <p className="text-xs text-amber-800 mt-0.5">{title}</p>
      </div>

      <div className="px-3 py-2 bg-gray-900">
        <pre className="text-xs font-mono whitespace-pre-wrap break-words text-green-400">
          {request.inputSummary || <span className="text-gray-500 italic">(no arguments)</span>}
        </pre>
        {request.absPath && request.absPath !== request.inputSummary && (
          <p className="text-[10px] font-mono mt-1 text-gray-400">
            Resolves to: {request.absPath}
          </p>
        )}
      </div>

      <div className="px-3 py-2 bg-white">
        <p className="text-[11px] font-medium text-gray-700 mb-1.5">If approved, apply to:</p>
        <div className="space-y-1">
          {scopes.map(s => (
            <label
              key={s.id}
              className="flex items-start gap-1.5 cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded"
            >
              <input
                type="radio"
                name={`scope-${request.requestId}`}
                value={s.id}
                checked={scope === s.id}
                onChange={() => setScope(s.id)}
                className="mt-0.5"
              />
              <span className="text-xs text-gray-900">{s.label}</span>
            </label>
          ))}
        </div>

        {selectedPreview && (selectedPreview.matches.length > 0 || selectedPreview.doesNotMatch.length > 0) && (
          <div className="mt-2 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-[10px] space-y-0.5">
            {selectedPreview.matches.length > 0 && (
              <div>
                <span className="font-medium text-green-700">Matches: </span>
                <span className="font-mono text-gray-700">{selectedPreview.matches.slice(0, 2).join(', ')}</span>
              </div>
            )}
            {selectedPreview.doesNotMatch.length > 0 && (
              <div>
                <span className="font-medium text-red-700">Not: </span>
                <span className="font-mono text-gray-700">{selectedPreview.doesNotMatch.slice(0, 2).join(', ')}</span>
              </div>
            )}
          </div>
        )}

        {request.bulkGrantGroup && request.bulkGrantGroup.length > 1 && scope !== 'once' && (
          <div className="mt-2 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
            <p className="text-[10px] font-medium text-gray-700 mb-1">
              Also grant these read-only tools:
            </p>
            <div className="flex flex-wrap gap-2">
              {request.bulkGrantGroup.map(t => (
                <label key={t} className="flex items-center gap-1 text-[10px] cursor-pointer">
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
          <label className="flex items-center gap-1.5 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
            />
            <span className="text-[10px] text-gray-700">
              Remember across sessions (saved to this workspace)
            </span>
          </label>
        )}
      </div>

      <div className="px-3 py-2 flex justify-end gap-2 border-t border-amber-200 bg-amber-50">
        <button
          onClick={() => onDecide({ decision: 'rejected' })}
          className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700"
        >
          Deny
        </button>
        <button
          onClick={() =>
            onDecide({
              decision: 'approved',
              grantPatternId: scope === 'once' ? undefined : scope,
              rememberAcrossSessions: scope !== 'once' && remember,
              bulkGrantTools: scope === 'once' ? undefined : bulkTools,
            })
          }
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
        >
          Allow
        </button>
      </div>
    </div>
  )
}

// ── Rule list groups (existing rules) ────────────────────────────────

interface RuleGroupProps {
  title: string
  rules: PermissionRule[]
  effect: 'allow' | 'deny'
  onRemove: (id: string) => void
}

function RuleGroup({ title, rules, effect, onRemove }: RuleGroupProps) {
  if (rules.length === 0) return null

  const titleColor = effect === 'allow' ? 'text-green-700' : 'text-red-700'

  return (
    <div className="px-4 py-2">
      <p className={`text-xs font-semibold mb-1.5 ${titleColor}`}>
        {title} <span className="text-gray-400 font-normal">({rules.length})</span>
      </p>
      <ul className="space-y-1">
        {rules.map(rule => (
          <RuleRow key={rule.id} rule={rule} onRemove={onRemove} />
        ))}
      </ul>
    </div>
  )
}

function RuleRow({ rule, onRemove }: { rule: PermissionRule; onRemove: (id: string) => void }) {
  const patternDisplay = renderPattern(rule)
  const scopeBadge = rule.scope === 'persisted'
    ? { label: 'saved', color: 'text-purple-700 bg-purple-50' }
    : { label: 'session', color: 'text-blue-700 bg-blue-50' }

  return (
    <li className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-xs font-mono font-medium text-gray-900">{rule.tool}</span>
          <span className={`text-[9px] font-medium px-1 py-px rounded ${scopeBadge.color}`}>
            {scopeBadge.label}
          </span>
        </div>
        <p className="text-xs font-mono text-gray-600 truncate mt-0.5" title={patternDisplay}>
          {patternDisplay}
        </p>
      </div>
      <button
        onClick={() => onRemove(rule.id)}
        className="text-xs text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove this rule"
      >
        Remove
      </button>
    </li>
  )
}

function renderPattern(rule: PermissionRule): string {
  if (rule.tool === 'bash') return rule.argPattern
  return rule.argPattern.endsWith('/') ? rule.argPattern + '**' : rule.argPattern
}
