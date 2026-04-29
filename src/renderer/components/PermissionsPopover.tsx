import { useState, useEffect, useCallback, useRef } from 'react'
import { talorAPI } from '../api/talorAPI'
import type { PermissionRule, PermissionRuleView } from '@shared/types/permissions'

interface Props {
  workspacePath: string
}

/**
 * 输入框上方的权限入口：pill 按钮 + 点击弹出 popover。
 *
 * Popover 内容：
 *   - Allowed 组：effect='allow' 的规则
 *   - Denied 组：effect='deny' 的规则
 *   - 每条规则显示 tool + pattern + scope 标识（session/persisted）+ Remove
 *   - 底部有 "Clear session rules" 按钮（仅当有 session 规则时显示）
 *   - 底部有 "Manage all workspaces" 链接跳 Settings
 *
 * 打开时：
 *   - 按钮背景变色 + 箭头 ▲
 *   - 展开后自动 fetch rules
 *   - 点 popover 外部区域收起
 */
export function PermissionsPopover({ workspacePath }: Props) {
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

  // 初次挂载 + workspace 变化时拉取规则数（为了展示 badge 计数）
  useEffect(() => { refresh() }, [refresh])

  // 展开时再刷一次，保证数据最新
  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  // 点 popover 外收起
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleRemove = async (ruleId: string) => {
    await talorAPI.permissions.remove(workspacePath, ruleId)
    await refresh()
  }

  const handleClearSession = async () => {
    await talorAPI.permissions.clearSession(workspacePath)
    await refresh()
  }

  const allRules = [...view.session, ...view.persisted]
  const allowedRules = allRules.filter(r => r.effect === 'allow')
  const deniedRules = allRules.filter(r => r.effect === 'deny')
  const totalCount = allRules.length
  const hasSessionRules = view.session.length > 0

  const buttonStyle: React.CSSProperties = {
    background: open ? 'rgba(59,130,246,0.12)' : 'transparent',
    color: open ? '#2563eb' : (totalCount > 0 ? '#64748b' : '#94a3b8'),
    border: '1px solid',
    borderColor: open ? 'rgba(59,130,246,0.3)' : '#e2e8f0',
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
        {totalCount > 0 && (
          <span className="font-mono text-[10px] opacity-80">· {totalCount}</span>
        )}
        <span className="text-[9px] opacity-60">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-[380px] rounded-lg shadow-xl z-40"
          style={{ background: '#ffffff', border: '1px solid #e2e8f0' }}
        >
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-semibold text-gray-900">Permissions</p>
              <p className="text-xs text-gray-400">{totalCount} rule{totalCount === 1 ? '' : 's'}</p>
            </div>
            <p className="text-xs font-mono text-gray-500 truncate mt-0.5" title={workspacePath}>
              {workspacePath}
            </p>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            <RuleGroup
              title="Allowed"
              rules={allowedRules}
              effect="allow"
              onRemove={handleRemove}
            />
            <RuleGroup
              title="Denied"
              rules={deniedRules}
              effect="deny"
              onRemove={handleRemove}
            />
          </div>

          {(hasSessionRules || totalCount === 0) && (
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

          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
            <button
              onClick={() => { /* Settings 入口由外层处理——此处先留空 */ }}
              className="text-blue-600 hover:text-blue-800"
              title="Open Settings → Permissions to see rules for other workspaces"
            >
              Manage all workspaces →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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
