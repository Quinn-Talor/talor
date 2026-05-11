// src/renderer/pages/Agents/AgentEditPage.tsx — Schema 2.0 Agent 编辑/预览/试跑页面
//
// P1 简化版:JSON 编辑器(支持模板载入 + 实时 validate)+ Preview 侧栏 + DryRun 弹窗。
// 未来可拆 form 化（agentPrompt / tools / subagents / references 等字段）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { talorAPI } from '../../api/talorAPI'

type ValidatorIssue = {
  severity: 'error' | 'warn'
  rule: number
  path: string
  message: string
}

type PreviewResult = {
  renderedPrompt: {
    persistent: string
    onDemandSamples: { firstIteration: string; midIteration: string; lastIteration: string }
  }
  enabledTools: Array<{ name: string; description: string; source: string }>
  estimates: {
    promptTokens: number
    toolsCount: number
    referencesCount: number
  }
  validatorIssues: ValidatorIssue[]
}

type AgentTemplate = { id: string; name: string; description: string; profile: unknown }

interface AgentEditPageProps {
  /** 编辑现有 agent: 传 id;创建新 agent: 不传 */
  agentId?: string
  onClose: () => void
}

const EMPTY_PROFILE_HINT = `{
  "schemaVersion": "2.0",
  "id": "my_agent",
  "name": "My Agent",
  "description": "...",
  "version": "1.0.0",
  "agentPrompt": "## Workflow\\n1. ...",
  "tools": ["read", "bash"]
}`

export function AgentEditPage({ agentId, onClose }: AgentEditPageProps) {
  const [json, setJson] = useState<string>('')
  const [parsed, setParsed] = useState<unknown>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [validatorIssues, setValidatorIssues] = useState<ValidatorIssue[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [templates, setTemplates] = useState<AgentTemplate[]>([])
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [showDryRun, setShowDryRun] = useState(false)

  // 加载现有 agent
  useEffect(() => {
    if (!agentId) {
      setJson(EMPTY_PROFILE_HINT)
      return
    }
    talorAPI.agents.get(agentId).then((entry) => {
      const profile = (entry as { profile?: unknown })?.profile ?? entry
      setJson(JSON.stringify(profile, null, 2))
    })
  }, [agentId])

  // 加载内置模板
  useEffect(() => {
    talorAPI.agents
      .listTemplates()
      .then((list) => setTemplates(list))
      .catch(() => setTemplates([]))
  }, [])

  // 解析 JSON + debounce validate
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const obj = JSON.parse(json)
        setParseError(null)
        setParsed(obj)
        try {
          const result = await talorAPI.agents.validate(obj)
          setValidatorIssues([...result.errors, ...result.warnings])
        } catch (err) {
          setValidatorIssues([
            { severity: 'error', rule: 0, path: '', message: `validate failed: ${String(err)}` },
          ])
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : String(e))
        setParsed(null)
        setValidatorIssues([])
      }
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [json])

  const errors = validatorIssues.filter((i) => i.severity === 'error')
  const warnings = validatorIssues.filter((i) => i.severity === 'warn')
  const canSave = parsed !== null && parseError === null && errors.length === 0
  const canPreview = parsed !== null && parseError === null

  const handlePreview = async () => {
    if (!parsed) return
    setPreviewLoading(true)
    try {
      const r = (await talorAPI.agents.preview(parsed)) as PreviewResult
      setPreview(r)
    } catch (err) {
      console.error(err)
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSave = async () => {
    if (!parsed || !canSave) return
    try {
      if (agentId) {
        await talorAPI.agents.update(agentId, parsed)
        setSavedMsg('已保存')
      } else {
        // 新建:沿用现有 create 路径(若 IPC 存在),fallback 到提示用户走 crystallize
        setSavedMsg('新建路径暂走 Crystallizer 抽取流程')
      }
      setTimeout(() => setSavedMsg(null), 2000)
    } catch (err) {
      setSavedMsg(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleLoadTemplate = (tplId: string) => {
    const tpl = templates.find((t) => t.id === tplId)
    if (!tpl) return
    setJson(JSON.stringify(tpl.profile, null, 2))
  }

  const summary = useMemo(() => {
    if (!preview) return null
    return {
      tools: preview.estimates.toolsCount,
      promptTokens: preview.estimates.promptTokens,
      referencesCount: preview.estimates.referencesCount,
    }
  }, [preview])

  return (
    <div className="fixed inset-0 z-50 flex bg-gray-900/95 text-gray-100">
      {/* 左:编辑器 */}
      <div className="flex-1 flex flex-col border-r border-gray-700">
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <div>
            <h2 className="text-lg font-semibold">
              {agentId ? `编辑 Agent: ${agentId}` : '新建 Agent (Schema 2.0)'}
            </h2>
            <p className="text-xs text-gray-400">JSON 编辑 + 实时校验 + 预览 + 试跑</p>
          </div>
          <div className="flex gap-2">
            <select
              className="bg-gray-700 text-sm rounded px-2 py-1"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) handleLoadTemplate(e.target.value)
              }}
            >
              <option value="">载入模板…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              disabled={!canPreview || previewLoading}
              onClick={handlePreview}
            >
              {previewLoading ? '渲染中…' : '预览'}
            </button>
            <button
              className="px-3 py-1 text-sm rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50"
              disabled={!canPreview}
              onClick={() => setShowDryRun(true)}
            >
              试跑
            </button>
            <button
              className="px-3 py-1 text-sm rounded bg-green-600 hover:bg-green-500 disabled:opacity-50"
              disabled={!canSave}
              onClick={handleSave}
            >
              保存
            </button>
            <button
              className="px-3 py-1 text-sm rounded bg-gray-600 hover:bg-gray-500"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </header>

        <div className="flex-1 flex min-h-0">
          <textarea
            className="flex-1 p-3 font-mono text-xs bg-gray-950 text-gray-100 outline-none resize-none"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
          />
        </div>

        <footer className="border-t border-gray-700 bg-gray-800 px-4 py-2 max-h-48 overflow-y-auto">
          {parseError && <div className="text-xs text-red-400">JSON 解析错误: {parseError}</div>}
          {!parseError && errors.length === 0 && warnings.length === 0 && (
            <div className="text-xs text-green-400">✓ 校验通过 (rules 1~14)</div>
          )}
          {errors.length > 0 && (
            <div className="text-xs">
              <div className="text-red-400 font-semibold">{errors.length} 个错误:</div>
              <ul className="ml-3 space-y-1 mt-1">
                {errors.slice(0, 8).map((e, i) => (
                  <li key={i} className="text-red-300">
                    [rule {e.rule}] <span className="text-gray-400">{e.path}</span>: {e.message}
                  </li>
                ))}
                {errors.length > 8 && (
                  <li className="text-gray-500">…还有 {errors.length - 8} 个错误</li>
                )}
              </ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs mt-1">
              <div className="text-yellow-400 font-semibold">{warnings.length} 个警告:</div>
              <ul className="ml-3 space-y-1 mt-1">
                {warnings.slice(0, 5).map((w, i) => (
                  <li key={i} className="text-yellow-300">
                    [rule {w.rule}] {w.path}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {savedMsg && <div className="text-xs text-blue-400 mt-1">{savedMsg}</div>}
        </footer>
      </div>

      {/* 右:预览面板 */}
      <aside className="w-[480px] flex flex-col bg-gray-900">
        <header className="px-4 py-3 border-b border-gray-700 bg-gray-800">
          <h3 className="text-base font-semibold">Preview</h3>
          {summary && (
            <p className="text-xs text-gray-400 mt-1">
              tools: {summary.tools} · references: {summary.referencesCount} · ~
              {summary.promptTokens} tokens
            </p>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-4 text-xs space-y-4">
          {!preview && !previewLoading && (
            <p className="text-gray-500">点击「预览」按钮查看渲染结果</p>
          )}

          {preview && (
            <>
              <section>
                <h4 className="text-sm font-semibold mb-1 text-green-400">
                  Tools ({preview.enabledTools.length} enabled)
                </h4>
                <ul className="space-y-1">
                  {preview.enabledTools.slice(0, 12).map((t) => (
                    <li key={t.name} className="text-gray-300">
                      <code className="bg-gray-800 px-1 rounded">{t.name}</code>{' '}
                      <span className="text-gray-500">[{t.source}]</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h4 className="text-sm font-semibold mb-1 text-gray-300">
                  Rendered system prompt (first iteration)
                </h4>
                <pre className="bg-black p-2 rounded text-[10px] whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
                  {preview.renderedPrompt.persistent.slice(0, 8000)}
                  {preview.renderedPrompt.persistent.length > 8000 && '\n…(truncated)'}
                </pre>
              </section>
            </>
          )}
        </div>
      </aside>

      {showDryRun && parsed && (
        <DryRunModal profile={parsed} onClose={() => setShowDryRun(false)} />
      )}
    </div>
  )
}

interface DryRunModalProps {
  profile: unknown
  onClose: () => void
}

function DryRunModal({ profile, onClose }: DryRunModalProps) {
  const [userMessage, setUserMessage] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)

  const handleRun = async () => {
    setRunning(true)
    try {
      const r = await talorAPI.agents.dryRun({ profile, userMessage })
      setResult(r)
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="bg-gray-900 text-gray-100 rounded-lg w-full max-w-3xl max-h-[85vh] flex flex-col border border-gray-700">
        <header className="px-4 py-3 border-b border-gray-700 flex justify-between items-center">
          <h3 className="text-base font-semibold">Dry Run (sandbox)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </header>
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <label className="block text-xs text-gray-400 mb-1">用户消息(模拟):</label>
          <textarea
            className="w-full p-2 bg-gray-950 rounded text-sm font-mono"
            rows={3}
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="例如:帮我审 PR #123"
          />
          <p className="text-[10px] text-gray-500">
            验证 profile + 渲染首轮 prompt。不调真实 LLM。
          </p>
          <button
            onClick={handleRun}
            disabled={running || !userMessage.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded text-sm"
          >
            {running ? '运行中…' : '执行试跑'}
          </button>

          {result !== null && (
            <pre className="bg-black p-3 rounded text-[10px] whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
