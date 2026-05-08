// DraftReviewModal — review/edit a crystallizer-produced agent draft and save.
// Spec §B.9.5.

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

  // Reset + auto-assign UUID id when modal opens.
  // 产品决策：ID 完全平台兜底（agent-<uuid>），用户不感知不编辑，去除命名摩擦
  // 也不需要冲突检测 —— UUID v4 碰撞概率约等于 0。
  useEffect(() => {
    if (!open) return
    setFields({ ...extractFields(initialProfile), id: generateAgentId() })
    setSaveError(null)
    setShowJson(false)
  }, [open, initialProfile])

  // Esc to close (spec §B.9.5).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // id 由 generateAgentId() 平台分配（UUID v4 + 'agent-' 前缀），格式永远合法 —
  // 不需要前端校验。后端 validator 仍做兜底。
  const nameError = fields.name.trim() === '' ? '名称不能为空' : null
  const versionError = VERSION_FORMAT.test(fields.version) ? null : '版本号必须形如 1.0.0'

  // capabilities 自动从草稿提取（只读展示）。草稿没声明时由 description 派生。
  const capabilities = useMemo(() => autoExtractCapabilities(initialProfile), [initialProfile])

  const canSave = !nameError && !versionError && !saving

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      // dependencies：草稿可能缺字段，按 validator 要求保底成空数组
      const draftDeps = (initialProfile.dependencies ?? {}) as Record<string, unknown>
      const dependencies = {
        tools: Array.isArray(draftDeps.tools) ? draftDeps.tools : [],
        mcpServers: Array.isArray(draftDeps.mcpServers) ? draftDeps.mcpServers : [],
        skills: Array.isArray(draftDeps.skills) ? draftDeps.skills : [],
        cli: Array.isArray(draftDeps.cli) ? draftDeps.cli : [],
        ...(Array.isArray(draftDeps.subagents) ? { subagents: draftDeps.subagents } : {}),
        ...(typeof draftDeps.allowAnyBusinessSubagent === 'boolean'
          ? { allowAnyBusinessSubagent: draftDeps.allowAnyBusinessSubagent }
          : {}),
      }

      const merged: Record<string, unknown> = {
        ...initialProfile,
        id: fields.id,
        name: fields.name,
        description: fields.description,
        version: fields.version,
        role: {
          ...(initialProfile.role as Record<string, unknown> | undefined),
          capabilities,
          outputFormat: fields.outputFormat,
        },
        dependencies,
        // knowledge 必填（loader 期望对象 + files 数组）
        knowledge: (initialProfile.knowledge as Record<string, unknown>) ?? { files: [] },
      }
      const result = await talorAPI.agents.createFromDraft(merged, workbenchSessionId)
      if (!result.success || !result.id) {
        setSaveError(result.error ?? 'unknown error')
        return
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

  const subagents =
    ((initialProfile.dependencies as { subagents?: unknown })?.subagents as
      | Array<{ id?: string; required?: boolean }>
      | undefined) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      data-testid="draft-review-modal"
    >
      <div
        className="bg-white rounded-xl shadow-xl w-[600px] max-w-[92vw] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center px-5 py-3 border-b" style={{ borderColor: '#e2e8f0' }}>
          <span className="text-base mr-2">📦</span>
          <span className="text-[14px] font-semibold flex-1" style={{ color: '#1e293b' }}>
            审阅 Agent 草稿
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

          <Field label="Agent ID（系统分配 UUID）">
            <input
              type="text"
              value={fields.id}
              readOnly
              tabIndex={-1}
              className="w-full rounded-md border px-3 py-1.5 text-[13px] font-mono cursor-not-allowed select-all"
              style={{
                borderColor: '#e2e8f0',
                background: '#f8fafc',
                color: '#475569',
              }}
              data-testid="draft-id-input"
            />
            <div className="mt-1 text-[11px]" style={{ color: '#94a3b8' }}>
              平台自动生成（UUID 唯一），用户不可修改。
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

          <Field label="能力（自动提取，不可修改）">
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
              从草稿 capabilities 自动提取；草稿未声明时由描述派生。如需调整，请回到工作台让
              Crystallizer 重新生成。
            </div>
          </Field>

          <Field label="输出格式">
            <input
              type="text"
              value={fields.outputFormat}
              onChange={(e) => setFields((f) => ({ ...f, outputFormat: e.target.value }))}
              className="w-full rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: '#cbd5e1' }}
            />
          </Field>

          {subagents.length > 0 && (
            <Field label="Subagent 依赖">
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
              className="text-[12px] hover:underline"
              style={{ color: '#7c3aed' }}
            >
              {showJson ? '▲ 折起' : '▼ 展开'} 完整 JSON
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

function extractFields(profile: Record<string, unknown>): EditableFields {
  const role = (profile.role as Record<string, unknown> | undefined) ?? {}
  return {
    id: typeof profile.id === 'string' ? profile.id : '',
    name: typeof profile.name === 'string' ? profile.name : '',
    description: typeof profile.description === 'string' ? profile.description : '',
    version: typeof profile.version === 'string' ? profile.version : '1.0.0',
    // 草稿没给 outputFormat 时默认 Markdown（最常用，也满足 validator 非空校验）
    outputFormat:
      typeof role.outputFormat === 'string' && role.outputFormat.trim() !== ''
        ? role.outputFormat
        : 'Markdown',
  }
}

/**
 * 从草稿自动提取 capabilities（用户不可编辑）。
 *
 * 优先级：
 *   1. 草稿 role.capabilities 是非空字符串数组 → 直接用
 *   2. 草稿没给 → fallback：把 description 切句作为能力列表
 *      - 中英文句号 / 分号 / 换行 切分；逐条 trim；过滤空
 *      - 至少保证返回 1 条（保底用整个 description；再不济用 '通用助手能力'）
 */
function autoExtractCapabilities(profile: Record<string, unknown>): string[] {
  const role = (profile.role as Record<string, unknown> | undefined) ?? {}
  const declared = Array.isArray(role.capabilities)
    ? (role.capabilities as unknown[]).filter(
        (c): c is string => typeof c === 'string' && c.trim() !== '',
      )
    : []
  if (declared.length > 0) return declared

  const desc = typeof profile.description === 'string' ? profile.description : ''
  const trimmed = desc.trim()
  if (trimmed === '') return ['通用助手能力']

  // 切句：。｜.｜；｜;｜\n
  const parts = trimmed
    .split(/[。.；;\n]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (parts.length === 0) return [trimmed]
  return parts
}

/**
 * 生成 UUID-based agent id。
 *
 * 形如 `agent-<uuid>` —— UUID v4 碰撞概率约等于 0，无需冲突检测。
 * 前缀 `agent-` 用于：
 *   1. 满足后端 ID_FORMAT 要求（首字符必须字母）
 *   2. 让 id 在文件系统 / 列表里有可识别语义
 *
 * crypto.randomUUID() 在 Electron renderer (modern Chromium) 内置可用，
 * 无需额外依赖。
 */
function generateAgentId(): string {
  return `agent-${crypto.randomUUID()}`
}
