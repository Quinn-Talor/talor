// AgentPreviewModal — 只读预览已保存的 agent profile（位于 ~/.talor/agents/<id>/agent.json）。
// 用户在 Agent Workbench 的"已生成 Agents"列表点击行时弹出。

import { useEffect, useState } from 'react'
import { talorAPI } from '../api/talorAPI'

interface AgentPreviewModalProps {
  open: boolean
  agentId: string
  onClose: () => void
  /** 点击"开始" → 父组件用 agentId 创建新 session 并切过去。 */
  onStart?: (agentId: string) => void | Promise<void>
  /** 点击"编辑" → 父组件打开 AgentEditPage(Schema 2.0) */
  onEdit?: (agentId: string) => void
}

interface AgentDetail {
  id: string
  name: string
  description?: string
  version?: string
  status?: string
  dirPath?: string
  profile: Record<string, unknown>
}

export function AgentPreviewModal({
  open,
  agentId,
  onClose,
  onStart,
  onEdit,
}: AgentPreviewModalProps) {
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDetail(null)
    setLoadError(null)
    void (async () => {
      try {
        const result = (await talorAPI.agents.get(agentId)) as AgentDetail | null
        if (cancelled) return
        if (!result) {
          setLoadError(`未找到 agent: ${agentId}（可能已被删除）`)
          return
        }
        setDetail(result)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, agentId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const profile = detail?.profile ?? {}
  // Schema 2.0: 扁平结构直接读顶层字段
  const agentPrompt = typeof profile.agentPrompt === 'string' ? profile.agentPrompt : ''
  const tools = Array.isArray(profile.tools)
    ? (profile.tools as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const skills = Array.isArray(profile.skills)
    ? (profile.skills as Array<{ name?: string; required?: boolean; purpose?: string }>)
    : []
  const mcpServers = Array.isArray(profile.mcpServers)
    ? (profile.mcpServers as Array<{ name?: string }>)
    : []
  const cli = Array.isArray(profile.cli)
    ? (profile.cli as Array<{ command?: string; version?: string }>)
    : []
  const references = Array.isArray(profile.references)
    ? (profile.references as Array<{ id?: string; path?: string; description?: string }>)
    : []
  const subagentsRaw = profile.subagents as
    | {
        ids?: Array<{ id?: string; required?: boolean; purpose?: string }>
        allowAny?: boolean
      }
    | undefined
  const subagents = subagentsRaw?.ids ?? []
  const allowAnyBusiness = subagentsRaw?.allowAny === true
  const preferences = (profile.preferences as Record<string, unknown> | undefined) ?? {}
  const lockedModel = typeof preferences.modelId === 'string' ? preferences.modelId : ''
  const lockedProvider = typeof preferences.providerId === 'string' ? preferences.providerId : ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="agent-preview-modal"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-[820px] max-w-[92vw] max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-5 py-3 border-b" style={{ borderColor: '#e2e8f0' }}>
          <span className="text-base mr-2">🔮</span>
          <span className="text-[14px] font-semibold flex-1" style={{ color: '#1e293b' }}>
            Agent 详情
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 hover:bg-gray-100 text-gray-500"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loadError && (
            <div
              className="rounded-md px-3 py-2 text-[12px]"
              style={{
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                color: '#dc2626',
              }}
            >
              {loadError}
            </div>
          )}

          {!detail && !loadError && (
            <div className="text-[12px]" style={{ color: '#94a3b8' }}>
              加载中…
            </div>
          )}

          {detail && (
            <>
              {/* identity — v2.0 flat */}
              <ReadField label="Agent ID" value={detail.id} mono />
              <ReadField label="名称" value={detail.name} />
              {detail.description && <ReadField label="描述" value={detail.description} />}
              <ReadField label="版本" value={detail.version ?? '—'} mono />
              {detail.status && <ReadField label="状态" value={detail.status} mono />}
              {detail.dirPath && <ReadField label="文件路径" value={detail.dirPath} mono />}

              {/* agentPrompt preview */}
              {agentPrompt && (
                <details className="text-[12px]">
                  <summary className="cursor-pointer font-medium" style={{ color: '#7c3aed' }}>
                    Agent Prompt（点击展开）
                  </summary>
                  <pre
                    className="mt-2 rounded-md border px-3 py-2 text-[11px] font-mono overflow-auto whitespace-pre-wrap break-words"
                    style={{
                      borderColor: '#e2e8f0',
                      background: '#f8fafc',
                      color: '#334155',
                      maxHeight: 300,
                    }}
                  >
                    {agentPrompt}
                  </pre>
                </details>
              )}

              {/* dependency manifests */}
              {tools.length > 0 && <ReadList label="工具 (tools)" items={tools} />}
              {skills.length > 0 && (
                <ReadList
                  label="Skill 依赖 (skills)"
                  items={skills.map(
                    (s) =>
                      `${s.name ?? '(unknown)'}${s.required ? ' · required' : ' · optional'}${s.purpose ? ' — ' + s.purpose : ''}`,
                  )}
                />
              )}
              {mcpServers.length > 0 && (
                <ReadList
                  label="外部服务 (mcpServers)"
                  items={mcpServers.map((m) => m.name ?? '(unknown)')}
                />
              )}
              {cli.length > 0 && (
                <ReadList
                  label="CLI 依赖 (cli)"
                  items={cli.map(
                    (c) => `${c.command ?? '(unknown)'}${c.version ? ' (' + c.version + ')' : ''}`,
                  )}
                />
              )}
              {references.length > 0 && (
                <ReadList
                  label="参考资料 (references)"
                  items={references.map(
                    (r) =>
                      `${r.id ?? '?'}: ${r.path ?? '?'}${r.description ? ' — ' + r.description : ''}`,
                  )}
                />
              )}
              {(subagents.length > 0 || allowAnyBusiness) && (
                <ReadList
                  label="子 agent (subagents)"
                  items={
                    allowAnyBusiness
                      ? ['可委托给所有业务 agent (allowAnyBusinessSubagent=true)']
                      : subagents.map(
                          (s) =>
                            `${s.id ?? '(unknown)'}${s.required ? ' · required' : ' · optional'}${s.purpose ? ' — ' + s.purpose : ''}`,
                        )
                  }
                />
              )}

              {/* preferences */}
              {(lockedModel || lockedProvider) && (
                <ReadField
                  label="锁定模型 (preferences)"
                  value={`${lockedProvider ?? ''}${lockedProvider && lockedModel ? ' / ' : ''}${lockedModel ?? ''}`}
                  mono
                />
              )}

              <details className="text-[12px]">
                <summary className="cursor-pointer" style={{ color: '#7c3aed' }}>
                  完整 JSON
                </summary>
                <pre
                  className="mt-2 rounded-md border px-3 py-2 text-[11px] font-mono overflow-auto"
                  style={{
                    borderColor: '#e2e8f0',
                    background: '#f8fafc',
                    color: '#334155',
                    maxHeight: 300,
                  }}
                >
                  {JSON.stringify(profile, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2 px-5 py-3 border-t"
          style={{ borderColor: '#e2e8f0', background: '#fafafa' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] hover:bg-gray-100"
            style={{ color: '#475569' }}
          >
            关闭
          </button>
          {detail && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(detail.profile, null, 2))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch (err) {
                  console.warn('clipboard write failed', err)
                }
              }}
              className="rounded-md px-3 py-1.5 text-[13px] hover:bg-gray-100"
              style={{ color: '#475569' }}
              title="复制 profile JSON 用于迭代 / 分享"
            >
              {copied ? '✓ 已复制' : '复制 JSON'}
            </button>
          )}
          {onEdit && detail && (
            <button
              type="button"
              onClick={() => onEdit(detail.id)}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium border"
              style={{ color: '#475569', borderColor: '#cbd5e1' }}
              title="Schema 2.0 编辑器"
            >
              编辑
            </button>
          )}
          {onStart && detail && (
            <button
              type="button"
              onClick={async () => {
                setStarting(true)
                try {
                  await onStart(detail.id)
                } finally {
                  setStarting(false)
                }
              }}
              disabled={starting}
              className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
              style={{ background: '#8b5cf6' }}
              data-testid="agent-preview-start-btn"
            >
              {starting ? '启动中…' : '开始'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReadField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1" style={{ color: '#475569' }}>
        {label}
      </label>
      <div
        className={`rounded-md border px-3 py-1.5 text-[13px] ${mono ? 'font-mono' : ''}`}
        style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#334155' }}
      >
        {value || <span style={{ color: '#94a3b8' }}>—</span>}
      </div>
    </div>
  )
}

function ReadList({
  label,
  items,
  fallback,
}: {
  label: string
  items: string[]
  fallback?: string
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1" style={{ color: '#475569' }}>
        {label}
      </label>
      <ul
        className="rounded-md border px-3 py-2 text-[12px] space-y-1"
        style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
      >
        {items.length === 0 ? (
          <li style={{ color: '#94a3b8' }}>{fallback ?? '（无）'}</li>
        ) : (
          items.map((item, i) => (
            <li key={i} style={{ color: '#475569' }}>
              • {item}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
