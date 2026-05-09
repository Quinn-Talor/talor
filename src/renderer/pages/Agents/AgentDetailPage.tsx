// AgentDetailPage — Schema 1.0 agent profile 内嵌只读详情页(非弹窗)。
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
  const identity = (profile.identity as Record<string, unknown> | undefined) ?? {}
  const mission = (profile.mission as Record<string, unknown> | undefined) ?? {}
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const delivery = (profile.delivery as Record<string, unknown> | undefined) ?? {}
  const execution = (profile.execution as Record<string, unknown> | undefined) ?? {}
  const preferences = (profile.preferences as Record<string, unknown> | undefined) ?? {}

  const objective = typeof mission.objective === 'string' ? mission.objective : ''
  const outcomes = Array.isArray(mission.outcomes)
    ? (mission.outcomes as Array<{ id?: string; description?: string; priority?: string }>)
    : []
  const inputs = Array.isArray(mission.inputs)
    ? (mission.inputs as Array<{
        id?: string
        description?: string
        required?: boolean
        type?: string
      }>)
    : []

  const capabilities = Array.isArray(method.capabilities)
    ? (method.capabilities as unknown[]).filter((c): c is string => typeof c === 'string')
    : []
  const knowledge = Array.isArray(method.knowledge)
    ? (method.knowledge as Array<{
        type?: string
        path?: string
        url?: string
        description?: string
        required?: boolean
      }>)
    : []
  const tools = Array.isArray(method.tools)
    ? (method.tools as Array<{
        name?: string
        required?: boolean
        disabled?: boolean
        purpose?: string
      }>)
    : []
  // Schema 1.0 SkillItem flat: { name, required, purpose? }
  const skills = Array.isArray(method.skills)
    ? (method.skills as Array<{ name?: string; required?: boolean; purpose?: string }>)
    : []
  const cli = Array.isArray(method.cli)
    ? (method.cli as Array<{ command?: string; version?: string }>)
    : []
  const collab =
    (method.collaboration as
      | {
          subagents?: Array<{ id?: string; required?: boolean; purpose?: string }>
          allowAnyBusinessSubagent?: boolean
        }
      | undefined) ?? {}
  const subagents = collab.subagents ?? []
  const allowAnyBusiness = collab.allowAnyBusinessSubagent === true

  const deliverables = Array.isArray(delivery.deliverables)
    ? (delivery.deliverables as Array<{
        id?: string
        format?: string
        trigger?: string
        required?: boolean
      }>)
    : []

  const limits = (execution.limits as { maxSteps?: number; maxTokens?: number } | undefined) ?? {}
  const retryPolicy =
    (execution.retryPolicy as
      | { maxAttempts?: number; onMustFail?: string; onShouldFail?: string }
      | undefined) ?? {}

  const lockedModel = typeof preferences.modelId === 'string' ? preferences.modelId : ''
  const lockedProvider = typeof preferences.providerId === 'string' ? preferences.providerId : ''

  const workflow = method.workflow as
    | {
        kind?: string
        steps?: Array<{
          id?: string
          description?: string
          kind?: string
          use?: {
            tools?: string[]
            skills?: string[]
            mcpServers?: string[]
            cli?: string[]
          }
          produces?: string
          requires?: string[]
          inputs?: string[]
        }>
      }
    | undefined

  const scope = mission.scope as { in?: unknown[]; out?: unknown[] } | undefined
  const scopeIn = Array.isArray(scope?.in)
    ? (scope!.in as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const scopeOut = Array.isArray(scope?.out)
    ? (scope!.out as unknown[]).filter((t): t is string => typeof t === 'string')
    : []

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
              title="安装/重装 method.skills 中的 skill 包,并跑依赖检查"
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
                <ReadField label="Agent ID" value={(identity.id as string) ?? detail.id} mono />
                <ReadField label="名称" value={(identity.name as string) ?? detail.name} />
                {(identity.description || detail.description) && (
                  <ReadField
                    label="描述"
                    value={(identity.description as string) ?? detail.description ?? ''}
                  />
                )}
                <ReadField
                  label="版本"
                  value={(identity.version as string) ?? detail.version ?? '—'}
                  mono
                />
                {detail.status && <ReadField label="状态" value={detail.status} mono />}
                {detail.dirPath && <ReadField label="文件路径" value={detail.dirPath} mono />}
              </Section>

              {(objective ||
                outcomes.length > 0 ||
                inputs.length > 0 ||
                scopeIn.length > 0 ||
                scopeOut.length > 0) && (
                <Section title="Mission">
                  {objective && <ReadField label="核心任务 (objective)" value={objective} />}
                  {(scopeIn.length > 0 || scopeOut.length > 0) && (
                    <div>
                      <div className="text-[11px] font-medium mb-0.5" style={{ color: '#475569' }}>
                        边界 (scope)
                      </div>
                      <div
                        className="rounded-md border px-3 py-2 text-[12px] space-y-2"
                        style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
                      >
                        {scopeIn.length > 0 && (
                          <div>
                            <div
                              className="text-[11px] font-semibold mb-0.5"
                              style={{ color: '#16a34a' }}
                            >
                              ✓ 会做
                            </div>
                            <ul className="ml-3 space-y-0.5">
                              {scopeIn.map((s, i) => (
                                <li key={i} style={{ color: '#475569' }}>
                                  • {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {scopeOut.length > 0 && (
                          <div>
                            <div
                              className="text-[11px] font-semibold mb-0.5"
                              style={{ color: '#dc2626' }}
                            >
                              ✗ 不会做
                            </div>
                            <ul className="ml-3 space-y-0.5">
                              {scopeOut.map((s, i) => (
                                <li key={i} style={{ color: '#475569' }}>
                                  • {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {inputs.length > 0 && (
                    <ReadList
                      label="需要的输入 (inputs)"
                      items={inputs.map(
                        (i) =>
                          `${i.id ?? '?'} (${i.type ?? 'text'}${i.required ? ' · 必填' : ''})${i.description ? ' — ' + i.description : ''}`,
                      )}
                    />
                  )}
                  {outcomes.length > 0 && (
                    <ReadList
                      label="预期成果 (outcomes)"
                      items={outcomes.map(
                        (o) => `[${o.priority ?? 'core'}] ${o.id ?? '?'}: ${o.description ?? ''}`,
                      )}
                    />
                  )}
                </Section>
              )}

              <Section title="Method">
                <ReadList label="能力 (capabilities)" items={capabilities} fallback="(未声明)" />
                {tools.length > 0 && (
                  <ReadList
                    label="工具 (tools)"
                    items={tools.map((t) => {
                      const flags: string[] = []
                      if (t.required) flags.push('required')
                      if (t.disabled) flags.push('⛔ disabled')
                      return `${t.name ?? '?'}${flags.length ? ' · ' + flags.join(' · ') : ''}${t.purpose ? ' — ' + t.purpose : ''}`
                    })}
                  />
                )}
                {knowledge.length > 0 && (
                  <ReadList
                    label="知识 (knowledge)"
                    items={knowledge.map((k) =>
                      k.type === 'file'
                        ? `📄 ${k.path ?? '?'}${k.required ? ' · REQUIRED' : ''}${k.description ? ' — ' + k.description : ''}`
                        : k.type === 'url'
                          ? `🔗 ${k.url ?? '?'}${k.description ? ' — ' + k.description : ''}`
                          : `📝 (内嵌文本)${k.description ? ' — ' + k.description : ''}`,
                    )}
                  />
                )}
                {skills.length > 0 && (
                  <ReadList
                    label="Skill 依赖 (skills)"
                    items={skills.map(
                      (s) => `${s.name ?? '?'}${s.required ? ' · required' : ' · optional'}`,
                    )}
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
                {(subagents.length > 0 || allowAnyBusiness) && (
                  <ReadList
                    label="协作 (collaboration)"
                    items={
                      allowAnyBusiness
                        ? ['可委托给所有业务 agent (allowAnyBusinessSubagent=true)']
                        : subagents.map(
                            (s) =>
                              `${s.id ?? '?'}${s.required ? ' · required' : ' · optional'}${s.purpose ? ' — ' + s.purpose : ''}`,
                          )
                    }
                  />
                )}
                {workflow?.steps && workflow.steps.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium mb-0.5" style={{ color: '#475569' }}>
                      执行流程 (workflow
                      {workflow.kind && ` · ${labelForWorkflowKind(workflow.kind)}`})
                    </div>
                    <ol
                      className="rounded-md border px-3 py-2 text-[12px] space-y-2"
                      style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#475569' }}
                    >
                      {workflow.steps.map((s, idx) => (
                        <li key={idx}>
                          <strong>
                            {idx + 1}. {s.id ?? '?'}
                          </strong>
                          {s.kind && s.kind !== 'task' && (
                            <span style={{ color: '#dc2626' }}> · {labelForStepKind(s.kind)}</span>
                          )}
                          {s.description && (
                            <span style={{ color: '#64748b' }}> — {s.description}</span>
                          )}
                          {summarizeStepUse(s) && (
                            <div className="ml-4 mt-0.5 text-[11px]" style={{ color: '#94a3b8' }}>
                              使用：{summarizeStepUse(s)}
                            </div>
                          )}
                          {s.produces && (
                            <div className="ml-4 text-[11px]" style={{ color: '#94a3b8' }}>
                              产出：{s.produces}
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </Section>

              {deliverables.length > 0 && (
                <Section title="Delivery">
                  <ReadList
                    label="交付物 (deliverables)"
                    items={deliverables.map(
                      (d) =>
                        `${d.id ?? '?'} (${d.format ?? 'text'})${d.required === false ? ' · optional' : ''}${d.trigger ? ' — ' + d.trigger : ''}`,
                    )}
                  />
                </Section>
              )}

              {(limits.maxSteps !== undefined ||
                limits.maxTokens !== undefined ||
                retryPolicy.onMustFail) && (
                <Section title="Execution">
                  {(limits.maxSteps !== undefined || limits.maxTokens !== undefined) && (
                    <ReadField
                      label="资源上限 (limits)"
                      value={`maxSteps=${limits.maxSteps ?? '—'} · maxTokens=${limits.maxTokens ?? '—'}`}
                      mono
                    />
                  )}
                  {retryPolicy.onMustFail && (
                    <ReadField
                      label="重试策略 (retryPolicy)"
                      value={`maxAttempts=${retryPolicy.maxAttempts ?? '—'} · onMustFail=${retryPolicy.onMustFail} · onShouldFail=${retryPolicy.onShouldFail ?? '—'}`}
                      mono
                    />
                  )}
                </Section>
              )}

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
                  完整 JSON (Schema 1.0)
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

function labelForWorkflowKind(kind: string): string {
  switch (kind) {
    case 'sequence':
      return '按顺序执行'
    case 'dag':
      return '部分步骤可并行'
    case 'reactive':
      return '按需反应'
    default:
      return kind
  }
}

function labelForStepKind(kind: string): string {
  switch (kind) {
    case 'wait_for_user_approval':
      return '等用户确认'
    case 'branch':
      return '条件分支'
    case 'loop':
      return '循环'
    default:
      return kind
  }
}

function summarizeStepUse(s: {
  use?: { tools?: string[]; skills?: string[]; mcpServers?: string[]; cli?: string[] }
}): string {
  const parts: string[] = []
  const tools = s.use?.tools ?? []
  const skills = s.use?.skills ?? []
  const mcps = s.use?.mcpServers ?? []
  const cli = s.use?.cli ?? []
  if (tools.length > 0) parts.push(`工具 ${tools.join('/')}`)
  if (skills.length > 0) parts.push(`skill ${skills.join('/')}`)
  if (mcps.length > 0) parts.push(`MCP ${mcps.join('/')}`)
  if (cli.length > 0) parts.push(`CLI ${cli.join('/')}`)
  return parts.join(' · ')
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
