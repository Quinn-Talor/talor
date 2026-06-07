// DraftReviewModal — review/edit a crystallizer-produced agent draft and save.
//
// Schema 2.0 layout:
//   ① 顶部 NL 摘要 (id/name/description/agentPrompt/deps) — 用户能直接读懂
//   ② 中部可编辑字段 (id / name / description / version) — 必要的微调
//   ③ agentPrompt 预览 + dependency lists — 自然语言展示
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

  // v2.0: 摘要行、依赖列表
  const summary = useMemo(() => buildNaturalSummary(initialProfile), [initialProfile])
  const declaredDeps = useMemo(() => extractDeclaredDeps(initialProfile), [initialProfile])
  const agentPromptPreview = useMemo(
    () => extractAgentPromptPreview(initialProfile),
    [initialProfile],
  )

  const canSave = !nameError && !versionError && !idError && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      const merged = mergeIntoSchemaV2(initialProfile, fields)
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
            `修复方式: 把 SKILL.md 放到 ~/.talor/skills/<name>/, 然后到 agent 详情页点"安装依赖"。\n\n` +
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
            审阅 Agent 草稿 (Schema 2.0)
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

          {agentPromptPreview && (
            <Field label="Agent Prompt 预览">
              <div
                className="rounded-md border px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto"
                style={{ borderColor: '#e2e8f0', background: '#f8fafc', color: '#334155' }}
                data-testid="draft-agent-prompt-preview"
              >
                {agentPromptPreview}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
                如需修改 agentPrompt,请回工作台让 Crystallizer 重新生成。
              </div>
            </Field>
          )}

          {declaredDeps.tools.length +
            declaredDeps.skills.length +
            declaredDeps.mcps.length +
            declaredDeps.cli.length >
            0 && (
            <Field label="依赖 manifest">
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

// ─── Schema 2.0 字段提取 ─────────────────────────────────────

function extractFields(profile: Record<string, unknown>): EditableFields {
  return {
    id: typeof profile.id === 'string' ? profile.id : '',
    name: typeof profile.name === 'string' ? profile.name : '',
    description: typeof profile.description === 'string' ? profile.description : '',
    version: typeof profile.version === 'string' ? profile.version : '1.0.0',
  }
}

/**
 * 把用户编辑的字段合并回 schema 2.0 顶层 profile。
 * v2.0 是扁平结构:LLM 产出的字段直接透传,用户编辑的 id/name/description/version 覆盖。
 */
function mergeIntoSchemaV2(
  initial: Record<string, unknown>,
  edits: EditableFields,
): Record<string, unknown> {
  return {
    ...initial,
    schemaVersion: '2.0',
    id: edits.id,
    name: edits.name,
    description: edits.description,
    version: edits.version,
  }
}

/**
 * 生成 UUID-based agent id。形如 `agent-<uuid>` — UUID v4 碰撞概率约等于 0。
 * 用作用户没给合法 id 时的兜底。
 */
function generateAgentId(): string {
  return `agent-${crypto.randomUUID()}`
}

// ─── v2.0 自然语言提取 ─────────────────────────────────────

/**
 * 顶部 NL 摘要：用户读这一段就能判断 agent 是不是预期的样子。
 * v2.0 扁平结构:直接读顶层字段。
 */
function buildNaturalSummary(profile: Record<string, unknown>): string[] {
  const lines: string[] = []

  const name = typeof profile.name === 'string' ? profile.name.trim() : ''
  if (name) lines.push(`名称：${name}`)

  const desc = typeof profile.description === 'string' ? profile.description.trim() : ''
  if (desc) {
    // 取第一段 (第一个换行前) 作摘要行
    const firstPara = desc.split('\n')[0].trim()
    if (firstPara) lines.push(`描述：${firstPara}`)
  }

  const tools = Array.isArray(profile.tools) ? profile.tools.length : 0
  const skills = Array.isArray(profile.skills) ? profile.skills.length : 0
  const mcps = Array.isArray(profile.mcpServers) ? profile.mcpServers.length : 0
  const cli = Array.isArray(profile.cli) ? profile.cli.length : 0
  const totalDeps = tools + skills + mcps + cli
  if (totalDeps > 0) {
    const parts: string[] = []
    if (tools > 0) parts.push(`${tools} 个工具`)
    if (skills > 0) parts.push(`${skills} 个 skill`)
    if (mcps > 0) parts.push(`${mcps} 个外部服务`)
    if (cli > 0) parts.push(`${cli} 个命令`)
    lines.push(`依赖：${parts.join(' · ')}`)
  }

  const refs = Array.isArray(profile.references) ? profile.references.length : 0
  if (refs > 0) lines.push(`参考资料：${refs} 份`)

  return lines.length > 0 ? lines : ['（草稿信息不足，请展开下方技术细节确认）']
}

interface DeclaredDeps {
  tools: string[]
  skills: string[]
  mcps: string[]
  cli: string[]
}

function extractDeclaredDeps(profile: Record<string, unknown>): DeclaredDeps {
  // v2.0 flat structure: profile.tools / profile.skills / profile.mcpServers / profile.cli
  const tools = Array.isArray(profile.tools)
    ? (profile.tools as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const skills = Array.isArray(profile.skills)
    ? (profile.skills as Array<{ name?: string }>)
        .map((s) => (typeof s.name === 'string' ? s.name : ''))
        .filter(Boolean)
    : []
  const mcps = Array.isArray(profile.mcpServers)
    ? (profile.mcpServers as Array<{ name?: string }>)
        .map((m) => (typeof m.name === 'string' ? m.name : ''))
        .filter(Boolean)
    : []
  const cli = Array.isArray(profile.cli)
    ? (profile.cli as Array<{ command?: string }>)
        .map((c) => (typeof c.command === 'string' ? c.command : ''))
        .filter(Boolean)
    : []
  return { tools, skills, mcps, cli }
}

/**
 * 返回 agentPrompt 的前 500 字供预览；若没有则返回 null。
 */
function extractAgentPromptPreview(profile: Record<string, unknown>): string | null {
  const prompt = typeof profile.agentPrompt === 'string' ? profile.agentPrompt.trim() : ''
  if (!prompt) return null
  return prompt.length > 500 ? prompt.slice(0, 497) + '…' : prompt
}
