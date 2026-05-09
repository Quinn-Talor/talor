// DraftReviewModal — review/edit a crystallizer-produced agent draft and save.
//
// Schema 1.0 v7 layout:
//   ① 顶部 NL 摘要 (intent / steps / deps / inputs / rules) — 用户能直接读懂
//   ② 中部可编辑字段 (id / name / description / version / output format) — 必要的微调
//   ③ Mission inputs + workflow steps + dependency lists — 自然语言展示
//   ④ 底部"展开技术细节" — 默认折叠的完整 JSON
//
// 设计原则: 用户看的是 ①+③ 的自然语言，不需要懂 JSON。

import { useEffect, useMemo, useState } from 'react'
import { talorAPI } from '../api/talorAPI'

interface DraftReviewModalProps {
  open: boolean
  initialProfile: Record<string, unknown>
  workbenchSessionId: string
  onClose: () => void
  onSaved: (agentId: string) => void
}

interface EditableFields {
  id: string
  name: string
  description: string
  version: string
  outputFormat: string
}

const VERSION_FORMAT = /^\d+\.\d+\.\d+$/
const ID_FORMAT = /^[a-z0-9_-]+$/

export function DraftReviewModal({
  open,
  initialProfile,
  workbenchSessionId,
  onClose,
  onSaved,
}: DraftReviewModalProps) {
  const [fields, setFields] = useState<EditableFields>(() => extractFields(initialProfile))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)

  // Modal 打开时:用 LLM 给的合法 id (snake_case) 优先;没给或不合法时 fallback 'agent-<uuid>'
  useEffect(() => {
    if (!open) return
    const extracted = extractFields(initialProfile)
    const finalId = extracted.id && ID_FORMAT.test(extracted.id) ? extracted.id : generateAgentId()
    setFields({ ...extracted, id: finalId })
    setSaveError(null)
    setShowJson(false)
  }, [open, initialProfile])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const nameError = fields.name.trim() === '' ? '名称不能为空' : null
  const versionError = VERSION_FORMAT.test(fields.version) ? null : '版本号必须形如 1.0.0'
  const idError = ID_FORMAT.test(fields.id)
    ? null
    : 'ID 必须是 snake-case (lowercase + digits + _ -)'

  // 软警告:capabilities 提到 4 类依赖(skill / mcp / cli / subagent)但对应字段未声明
  // → 运行时装配阶段加载不到,LLM 看到 prompt 期望但工具列表里没,直接卡死。
  const depWarnings = useMemo(() => detectDependencyMismatch(initialProfile), [initialProfile])

  // capabilities 自动从 schema 1.0 method.capabilities 提取
  const capabilities = useMemo(() => autoExtractCapabilities(initialProfile), [initialProfile])

  // subagents 从 schema 1.0 method.collaboration.subagents 读
  const subagents = useMemo(() => extractSubagents(initialProfile), [initialProfile])

  // v7: 自然语言摘要 + 结构化展示数据
  const summary = useMemo(() => buildNaturalSummary(initialProfile), [initialProfile])
  const scope = useMemo(() => extractScope(initialProfile), [initialProfile])
  const missionInputs = useMemo(() => extractMissionInputs(initialProfile), [initialProfile])
  const workflowSteps = useMemo(() => extractWorkflowSteps(initialProfile), [initialProfile])
  const declaredDeps = useMemo(() => extractDeclaredDeps(initialProfile), [initialProfile])
  const deliverableRubric = useMemo(
    () => extractDeliverableRubric(initialProfile),
    [initialProfile],
  )

  const canSave = !nameError && !versionError && !idError && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const merged = mergeIntoSchemaV1(initialProfile, fields, capabilities)
      const result = await talorAPI.agents.createFromDraft(merged, workbenchSessionId)
      if (!result.success || !result.id) {
        setSaveError(result.error ?? 'unknown error')
        return
      }
      // 若有 skill 安装失败,提示用户但仍允许保存(agent 已落盘);失败 skill 后续可手动补
      const failed = result.skill_install?.failed ?? []
      if (failed.length > 0) {
        const lines = failed.map((f) => `  • ${f.name}: ${f.error}`).join('\n')
        const proceed = window.confirm(
          `Agent 已保存,但有 ${failed.length} 个 skill 未自动安装:\n${lines}\n\n` +
            `这些 skill 在运行时会缺失,LLM 调用 skill 工具时会报错。\n` +
            `修复方式: 把 SKILL.md 放到 ~/.claude/skills/<name>/, 然后到 agent 详情页点"安装依赖"。\n\n` +
            `点确定关闭审阅;取消保留对话框便于复制错误。`,
        )
        if (!proceed) {
          // 用户选择保留对话框看错误,onSaved 仍触发让外层知道 agent 已存
          onSaved(result.id)
          return
        }
      }
      onSaved(result.id)
      onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="draft-review-modal"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-[820px] max-w-[92vw] max-h-[88vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center px-5 py-3 border-b" style={{ borderColor: '#e2e8f0' }}>
          <span className="text-base mr-2">📦</span>
          <span className="text-[14px] font-semibold flex-1" style={{ color: '#1e293b' }}>
            审阅 Agent 草稿 (Schema 1.0)
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 hover:bg-gray-100 text-gray-500"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {saveError && (
            <div
              className="rounded-md px-3 py-2 text-[12px]"
              style={{
                background: '#fef2f2',
                border: '1px solid #fee2e2',
                color: '#dc2626',
              }}
              data-testid="draft-save-error"
            >
              保存失败: {saveError}
            </div>
          )}

          {/* v7: 自然语言摘要 — 用户读这一段就知道 agent 是什么 */}
          <div
            className="rounded-md px-4 py-3 space-y-1.5"
            style={{
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
            }}
            data-testid="draft-natural-summary"
          >
            <div className="text-[12px] font-semibold mb-1" style={{ color: '#6d28d9' }}>
              ✅ 已生成 agent 草稿
            </div>
            {summary.map((line, i) => (
              <div key={i} className="text-[12px]" style={{ color: '#5b21b6' }}>
                • {line}
              </div>
            ))}
          </div>

          {depWarnings.length > 0 && (
            <div
              className="rounded-md px-3 py-2 text-[12px] space-y-1"
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                color: '#92400e',
              }}
            >
              <div>
                ⚠️ <strong>依赖声明不完整</strong>:capabilities 提到下列依赖,但对应字段未声明,
                运行时装配阶段不会加载,LLM 会卡死:
              </div>
              <ul className="ml-4 space-y-0.5">
                {depWarnings.map((w, i) => (
                  <li key={i}>
                    <strong>{w.kind}</strong>:{' '}
                    <code className="font-mono">{w.items.join(', ')}</code> (应在{' '}
                    <code className="font-mono">{w.field}</code> 声明)
                  </li>
                ))}
              </ul>
              <div className="mt-1">
                建议回工作台让 Crystallizer 重新生成,或手动编辑 JSON 补全。
              </div>
            </div>
          )}

          <Field label="Agent ID" error={idError}>
            <input
              type="text"
              value={fields.id}
              onChange={(e) => setFields((f) => ({ ...f, id: e.target.value }))}
              className="w-full rounded-md border px-3 py-1.5 text-[13px] font-mono"
              style={{ borderColor: idError ? '#dc2626' : '#cbd5e1' }}
              data-testid="draft-id-input"
            />
            <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              snake-case (lowercase + digits + _ -),不可带 __ 前后缀(平台保留)。LLM 给的合法 id
              已自动填入,可手动修改。
            </div>
          </Field>

          <Field label="名称 *" error={nameError}>
            <input
              type="text"
              value={fields.name}
              onChange={(e) => setFields((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: nameError ? '#dc2626' : '#cbd5e1' }}
            />
          </Field>

          <Field label="描述">
            <textarea
              value={fields.description}
              onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: '#cbd5e1' }}
            />
          </Field>

          <Field label="版本" error={versionError}>
            <input
              type="text"
              value={fields.version}
              onChange={(e) => setFields((f) => ({ ...f, version: e.target.value }))}
              className="w-full rounded-md border px-3 py-1.5 text-[13px] font-mono"
              style={{ borderColor: versionError ? '#dc2626' : '#cbd5e1' }}
            />
          </Field>

          <Field label="能力(自动提取自 method.capabilities)">
            <ul
              className="rounded-md border px-3 py-2 text-[12px] space-y-1"
              style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
              data-testid="draft-capabilities-list"
            >
              {capabilities.map((c, i) => (
                <li key={i} style={{ color: '#475569' }}>
                  • {c}
                </li>
              ))}
            </ul>
            <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              如需调整,请回到工作台让 Crystallizer 重新生成。
            </div>
          </Field>

          <Field label="主要交付物格式(delivery.deliverables[0].format)">
            <select
              value={fields.outputFormat}
              onChange={(e) => setFields((f) => ({ ...f, outputFormat: e.target.value }))}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: '#cbd5e1' }}
            >
              <option value="markdown">markdown</option>
              <option value="json">json</option>
              <option value="text">text</option>
              <option value="structured">structured</option>
            </select>
          </Field>

          {(scope.in.length > 0 || scope.out.length > 0) && (
            <Field label="边界（会做 / 不会做）">
              <div
                className="rounded-md border px-3 py-2 text-[12px] space-y-2"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
                data-testid="draft-scope"
              >
                {scope.in.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold mb-0.5" style={{ color: '#16a34a' }}>
                      ✓ 会做
                    </div>
                    <ul className="ml-3 space-y-0.5">
                      {scope.in.map((item, i) => (
                        <li key={i} style={{ color: '#475569' }}>
                          • {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {scope.out.length > 0 && (
                  <div>
                    <div className="text-[11px] font-semibold mb-0.5" style={{ color: '#dc2626' }}>
                      ✗ 不会做
                    </div>
                    <ul className="ml-3 space-y-0.5">
                      {scope.out.map((item, i) => (
                        <li key={i} style={{ color: '#475569' }}>
                          • {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Field>
          )}

          {missionInputs.length > 0 && (
            <Field label="需要的输入">
              <ul
                className="rounded-md border px-3 py-2 text-[12px] space-y-1"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
                data-testid="draft-inputs-list"
              >
                {missionInputs.map((inp, i) => (
                  <li key={i} style={{ color: '#475569' }}>
                    • <strong>{inp.id}</strong>{' '}
                    <span style={{ color: '#94a3b8' }}>({inp.type})</span>
                    {inp.required && <span style={{ color: '#dc2626' }}> · 必填</span>}
                    {inp.description && (
                      <span style={{ color: '#64748b' }}> — {inp.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </Field>
          )}

          {workflowSteps.length > 0 && (
            <Field label="执行流程">
              <ol
                className="rounded-md border px-3 py-2 text-[12px] space-y-1.5"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
                data-testid="draft-workflow-steps"
              >
                {workflowSteps.map((s, i) => (
                  <li key={i} style={{ color: '#475569' }}>
                    <strong>
                      {i + 1}. {s.id}
                    </strong>
                    {s.kindLabel && <span style={{ color: '#dc2626' }}> · {s.kindLabel}</span>}
                    {s.description && <span style={{ color: '#64748b' }}> — {s.description}</span>}
                    {s.uses && (
                      <div className="ml-4 mt-0.5 text-[11px]" style={{ color: '#94a3b8' }}>
                        使用：{s.uses}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </Field>
          )}

          {declaredDeps.tools.length +
            declaredDeps.skills.length +
            declaredDeps.mcps.length +
            declaredDeps.cli.length >
            0 && (
            <Field label="使用的依赖">
              <div
                className="rounded-md border px-3 py-2 text-[12px] space-y-1"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
                data-testid="draft-deps-list"
              >
                {declaredDeps.tools.length > 0 && (
                  <div style={{ color: '#475569' }}>
                    🔧 <strong>工具</strong>：{declaredDeps.tools.join(' · ')}
                  </div>
                )}
                {declaredDeps.skills.length > 0 && (
                  <div style={{ color: '#475569' }}>
                    🎯 <strong>Skill</strong>：{declaredDeps.skills.join(' · ')}
                  </div>
                )}
                {declaredDeps.mcps.length > 0 && (
                  <div style={{ color: '#475569' }}>
                    🌐 <strong>外部服务 (MCP)</strong>：{declaredDeps.mcps.join(' · ')}
                  </div>
                )}
                {declaredDeps.cli.length > 0 && (
                  <div style={{ color: '#475569' }}>
                    💻 <strong>命令行</strong>：{declaredDeps.cli.join(' · ')}
                  </div>
                )}
              </div>
            </Field>
          )}

          {deliverableRubric.length > 0 && (
            <Field label="自检规则 (怎样算干完了)">
              <ul
                className="rounded-md border px-3 py-2 text-[12px] space-y-1"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
              >
                {deliverableRubric.map((r, i) => (
                  <li key={i} style={{ color: '#475569' }}>
                    {r}
                  </li>
                ))}
              </ul>
            </Field>
          )}

          {subagents.length > 0 && (
            <Field label="可委托的子 agent">
              <ul
                className="rounded-md border px-3 py-2 text-[12px] space-y-1"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc' }}
              >
                {subagents.map((s, i) => (
                  <li key={i}>
                    • <span className="font-mono">{s.id ?? '(unknown)'}</span>
                    {s.required ? (
                      <span style={{ color: '#dc2626' }}> · required</span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}> · optional</span>
                    )}
                  </li>
                ))}
              </ul>
            </Field>
          )}

          <div>
            <button
              type="button"
              onClick={() => setShowJson((v) => !v)}
              className="text-[11px] hover:underline"
              style={{ color: '#94a3b8' }}
            >
              {showJson ? '▲ 折起' : '▼ 展开'} 技术细节 (完整 JSON)
            </button>
            {showJson && (
              <pre
                className="mt-2 rounded-md border px-3 py-2 text-[11px] font-mono overflow-auto"
                style={{
                  borderColor: '#e2e8f0',
                  background: '#f8fafc',
                  color: '#334155',
                  maxHeight: 240,
                }}
              >
                {JSON.stringify(initialProfile, null, 2)}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
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
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: canSave ? '#3b82f6' : '#94a3b8' }}
            data-testid="draft-save-button"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-[12px] font-medium mb-1" style={{ color: '#475569' }}>
        {label}
      </label>
      {children}
      {error && (
        <div className="mt-1 text-[11px]" style={{ color: '#dc2626' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ─── Schema 1.0 字段提取 ─────────────────────────────────────

function extractFields(profile: Record<string, unknown>): EditableFields {
  const identity = (profile.identity as Record<string, unknown> | undefined) ?? {}
  const delivery = (profile.delivery as Record<string, unknown> | undefined) ?? {}
  const deliverables = Array.isArray(delivery.deliverables) ? delivery.deliverables : []
  const firstDeliv = (deliverables[0] as Record<string, unknown> | undefined) ?? {}

  const fmt = typeof firstDeliv.format === 'string' ? firstDeliv.format : ''
  const validFormats = new Set(['markdown', 'json', 'text', 'structured'])

  return {
    id: typeof identity.id === 'string' ? identity.id : '',
    name: typeof identity.name === 'string' ? identity.name : '',
    description: typeof identity.description === 'string' ? identity.description : '',
    version: typeof identity.version === 'string' ? identity.version : '1.0.0',
    outputFormat: validFormats.has(fmt) ? fmt : 'markdown',
  }
}

function autoExtractCapabilities(profile: Record<string, unknown>): string[] {
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const declared = Array.isArray(method.capabilities)
    ? (method.capabilities as unknown[]).filter(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      )
    : []
  if (declared.length > 0) return declared

  const identity = (profile.identity as Record<string, unknown> | undefined) ?? {}
  const desc = typeof identity.description === 'string' ? identity.description : ''
  const trimmed = desc.trim()
  if (trimmed === '') return ['通用助手能力']
  const parts = trimmed
    .split(/[。.；;\n]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return [trimmed]
  return parts
}

interface SubagentRef {
  id?: string
  required?: boolean
}

function extractSubagents(profile: Record<string, unknown>): SubagentRef[] {
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const collab = (method.collaboration as { subagents?: unknown } | undefined) ?? {}
  return Array.isArray(collab.subagents) ? (collab.subagents as SubagentRef[]) : []
}

// ─── enum 兜底矫正 ─────────────────────────────────────
//
// LLM (尤其弱模型) 经常把 enum 字段写成中文或自创值,导致 validator [rule 1] 拦下保存。
// 这里在保存前做防御性矫正:
//   - 命中已知中文/同义词映射 → 转回合法值
//   - 完全不匹配 → 用安全默认值
// 只动 enum 字段,其它内容(LLM 给的描述、知识、工作流)原样保留。

const PRIORITY_MAP: Record<string, 'core' | 'auxiliary'> = {
  core: 'core',
  核心: 'core',
  主要: 'core',
  必须: 'core',
  required: 'core',
  main: 'core',
  primary: 'core',
  auxiliary: 'auxiliary',
  辅助: 'auxiliary',
  次要: 'auxiliary',
  可选: 'auxiliary',
  optional: 'auxiliary',
  secondary: 'auxiliary',
}

const VERIFY_TYPE_VALID = new Set([
  'deliverable-present',
  'tool-was-used',
  'tool-not-used',
  'tool-not-failed',
  'output-matches',
  'verifier-tool',
  'llm-judge',
  'human-approval',
])

const KIND_MAP: Record<string, 'deterministic' | 'semantic' | 'human'> = {
  deterministic: 'deterministic',
  确定性: 'deterministic',
  确定: 'deterministic',
  semantic: 'semantic',
  语义: 'semantic',
  语义判断: 'semantic',
  human: 'human',
  人工: 'human',
  人工审核: 'human',
}

const SEVERITY_MAP: Record<string, 'must' | 'should'> = {
  must: 'must',
  必须: 'must',
  required: 'must',
  hard: 'must',
  should: 'should',
  应该: 'should',
  optional: 'should',
  soft: 'should',
}

const ON_MUST_FAIL_VALID = new Set(['retry-then-mark', 'retry-then-escalate', 'abort'])
const ON_SHOULD_FAIL_VALID = new Set(['mark-only', 'retry-once'])

function pickEnum<T extends string>(raw: unknown, validSet: Set<string>, defaultValue: T): T {
  if (typeof raw !== 'string') return defaultValue
  const lower = raw.toLowerCase()
  return (validSet.has(raw) ? raw : validSet.has(lower) ? lower : defaultValue) as T
}

function pickFromMap<T extends string>(raw: unknown, map: Record<string, T>, defaultValue: T): T {
  if (typeof raw !== 'string') return defaultValue
  return map[raw] ?? map[raw.toLowerCase()] ?? defaultValue
}

// v8.1: 仅 7 个真内置工具可写在 method.tools
const BUILTIN_TOOL_NAMES = new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls'])
// 元工具集合 — 误写在 method.tools 时静默剥离,根据剥离了哪些反向回填派生字段
const META_TOOL_NAMES = new Set(['skill', 'search_tool', 'delegate_agent'])

function coerceEnumDefaults(profile: Record<string, unknown>): Record<string, unknown> {
  // 深克隆避免改原对象
  const next = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>

  // 取 primary deliverable id 用作 verifyBy 兜底引用目标
  const delivery = next.delivery as Record<string, unknown> | undefined
  const deliverables = Array.isArray(delivery?.deliverables)
    ? (delivery!.deliverables as Array<Record<string, unknown>>)
    : []
  const primaryDeliverableId = deliverables.find((d) => typeof d.id === 'string')?.id as
    | string
    | undefined

  // 如 LLM 没声明任何 deliverable, 兜底注入一个
  if (deliverables.length === 0) {
    const fallback = {
      id: 'main_output',
      format: 'markdown',
      mustContain: ['.+'],
    }
    if (delivery) {
      delivery.deliverables = [fallback]
    } else {
      next.delivery = { deliverables: [fallback] }
    }
  }

  // v8: 移除 LLM 偶尔残留的 delivery.acceptance(已不再是合法字段),静默丢弃
  if (delivery && 'acceptance' in delivery) {
    delete delivery.acceptance
  }

  const fallbackId = primaryDeliverableId ?? 'main_output'

  // mission.outcomes[].priority + verifyBy[].{type,kind,severity,deliverableId,toolName}
  const mission = next.mission as Record<string, unknown> | undefined
  if (mission && Array.isArray(mission.outcomes)) {
    for (const oc of mission.outcomes as Array<Record<string, unknown>>) {
      oc.priority = pickFromMap(oc.priority, PRIORITY_MAP, 'core')
      if (Array.isArray(oc.verifyBy)) {
        for (const c of oc.verifyBy as Array<Record<string, unknown>>) {
          coerceCriterion(c, fallbackId)
        }
      }
    }
  }

  // v8: 静默删 LLM 残留的 mission.triggers / mission.successMetrics
  if (mission) {
    if ('triggers' in mission) delete mission.triggers
    if ('successMetrics' in mission) delete mission.successMetrics
  }

  // ===== v8.1: method.tools 净化 — 剥离元工具,根据剥离反推 method.{mcpServers,skills} =====
  const method = next.method as Record<string, unknown> | undefined
  if (method) {
    sanitizeMethodTools(method)
    // capabilities 提到但未声明的 cli 自动补 (cli 通过 bash 运行,安全自动补);
    // skill 不自动补 (LLM 可能写错名字,需用户校对)
    autoFillCliFromCapabilities(method)
  }

  // ===== workflow 三类语义修复 =====
  if (method) {
    fixWorkflowSemantics(
      method,
      mission,
      deliverables.length > 0
        ? deliverables
        : (next.delivery as { deliverables: Array<Record<string, unknown>> }).deliverables,
    )
  }

  // execution.retryPolicy.{onMustFail,onShouldFail}
  const exec = next.execution as Record<string, unknown> | undefined
  const policy = exec?.retryPolicy as Record<string, unknown> | undefined
  if (policy) {
    policy.onMustFail = pickEnum(policy.onMustFail, ON_MUST_FAIL_VALID, 'retry-then-mark')
    policy.onShouldFail = pickEnum(policy.onShouldFail, ON_SHOULD_FAIL_VALID, 'mark-only')
    if (typeof policy.maxAttempts !== 'number' || policy.maxAttempts < 1) {
      policy.maxAttempts = 2
    }
  }

  return next
}

// CLI 命令模式 — 与 detectDependencyMismatch 中 CLI_PATTERN 同步
const CLI_TOKEN_RE =
  /\b(git|npm|yarn|pnpm|docker|kubectl|gh|curl|wget|go|cargo|python3?|pip3?|node|bun|deno|aws|gcloud|terraform|ansible|make|sed|awk|jq|ffmpeg|psql|mysql|redis-cli)\b/g

/**
 * 自动补 capabilities 提到的 cli 到 method.cli。
 * cli 通过 bash 运行(method.tools 已含 bash 时一切就绪),自动补不会引入额外风险,
 * 只省去用户手动改的麻烦。
 */
function autoFillCliFromCapabilities(method: Record<string, unknown>): void {
  const caps = Array.isArray(method.capabilities) ? (method.capabilities as unknown[]) : []
  const text = caps.filter((c): c is string => typeof c === 'string').join(' ')
  if (!text) return

  const declared = Array.isArray(method.cli) ? (method.cli as Array<Record<string, unknown>>) : []
  const declaredNames = new Set(
    declared.map((c) => (typeof c.command === 'string' ? c.command : '')).filter(Boolean),
  )

  const mentioned = new Set<string>()
  CLI_TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CLI_TOKEN_RE.exec(text)) !== null) {
    if (!declaredNames.has(m[1])) mentioned.add(m[1])
  }

  if (mentioned.size === 0) return

  const additions = Array.from(mentioned).map((command) => ({
    command,
    required: false,
  }))
  method.cli = [...declared, ...additions]
}

/**
 * v8.1: 净化 method.tools — LLM 经常把元工具 (skill/search_tool/delegate_agent) 误写
 * 在这里。元工具按其它字段派生,不能列在 method.tools。剥离后根据剥离了哪些反向
 * 回填派生字段,保证用户意图不丢失。
 */
function sanitizeMethodTools(method: Record<string, unknown>): void {
  if (!Array.isArray(method.tools)) return
  const tools = method.tools as Array<Record<string, unknown>>
  const stripped = new Set<string>()
  method.tools = tools.filter((t) => {
    const n = typeof t.name === 'string' ? t.name : ''
    if (META_TOOL_NAMES.has(n)) {
      stripped.add(n)
      return false
    }
    return BUILTIN_TOOL_NAMES.has(n)
  })

  // 反向回填: LLM 写了 search_tool → 用户期望用 MCP → 若 method.mcpServers 缺失,
  // 不强加;只在元工具 'skill' 被剥离时检查 method.skills 存在 (skill 派生条件)
  if (stripped.has('skill')) {
    if (!Array.isArray(method.skills)) {
      // 用户期望用 skill 但没声明任何 skill → log only,UI 已有 detectDependencyMismatch
      // 这里不强制造一个 fake skill; 留给用户/Crystallizer 后续补充
    }
  }
  // search_tool 被剥离不需要补 method.mcpServers — 业务 agent 默认继承平台 MCP,
  // search_tool 自动派生条件含 platformHasMcp。
}

/**
 * 修复 LLM 生成 workflow 时常见的 3 类语义错误:
 *  ① step.tools (legacy) 已被删除
 *  ② step.inputs 引用 mission.inputs.id 或不存在的上游 → 改为 'user-input' 或删除
 *  ③ step.produces 不在 deliverables 也不被下游消费 → 末步改为 deliverable.id, 中间步删除
 *  ④ step.use.tools 引用未声明的内置工具 → 自动补到 method.tools (元工具不补,由 sanitize 已剥离)
 */
function fixWorkflowSemantics(
  method: Record<string, unknown>,
  mission: Record<string, unknown> | undefined,
  deliverables: Array<Record<string, unknown>>,
): void {
  const wf = method.workflow as { steps?: unknown[] } | undefined
  if (!wf || !Array.isArray(wf.steps) || wf.steps.length === 0) return

  const steps = wf.steps as Array<Record<string, unknown>>

  // (1) 静默删 step.tools (legacy)
  for (const s of steps) {
    if ('tools' in s) delete s.tools
  }

  // (2) 修 step.inputs
  const missionInputIds = new Set(
    Array.isArray(mission?.inputs)
      ? (mission!.inputs as Array<Record<string, unknown>>)
          .map((i) => (typeof i.id === 'string' ? i.id : ''))
          .filter(Boolean)
      : [],
  )
  // 第一遍收集所有现存 produces (用于判断 inputs 是否引用合法上游)
  const allProduces = new Set<string>()
  for (const s of steps) {
    if (typeof s.produces === 'string' && s.produces.trim() !== '') {
      allProduces.add(s.produces)
    }
  }
  for (const s of steps) {
    if (!Array.isArray(s.inputs)) continue
    s.inputs = (s.inputs as unknown[])
      .map((inp) => {
        if (typeof inp !== 'string') return null
        if (inp === 'user-input') return inp
        // 如果是 mission.inputs 字段名 → 转换为 'user-input' 哨兵
        if (missionInputIds.has(inp)) return 'user-input'
        // 如果是合法的上游 produces → 保留
        if (allProduces.has(inp)) return inp
        // 其它情况 → 假设是 user-input (或干脆删除)
        return 'user-input'
      })
      .filter((x): x is string => x !== null)
    // 去重
    s.inputs = Array.from(new Set(s.inputs as string[]))
  }

  // (3) 修 step.produces
  // 收集下游消费的输出名 (排除 'user-input' 哨兵)
  const consumedSet = new Set<string>()
  for (const s of steps) {
    if (Array.isArray(s.inputs)) {
      for (const inp of s.inputs as unknown[]) {
        if (typeof inp === 'string' && inp !== 'user-input') {
          consumedSet.add(inp)
        }
      }
    }
  }
  const deliverableIds = new Set(
    deliverables.map((d) => (typeof d.id === 'string' ? d.id : '')).filter(Boolean),
  )
  const fallbackDeliverableId = [...deliverableIds][0] ?? 'main_output'
  steps.forEach((s, idx) => {
    if (typeof s.produces !== 'string' || s.produces.trim() === '') return
    const isOrphan = !deliverableIds.has(s.produces) && !consumedSet.has(s.produces)
    if (!isOrphan) return
    const isLastStep = idx === steps.length - 1
    if (isLastStep) {
      // 末步: 收口到第一个 deliverable
      s.produces = fallbackDeliverableId
    } else {
      // 中间步: 删除 produces (LLM 写错了产物语义)
      delete s.produces
    }
  })

  // (4) 修 step.use.tools 自动补 method.tools (仅内置工具,元工具静默剥离)
  const declaredTools = Array.isArray(method.tools)
    ? (method.tools as Array<Record<string, unknown>>)
    : []
  const declaredToolNames = new Set(
    declaredTools.map((t) => (typeof t.name === 'string' ? t.name : '')).filter(Boolean),
  )
  const toolsToAdd = new Set<string>()
  for (const s of steps) {
    const useObj = s.use as Record<string, unknown> | undefined
    if (!useObj || !Array.isArray(useObj.tools)) continue
    // step.use.tools 里的元工具也要剥离: 不真补到 method.tools
    useObj.tools = (useObj.tools as unknown[]).filter((tn) => {
      if (typeof tn !== 'string') return false
      if (META_TOOL_NAMES.has(tn)) return false
      return true
    })
    for (const tn of useObj.tools as string[]) {
      if (declaredToolNames.has(tn)) continue
      if (BUILTIN_TOOL_NAMES.has(tn)) {
        toolsToAdd.add(tn)
      }
    }
  }
  if (toolsToAdd.size > 0) {
    method.tools = [
      ...declaredTools,
      ...Array.from(toolsToAdd).map((name) => ({ name, required: false })),
    ]
  }
}

const TOOL_BEARING_TYPES = new Set([
  'tool-was-used',
  'tool-not-used',
  'tool-not-failed',
  'verifier-tool',
])

function coerceCriterion(c: Record<string, unknown>, fallbackDeliverableId: string): void {
  const rawType = c.type
  const hasToolName = typeof c.toolName === 'string' && c.toolName.trim() !== ''
  const hasDeliverableId = typeof c.deliverableId === 'string' && c.deliverableId.trim() !== ''

  // 1) type 不在合法集 → 看其它字段反推: 有 toolName 用 tool-was-used, 否则 deliverable-present
  if (typeof rawType !== 'string' || !VERIFY_TYPE_VALID.has(rawType)) {
    c.type = hasToolName ? 'tool-was-used' : 'deliverable-present'
  }

  // 2) kind / severity 兜底
  c.kind = pickFromMap(c.kind, KIND_MAP, 'deterministic')
  c.severity = pickFromMap(c.severity, SEVERITY_MAP, 'must')

  // 3) 按最终 type 补缺/修正必填字段
  const finalType = c.type as string
  if (finalType === 'deliverable-present') {
    if (!hasDeliverableId) c.deliverableId = fallbackDeliverableId
    delete c.toolName
  } else if (TOOL_BEARING_TYPES.has(finalType)) {
    if (!hasToolName) c.toolName = 'read'
    delete c.deliverableId
  } else if (finalType === 'output-matches') {
    // schema 或 pattern 至少有一个;两个都没 → 加一个兜底 pattern
    if (c.schema === undefined && typeof c.pattern !== 'string') {
      c.pattern = '.+'
    }
  } else if (finalType === 'llm-judge') {
    if (typeof c.judgePrompt !== 'string' || c.judgePrompt.trim() === '') {
      c.judgePrompt = "Does the output meet the user's requirements?"
    }
  } else if (finalType === 'human-approval') {
    if (typeof c.approverRef !== 'string' || c.approverRef.trim() === '') {
      c.approverRef = 'user'
    }
  }
}

/**
 * 把用户编辑的字段合并回 schema 1.0 顶层 profile。
 * 保留 LLM 给的其它字段(method.knowledge / mission.outcomes / mission.scope / execution 等),
 * 仅 override 用户编辑的:identity.{id,name,description,version} + delivery.deliverables[0].format。
 */
function mergeIntoSchemaV1(
  initial: Record<string, unknown>,
  edits: EditableFields,
  capabilities: string[],
): Record<string, unknown> {
  // LLM 偶尔会把 enum 字段写成中文或自创值（即使 SCHEMA_KNOWLEDGE_TEXT 里已列了合法值）。
  // 在这里做防御性矫正,让保存路径对模型质量不敏感。
  initial = coerceEnumDefaults(initial)

  const initialIdentity = (initial.identity as Record<string, unknown> | undefined) ?? {}
  const initialMission = initial.mission as Record<string, unknown> | undefined
  const initialMethod = (initial.method as Record<string, unknown> | undefined) ?? {}
  const initialDelivery = initial.delivery as Record<string, unknown> | undefined
  const initialExecution = initial.execution as Record<string, unknown> | undefined

  // identity: 用户编辑值覆盖
  const identity = {
    ...initialIdentity,
    id: edits.id,
    name: edits.name,
    description: edits.description,
    version: edits.version,
  }

  // method: capabilities 用提取后的(已含用户期望的能力列表)
  const method = {
    ...initialMethod,
    capabilities,
  }

  // delivery: 第一个 deliverable.format 用用户选择
  const initialDeliverables = Array.isArray(
    (initialDelivery as { deliverables?: unknown } | undefined)?.deliverables,
  )
    ? ((initialDelivery as { deliverables: unknown[] }).deliverables as Record<string, unknown>[])
    : []

  // v8: delivery 只剩 deliverables,无 acceptance (acceptance 统一在 mission.outcomes.verifyBy)
  const initialDeliveryRest = (initialDelivery as Record<string, unknown> | undefined) ?? {}
  // 静默丢弃 LLM 残留的 acceptance/triggers/successMetrics 字段(已不合法)
  delete (initialDeliveryRest as Record<string, unknown>).acceptance
  const delivery: Record<string, unknown> = {
    ...initialDeliveryRest,
    deliverables:
      initialDeliverables.length > 0
        ? [
            { ...initialDeliverables[0], format: edits.outputFormat },
            ...initialDeliverables.slice(1),
          ]
        : [
            // 草稿没给 deliverables → 兜底一个最小结构,validator 会接受 (markdown + mustContain)
            {
              id: 'main_output',
              format: edits.outputFormat,
              mustContain: ['.+'],
            },
          ],
  }

  // execution: 兜底默认值(若 LLM 没给)
  const execution = initialExecution ?? {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: {
      maxAttempts: 2,
      onMustFail: 'retry-then-mark',
      onShouldFail: 'mark-only',
    },
  }

  // mission: 兜底(若 LLM 没给):用 description 派生一个最小 outcome,引用 deliverable
  const deliverableId = initialDeliverables[0]?.id ?? 'main_output'
  // 已被 coerceEnumDefaults 静默删除残留的 triggers/successMetrics
  const mission = initialMission ?? {
    objective: edits.description || edits.name,
    outcomes: [
      {
        id: 'main_outcome',
        description: '产出符合预期格式的交付物',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId,
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  }

  return {
    ...initial,
    schemaVersion: '1.0',
    identity,
    mission,
    method,
    delivery,
    execution,
  }
}

/**
 * 生成 UUID-based agent id。形如 `agent-<uuid>` — UUID v4 碰撞概率约等于 0。
 * 用作用户没给合法 id 时的兜底。
 */
function generateAgentId(): string {
  return `agent-${crypto.randomUUID()}`
}

interface DepWarning {
  kind: 'skill' | 'cli' | 'mcp'
  field: string
  items: string[]
}

/**
 * 检测 capabilities 提到 4 类依赖但对应字段未声明的不一致情况。
 * 是 LLM 抽 profile 常见漏写,运行时装配阶段不加载 → LLM 卡死。
 */
function detectDependencyMismatch(profile: Record<string, unknown>): DepWarning[] {
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const capabilities = Array.isArray(method.capabilities)
    ? (method.capabilities as unknown[]).filter((c): c is string => typeof c === 'string').join(' ')
    : ''
  const warnings: DepWarning[] = []

  // ── skill 检查 (Schema 1.0: SkillItem 是 flat { name, required, purpose? }) ──
  const declaredSkills = new Set<string>()
  if (Array.isArray(method.skills)) {
    for (const item of method.skills as Array<{ name?: string }>) {
      if (typeof item.name === 'string') declaredSkills.add(item.name)
    }
  }
  const SKILL_PATTERN =
    /\b(lark-[a-z]+|yummy|klook-[a-z-]+|java-ut-[a-z-]+|go-ut-[a-z-]+|web-ut-[a-z-]+|flutter-ut-[a-z-]+|ut-[a-z-]+|update-config|simplify|loop|schedule|claude-api|init|review|security-review|frontend-design|fewer-permission-prompts|keybindings-help|statusline-setup)\b/g
  // 豁免:这些是 CLI 包名 / 误命中模式,不是 skill 名
  const SKILL_FALSE_POSITIVES = new Set(['lark-cli', 'lark-base'])
  const mentionedSkills = new Set<string>()
  let m: RegExpExecArray | null
  SKILL_PATTERN.lastIndex = 0
  while ((m = SKILL_PATTERN.exec(capabilities)) !== null) {
    if (!SKILL_FALSE_POSITIVES.has(m[1])) mentionedSkills.add(m[1])
  }
  const missingSkills = [...mentionedSkills].filter((s) => !declaredSkills.has(s))
  if (missingSkills.length > 0) {
    warnings.push({ kind: 'skill', field: 'method.skills', items: missingSkills })
  }

  // ── cli 检查 ──
  const declaredCli = new Set<string>()
  if (Array.isArray(method.cli)) {
    for (const c of method.cli as Array<{ command?: string }>) {
      if (typeof c.command === 'string') declaredCli.add(c.command)
    }
  }
  const CLI_PATTERN =
    /\b(git|npm|yarn|pnpm|docker|kubectl|gh|curl|wget|go|cargo|python3?|pip3?|node|bun|deno|aws|gcloud|terraform|ansible|make|sed|awk|jq|ffmpeg|psql|mysql|redis-cli)\b/g
  const mentionedCli = new Set<string>()
  CLI_PATTERN.lastIndex = 0
  while ((m = CLI_PATTERN.exec(capabilities)) !== null) mentionedCli.add(m[1])
  const missingCli = [...mentionedCli].filter((c) => !declaredCli.has(c))
  if (missingCli.length > 0) {
    warnings.push({ kind: 'cli', field: 'method.cli', items: missingCli })
  }

  // ── mcp 检查 ──
  const declaredMcp = new Set<string>()
  if (Array.isArray(method.mcpServers)) {
    for (const s of method.mcpServers as Array<{ name?: string }>) {
      if (typeof s.name === 'string') declaredMcp.add(s.name.toLowerCase())
    }
  }
  // 关键词命中 → 提示可能需要 MCP server (无法自动判定具体 server name,所以是模糊提示)
  const MCP_HINTS: Array<{ pattern: RegExp; hint: string }> = [
    { pattern: /github\b|GitHub/i, hint: 'github' },
    { pattern: /slack\b/i, hint: 'slack' },
    { pattern: /linear\b/i, hint: 'linear' },
    { pattern: /notion\b/i, hint: 'notion' },
    { pattern: /jira\b/i, hint: 'jira' },
    { pattern: /sentry\b/i, hint: 'sentry' },
    { pattern: /postgres|mysql|mongodb/i, hint: 'database' },
    { pattern: /(REST|HTTP)\s+API|http\s+endpoint|http 接口/i, hint: 'http-api' },
  ]
  const mentionedMcp: string[] = []
  for (const { pattern, hint } of MCP_HINTS) {
    if (pattern.test(capabilities) && !declaredMcp.has(hint)) {
      mentionedMcp.push(hint)
    }
  }
  if (mentionedMcp.length > 0) {
    warnings.push({ kind: 'mcp', field: 'method.mcpServers', items: mentionedMcp })
  }

  return warnings
}

// ─── v7 自然语言提取 ─────────────────────────────────────

/**
 * 顶部 NL 摘要：用户读这一段就能判断 agent 是不是预期的样子。
 * 不需要懂 schema 字段名。
 */
function buildNaturalSummary(profile: Record<string, unknown>): string[] {
  const mission = (profile.mission as Record<string, unknown> | undefined) ?? {}
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const delivery = (profile.delivery as Record<string, unknown> | undefined) ?? {}

  const lines: string[] = []

  const objective = typeof mission.objective === 'string' ? mission.objective.trim() : ''
  if (objective) lines.push(`核心任务：${objective}`)

  const scopeRaw = mission.scope as { in?: unknown[]; out?: unknown[] } | undefined
  const scopeIn = Array.isArray(scopeRaw?.in) ? scopeRaw!.in.length : 0
  const scopeOut = Array.isArray(scopeRaw?.out) ? scopeRaw!.out.length : 0
  if (scopeIn + scopeOut > 0) {
    lines.push(`边界：会做 ${scopeIn} 条 / 不会做 ${scopeOut} 条`)
  }

  const wf = method.workflow as { kind?: string; steps?: unknown[] } | undefined
  if (wf && Array.isArray(wf.steps) && wf.steps.length > 0) {
    const kindLabel =
      wf.kind === 'dag'
        ? '部分步骤可并行'
        : wf.kind === 'reactive'
          ? '按用户当下需求灵活反应'
          : '按顺序执行'
    lines.push(`流程：${wf.steps.length} 步（${kindLabel}）`)
  }

  const tools = Array.isArray(method.tools) ? method.tools.length : 0
  const skills = Array.isArray(method.skills) ? method.skills.length : 0
  const mcps = Array.isArray(method.mcpServers) ? method.mcpServers.length : 0
  const cli = Array.isArray(method.cli) ? method.cli.length : 0
  const totalDeps = tools + skills + mcps + cli
  if (totalDeps > 0) {
    const parts: string[] = []
    if (tools > 0) parts.push(`${tools} 个工具`)
    if (skills > 0) parts.push(`${skills} 个 skill`)
    if (mcps > 0) parts.push(`${mcps} 个外部服务`)
    if (cli > 0) parts.push(`${cli} 个命令`)
    lines.push(`依赖：${parts.join(' · ')}`)
  }

  const inputs = Array.isArray(mission.inputs) ? mission.inputs.length : 0
  if (inputs > 0) lines.push(`输入字段：${inputs} 个`)

  const deliverables = Array.isArray(delivery.deliverables)
    ? (delivery.deliverables as Array<{ rubric?: unknown[] }>)
    : []
  const rubricCount = deliverables.reduce(
    (n, d) => n + (Array.isArray(d.rubric) ? d.rubric.length : 0),
    0,
  )
  if (rubricCount > 0) lines.push(`自检规则：${rubricCount} 条`)

  return lines.length > 0 ? lines : ['（草稿信息不足，请展开下方技术细节确认）']
}

interface ScopeView {
  in: string[]
  out: string[]
}

function extractScope(profile: Record<string, unknown>): ScopeView {
  const mission = (profile.mission as Record<string, unknown> | undefined) ?? {}
  const sc = mission.scope as { in?: unknown; out?: unknown } | undefined
  const inArr = Array.isArray(sc?.in)
    ? (sc!.in as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : []
  const outArr = Array.isArray(sc?.out)
    ? (sc!.out as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : []
  return { in: inArr, out: outArr }
}

interface MissionInputView {
  id: string
  type: string
  required: boolean
  description: string
}

function extractMissionInputs(profile: Record<string, unknown>): MissionInputView[] {
  const mission = (profile.mission as Record<string, unknown> | undefined) ?? {}
  const inputs = Array.isArray(mission.inputs) ? mission.inputs : []
  return inputs
    .map((raw): MissionInputView | null => {
      if (!raw || typeof raw !== 'object') return null
      const inp = raw as Record<string, unknown>
      const id = typeof inp.id === 'string' ? inp.id : ''
      if (!id) return null
      return {
        id,
        type: typeof inp.type === 'string' ? inp.type : 'text',
        required: inp.required === true,
        description: typeof inp.description === 'string' ? inp.description : '',
      }
    })
    .filter((x): x is MissionInputView => x !== null)
}

interface WorkflowStepView {
  id: string
  description: string
  kindLabel: string | null
  uses: string | null
}

function extractWorkflowSteps(profile: Record<string, unknown>): WorkflowStepView[] {
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const wf = method.workflow as { steps?: unknown[] } | undefined
  if (!wf || !Array.isArray(wf.steps)) return []

  return wf.steps
    .map((raw): WorkflowStepView | null => {
      if (!raw || typeof raw !== 'object') return null
      const s = raw as Record<string, unknown>
      const id = typeof s.id === 'string' ? s.id : ''
      if (!id) return null
      const description = typeof s.description === 'string' ? s.description : ''

      const kind = typeof s.kind === 'string' ? s.kind : 'task'
      const kindLabel =
        kind === 'wait_for_user_approval'
          ? '在这一步等用户确认'
          : kind === 'branch'
            ? '条件分支'
            : kind === 'loop'
              ? '循环'
              : null

      // v8: step.use.{tools,skills,mcpServers,cli} 是唯一依赖来源
      const useObj = (s.use as Record<string, unknown> | undefined) ?? {}
      const useParts: string[] = []
      const tools = Array.isArray(useObj.tools) ? (useObj.tools as unknown[]) : []
      const skills = Array.isArray(useObj.skills) ? (useObj.skills as unknown[]) : []
      const mcps = Array.isArray(useObj.mcpServers) ? (useObj.mcpServers as unknown[]) : []
      const cli = Array.isArray(useObj.cli) ? (useObj.cli as unknown[]) : []
      if (tools.length > 0) useParts.push(`工具 ${tools.join('/')}`)
      if (skills.length > 0) useParts.push(`skill ${skills.join('/')}`)
      if (mcps.length > 0) useParts.push(`MCP ${mcps.join('/')}`)
      if (cli.length > 0) useParts.push(`CLI ${cli.join('/')}`)
      const uses = useParts.length > 0 ? useParts.join(' · ') : null

      return { id, description, kindLabel, uses }
    })
    .filter((x): x is WorkflowStepView => x !== null)
}

interface DeclaredDeps {
  tools: string[]
  skills: string[]
  mcps: string[]
  cli: string[]
}

function extractDeclaredDeps(profile: Record<string, unknown>): DeclaredDeps {
  const method = (profile.method as Record<string, unknown> | undefined) ?? {}
  const tools = Array.isArray(method.tools)
    ? (method.tools as Array<{ name?: string }>)
        .map((t) => (typeof t.name === 'string' ? t.name : ''))
        .filter(Boolean)
    : []
  const skills = Array.isArray(method.skills)
    ? (method.skills as Array<{ name?: string }>)
        .map((s) => (typeof s.name === 'string' ? s.name : ''))
        .filter(Boolean)
    : []
  const mcps = Array.isArray(method.mcpServers)
    ? (method.mcpServers as Array<{ name?: string }>)
        .map((m) => (typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean)
    : []
  const cli = Array.isArray(method.cli)
    ? (method.cli as Array<{ command?: string }>)
        .map((c) => (typeof c.command === 'string' ? c.command : ''))
        .filter(Boolean)
    : []
  return { tools, skills, mcps, cli }
}

function extractDeliverableRubric(profile: Record<string, unknown>): string[] {
  const delivery = (profile.delivery as Record<string, unknown> | undefined) ?? {}
  const deliverables = Array.isArray(delivery.deliverables)
    ? (delivery.deliverables as Array<{ rubric?: unknown[] }>)
    : []
  const all: string[] = []
  for (const d of deliverables) {
    if (Array.isArray(d.rubric)) {
      for (const r of d.rubric) {
        if (typeof r === 'string' && r.trim() !== '') all.push(r)
      }
    }
  }
  return all
}
