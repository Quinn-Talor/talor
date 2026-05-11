// AgentDetailPage — Schema 2.0 agent profile 内嵌只读详情页(非弹窗)。
// 在 Agents 工作区内替换列表显示,顶部"← 返回"按钮回列表。

import { useEffect, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'

interface AgentDetail {
  id: string
  name: string
  description?: string
  version?: string
  status?: string
  dirPath?: string
  profile: Record<string, unknown>
}

interface AgentDetailPageProps {
  agentId: string
  onBack: () => void
  onStart?: (agentId: string) => void | Promise<void>
  onEdit?: (agentId: string) => void
}

export function AgentDetailPage({ agentId, onBack, onStart, onEdit }: AgentDetailPageProps) {
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    setLoadError(null)
    void (async () => {
      try {
        const result = (await talorAPI.agents.get(agentId)) as AgentDetail | null
        if (cancelled) return
        if (!result) {
          setLoadError(`未找到 agent: ${agentId}`)
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
  }, [agentId])

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
    <div className="flex flex-col h-full bg-white" data-testid="agent-detail-page">
      <header className="flex items-center px-4 py-3 border-b" style={{ borderColor: '#e2e8f0' }}>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md px-2 py-1 hover:bg-gray-100 text-sm flex items-center gap-1"
          style={{ color: '#475569' }}
        >
          ← 返回
        </button>
        <span className="text-base mx-3">🔮</span>
        <span className="text-sm font-semibold flex-1" style={{ color: '#1e293b' }}>
          {detail?.name ? `${detail.name} 详情` : 'Agent 详情'}
        </span>
        <div className="flex gap-2">
          {detail && (
            <button
              type="button"
              onClick={async () => {
                setInstalling(true)
                setInstallResult(null)
                try {
                  const r = (await talorAPI.agents.installDeps(detail.id)) as {
                    passed?: boolean
                    steps?: Array<{ step: string; status: string; message?: string }>
                  }
                  if (r.passed) {
                    setInstallResult('✓ 全部依赖就绪')
                  } else {
                    const missing =
                      r.steps
                        ?.filter((s) => s.status !== 'pass')
                        .map((s) => `${s.step}: ${s.message ?? '?'}`) ?? []
                    setInstallResult(`⚠️ 仍缺: ${missing.join(' | ')}`)
                  }
                  setTimeout(() => setInstallResult(null), 5000)
                } catch (err) {
                  setInstallResult(`❌ ${err instanceof Error ? err.message : String(err)}`)
                } finally {
                  setInstalling(false)
                }
              }}
              disabled={installing}
              className="rounded-md px-3 py-1 text-[12px] hover:bg-gray-100 border disabled:opacity-50"
              style={{ color: '#475569', borderColor: '#cbd5e1' }}
              title="安装/重装 profile.skills 中的 skill 包,并跑依赖检查"
            >
              {installing ? '安装中…' : '⟳ 安装依赖'}
            </button>
          )}
          {detail && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify(detail.profile, null, 2))
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {
                  // ignore
                }
              }}
              className="rounded-md px-3 py-1 text-[12px] hover:bg-gray-100 border"
              style={{ color: '#475569', borderColor: '#cbd5e1' }}
            >
              {copied ? '✓ 已复制' : '复制 JSON'}
            </button>
          )}
          {onEdit && detail && (
            <button
              type="button"
              onClick={() => onEdit(detail.id)}
              className="rounded-md px-3 py-1 text-[12px] font-medium border"
              style={{ color: '#475569', borderColor: '#cbd5e1' }}
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
              className="rounded-md px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50"
              style={{ background: '#8b5cf6' }}
            >
              {starting ? '启动中…' : '开始'}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-[960px] mx-auto space-y-4">
          {loadError && (
            <div
              className="rounded-md px-3 py-2 text-[12px]"
              style={{ background: '#fef2f2', border: '1px solid #fee2e2', color: '#dc2626' }}
            >
              {loadError}
            </div>
          )}
          {installResult && (
            <div
              className="rounded-md px-3 py-2 text-[12px]"
              style={{
                background: installResult.startsWith('✓') ? '#f0fdf4' : '#fffbeb',
                border: `1px solid ${installResult.startsWith('✓') ? '#bbf7d0' : '#fde68a'}`,
                color: installResult.startsWith('✓') ? '#166534' : '#92400e',
              }}
            >
              {installResult}
            </div>
          )}
          {!detail && !loadError && (
            <div className="text-[12px]" style={{ color: '#94a3b8' }}>
              加载中…
            </div>
          )}

          {detail && (
            <>
              <Section title="Identity">
                <ReadField label="Agent ID" value={detail.id} mono />
                <ReadField label="名称" value={detail.name} />
                {detail.description && <ReadField label="描述" value={detail.description} />}
                <ReadField label="版本" value={detail.version ?? '—'} mono />
                {detail.status && <ReadField label="状态" value={detail.status} mono />}
                {detail.dirPath && <ReadField label="文件路径" value={detail.dirPath} mono />}
              </Section>

              {agentPrompt && (
                <Section title="Agent Prompt">
                  <details className="text-[12px]">
                    <summary
                      className="cursor-pointer text-[12px] font-medium"
                      style={{ color: '#7c3aed' }}
                    >
                      点击展开完整 prompt
                    </summary>
                    <pre
                      className="mt-2 rounded-md border px-3 py-2 text-[11px] font-mono overflow-auto whitespace-pre-wrap break-words"
                      style={{
                        borderColor: '#e2e8f0',
                        background: '#f8fafc',
                        color: '#334155',
                        maxHeight: 400,
                      }}
                    >
                      {agentPrompt}
                    </pre>
                  </details>
                </Section>
              )}

              <Section title="Dependencies">
                {tools.length > 0 && <ReadList label="工具 (tools)" items={tools} />}
                {skills.length > 0 && (
                  <ReadList
                    label="Skill 依赖 (skills)"
                    items={skills.map(
                      (s) =>
                        `${s.name ?? '?'}${s.required ? ' · required' : ' · optional'}${s.purpose ? ' — ' + s.purpose : ''}`,
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
                      (c) => `${c.command ?? '?'}${c.version ? ' (' + c.version + ')' : ''}`,
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
                        ? ['可委托给所有业务 agent (allowAny=true)']
                        : subagents.map(
                            (s) =>
                              `${s.id ?? '?'}${s.required ? ' · required' : ' · optional'}${s.purpose ? ' — ' + s.purpose : ''}`,
                          )
                    }
                  />
                )}
                {tools.length === 0 &&
                  skills.length === 0 &&
                  mcpServers.length === 0 &&
                  cli.length === 0 &&
                  references.length === 0 &&
                  subagents.length === 0 &&
                  !allowAnyBusiness && (
                    <div className="text-[12px]" style={{ color: '#94a3b8' }}>
                      （无依赖声明）
                    </div>
                  )}
              </Section>

              {(lockedModel || lockedProvider) && (
                <Section title="Preferences">
                  <ReadField
                    label="锁定模型"
                    value={`${lockedProvider ?? ''}${lockedProvider && lockedModel ? ' / ' : ''}${lockedModel ?? ''}`}
                    mono
                  />
                </Section>
              )}

              <details className="text-[12px]">
                <summary className="cursor-pointer" style={{ color: '#7c3aed' }}>
                  完整 JSON (Schema 2.0)
                </summary>
                <pre
                  className="mt-2 rounded-md border px-3 py-2 text-[11px] font-mono overflow-auto"
                  style={{
                    borderColor: '#e2e8f0',
                    background: '#f8fafc',
                    color: '#334155',
                    maxHeight: 400,
                  }}
                >
                  {JSON.stringify(detail.profile, null, 2)}
                </pre>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#e2e8f0' }}>
      <h3 className="text-[13px] font-semibold" style={{ color: '#7c3aed' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function ReadField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-[11px] font-medium mb-0.5" style={{ color: '#475569' }}>
        {label}
      </div>
      <div
        className={`rounded-md border px-3 py-1.5 text-[12px] ${mono ? 'font-mono' : ''}`}
        style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#334155' }}
      >
        {value}
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
      <div className="text-[11px] font-medium mb-0.5" style={{ color: '#475569' }}>
        {label}
      </div>
      <ul
        className="rounded-md border px-3 py-2 text-[12px] space-y-1"
        style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#475569' }}
      >
        {items.length > 0 ? (
          items.map((it, i) => <li key={i}>• {it}</li>)
        ) : (
          <li style={{ color: '#94a3b8' }}>{fallback ?? '(未声明)'}</li>
        )}
      </ul>
    </div>
  )
}
