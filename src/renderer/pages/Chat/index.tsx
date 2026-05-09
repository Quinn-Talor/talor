import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useStreamingMessage } from '../../hooks/useStreamingMessage'
import { talorAPI } from '../../api/talorAPI'
import { MessageBubble } from '../../components/MessageBubble'
import { SessionItem, getDateGroup, agentColor } from '../../components/SessionItem'
import { useUIStore } from '../../store/uiStore'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AttachmentPreview } from '../../components/AttachmentPreview'
import { WorkspaceSelector } from '../../components/WorkspaceSelector'
import { ToolCallLog } from '../../components/ToolCallLog'
import { ToolCallMessage } from '../../components/ToolCallMessage'
// ToolConfirmDialog 和 PermissionDialog 已下线到 PermissionsPopover 内嵌渲染,
// UX 统一为 popover 卡片。两个组件源码保留(可能的全屏 agent 模式备用),
// 但 Chat 页面不再消费它们。
import { PermissionsPopover } from '../../components/PermissionsPopover'
import { CrystallizeSeparator } from '../../components/CrystallizeSeparator'
import { WorkbenchAgentList } from '../../components/WorkbenchAgentList'
import { DraftReviewModal } from '../../components/DraftReviewModal'
import { AgentPreviewModal } from '../../components/AgentPreviewModal'
import { useCrystallizeWorkbench } from '../../hooks/useCrystallizeWorkbench'
import type { Attachment } from '../../types/chat'
import type { ModelInfo } from '@shared/types/models'
import type { AgentCardData } from '../../components/AgentCard'

interface ModelOption {
  id: string
  displayName: string
  providerName: string
  providerId: string
}

const BUILTIN_TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command in the workspace directory.',
    riskLevel: 'HIGH',
  },
  { name: 'read', description: 'Read content of a file.', riskLevel: 'LOW' },
  { name: 'write', description: 'Write content to a file.', riskLevel: 'MEDIUM' },
  { name: 'edit', description: 'Edit a file with string replacement.', riskLevel: 'MEDIUM' },
  { name: 'glob', description: 'Find files matching a glob pattern.', riskLevel: 'LOW' },
  { name: 'grep', description: 'Search file contents with regex.', riskLevel: 'LOW' },
  { name: 'ls', description: 'List files in a directory.', riskLevel: 'LOW' },
] as const

interface ChatPageProps {
  onOpenSettings: () => void
}

export function ChatPage({ onOpenSettings }: ChatPageProps) {
  const {
    sessions,
    currentSessionId,
    messages,
    streamState,
    streamItems,
    error,
    attachments,
    setSessions,
    setCurrentSession,
    setMessages,
    addMessage,
    clearStreaming,
    setAttachments,
    removeAttachment,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showAgentPicker, setShowAgentPicker] = useState(false)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [currentModelId, setCurrentModelId] = useState<string | undefined>()
  const [currentWorkspace, setCurrentWorkspace] = useState<string | undefined>()
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>()
  const [agentTools, setAgentTools] = useState<
    Array<{ name: string; description: string; provider?: string; riskLevel?: string }>
  >([])
  const [agents, setAgents] = useState<AgentCardData[]>([])
  const [modelSwitchedToast, setModelSwitchedToast] = useState(false)
  const [modelUnavailable, setModelUnavailable] = useState(false)
  const [showMcpPopover, setShowMcpPopover] = useState(false)
  const [showToolsPopover, setShowToolsPopover] = useState(false)
  const [expandedMcpServers, setExpandedMcpServers] = useState<Set<string>>(new Set())
  const mcpPopoverRef = useRef<HTMLDivElement>(null)
  const toolsPopoverRef = useRef<HTMLDivElement>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const agentPickerRef = useRef<HTMLDivElement>(null)

  // Agent extraction workbench (inline collapsible panel; spec §B.9)
  // 工作台 session 的流式事件不订阅 — useStreamingMessage 仍跟原 session,
  // 用户跟 crystallizer 对话后通过 ws.refresh() 拉最新 workbench messages。
  // 这是 spec §B.9.4 F2 接受的 UX：crystallizer 输出非流式渲染，stream 完成后整体刷新。
  const ws = useCrystallizeWorkbench({ originSessionId: currentSessionId })
  const [separatorCollapsed, setSeparatorCollapsed] = useState(false)
  const [reviewProfile, setReviewProfile] = useState<Record<string, unknown> | null>(null)
  const [previewAgentId, setPreviewAgentId] = useState<string | null>(null)

  useStreamingMessage(currentSessionId)

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await talorAPI.session.list())
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
  }, [setSessions])

  // 启动 agent 会话：从工作台 list 行 / preview modal / Agents 页 共用同一逻辑。
  // 流程：关工作台（如果开着）→ createSession → reload sessions list → 切到新 session
  // 必须放在 loadSessions 之后 —— deps 数组引用 loadSessions，hoisting 不允许前置。
  const startAgentSession = useCallback(
    async (agentId: string) => {
      try {
        const result = await talorAPI.agents.createSession(agentId)
        if (ws.isOpen) await ws.close()
        setPreviewAgentId(null)
        await loadSessions()
        setCurrentSession(result.session_id)
      } catch (err) {
        alert(`启动失败: ${err instanceof Error ? err.message : err}`)
      }
    },
    [ws, loadSessions, setCurrentSession],
  )

  const loadMessages = useCallback(
    async (id: string) => {
      try {
        setMessages(await talorAPI.session.getMessages(id))
      } catch (e) {
        console.error('Failed to load messages', e)
      }
    },
    [setMessages],
  )

  const loadModelOptions = useCallback(async () => {
    try {
      const providers = await talorAPI.providers.list()
      const opts: ModelOption[] = []
      for (const p of providers) {
        const res = await talorAPI.providers.getModels(p.id)
        for (const m of res.models) {
          opts.push({
            id: m.id,
            displayName: (m as ModelInfo).display_name || (m as ModelInfo).name,
            providerName: p.name,
            providerId: p.id,
          })
        }
      }
      setModelOptions(opts)
    } catch (e) {
      console.error('Failed to load models', e)
    }
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      setAgents((await talorAPI.agents.list()) as AgentCardData[])
    } catch (e) {
      console.error('Failed to load agents', e)
    }
  }, [])

  const loadAgentTools = useCallback(async (agentId: string | undefined) => {
    // undefined = platform agent (__chat__), use __chat__ id
    const id = agentId ?? '__chat__'
    try {
      const tools = await talorAPI.agents.listTools(id)
      setAgentTools(tools)
    } catch {
      setAgentTools([])
    }
  }, [])

  useEffect(() => {
    loadSessions()
    loadModelOptions()
    loadAgents()
    loadAgentTools(undefined)
    // MCP 启动比 UI mount 慢约 2 秒。延迟再刷一次,让 MCP 工具及时进入 badge 计数。
    const t = setTimeout(() => loadAgentTools(undefined), 3000)
    return () => clearTimeout(t)
  }, [loadSessions, loadModelOptions, loadAgents, loadAgentTools])

  // 性能关键: 消息列表渲染缓存 — 仅在 messages 变化时重算
  // 之前每次输入(setInput)都会让父组件重渲染,触发这段含 40+ JSON.parse 的 reduce,
  // 导致输入卡顿。useMemo 后输入完全不影响这段计算。
  const renderedMessages = useMemo<React.ReactNode[]>(() => {
    return messages.reduce((acc, msg, idx) => {
      if (msg.role === 'tool') return acc
      if (msg.role === 'assistant') {
        try {
          const blocks = JSON.parse(msg.content) as Array<{
            type: string
            toolCallId?: string
            toolName?: string
            input?: unknown
          }>
          if (Array.isArray(blocks) && blocks.some((b) => b.type === 'tool-call')) {
            const toolUses = blocks
              .filter((b) => b.type === 'tool-call')
              .map((b) => ({
                type: 'tool-call' as const,
                toolCallId: b.toolCallId ?? '',
                toolName: b.toolName ?? '',
                input: b.input,
              }))
            const next = messages[idx + 1]
            let toolResults: Array<{
              type: 'tool-result'
              toolCallId: string
              toolName: string
              output: string
              isError: boolean
            }> = []
            if (next?.role === 'tool') {
              try {
                const rb = JSON.parse(next.content) as Array<{
                  type: string
                  toolCallId?: string
                  toolName?: string
                  output?: { type: string; value: string }
                  isError?: boolean
                }>
                toolResults = rb
                  .filter((b) => b.type === 'tool-result')
                  .map((b) => ({
                    type: 'tool-result' as const,
                    toolCallId: b.toolCallId ?? '',
                    toolName: b.toolName ?? '',
                    output: b.output?.value ?? '',
                    isError: b.isError ?? false,
                  }))
              } catch {
                /* skip */
              }
            }
            const textContent = blocks
              .filter((b) => b.type === 'text')
              .map((b) => (b as { text?: string }).text ?? '')
              .join('')
              .trim()
            acc.push(
              <div key={msg.id} className="mb-0.5">
                {textContent && (
                  <div className="px-2 text-[12px] text-zinc-500 dark:text-zinc-400 mb-0.5 truncate">
                    {textContent.slice(0, 80)}
                    {textContent.length > 80 ? '…' : ''}
                  </div>
                )}
                <ToolCallMessage toolUses={toolUses} toolResults={toolResults} />
              </div>,
            )
            return acc
          }
        } catch {
          /* render normal */
        }
      }
      acc.push(<MessageBubble key={msg.id} message={msg} />)
      return acc
    }, [] as React.ReactNode[])
  }, [messages])

  // Auto-select most recent session
  useEffect(() => {
    if (!currentSessionId && sessions.length > 0) setCurrentSession(sessions[0].id)
  }, [sessions, currentSessionId, setCurrentSession])

  const resolveAgentId = useCallback(
    (sessionAgentId: string | undefined): string | undefined => {
      if (!sessionAgentId || sessionAgentId === '__chat__') return undefined
      // fallback to platform agent if the business agent no longer exists
      return agents.some((a) => a.id === sessionAgentId) ? sessionAgentId : undefined
    },
    [agents],
  )

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId)
      const s = sessions.find((s) => s.id === currentSessionId)
      setCurrentModelId(s?.model_id)
      setCurrentWorkspace(s?.workspace ?? undefined)
      const resolvedId = resolveAgentId(s?.agent_id)
      setCurrentAgentId(resolvedId)
      loadAgentTools(resolvedId)
      setModelUnavailable(false)
      if (s?.model_id) {
        talorAPI.session
          .checkModelAvailability({ session_id: currentSessionId })
          .then((r) => {
            if (!r.available) setModelUnavailable(true)
          })
          .catch(() => {})
      }
    } else {
      setMessages([])
      setCurrentModelId(undefined)
      setCurrentWorkspace(undefined)
      setCurrentAgentId(undefined)
      setAgentTools([])
      setModelUnavailable(false)
    }
  }, [currentSessionId]) // eslint-disable-line

  useEffect(() => {
    if (currentSessionId) {
      const s = sessions.find((s) => s.id === currentSessionId)
      setCurrentModelId(s?.model_id)
      setCurrentWorkspace(s?.workspace ?? undefined)
      const resolvedId = resolveAgentId(s?.agent_id)
      setCurrentAgentId(resolvedId)
    }
  }, [sessions, currentSessionId])

  useEffect(() => {
    if (streamState === 'done' && currentSessionId) loadMessages(currentSessionId)
  }, [streamState, currentSessionId]) // eslint-disable-line

  // Reset userScrolledUp when streaming starts or session changes
  useEffect(() => {
    if (streamState === 'streaming') userScrolledUpRef.current = false
  }, [streamState, currentSessionId])

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamItems, streamState])

  // 工作台打开 / 工作台消息变化时滚到 messagesEndRef —— 工作台 panel 渲染
  // 在 messagesEndRef 之上，所以滚到 end 就是滚到工作台最底部，
  // 让用户立刻看到 crystallizer 最新输出而不必手动下滑。
  // 强制滚动（忽略 userScrolledUp），因为这是用户主动点击触发的视图变化。
  useEffect(() => {
    if (ws.isOpen) {
      userScrolledUpRef.current = false
      // 等下一帧渲染完成（panel 已挂载）再滚
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      })
    }
  }, [ws.isOpen, ws.workbenchMessages.length])

  useEffect(() => {
    if (import.meta.env?.DEV) {
      ;(window as unknown as Record<string, unknown>).__test_setAttachments = setAttachments
    }
    return () => {
      if (import.meta.env?.DEV)
        delete (window as unknown as Record<string, unknown>).__test_setAttachments
    }
  }, [setAttachments])

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node))
        setShowModelPicker(false)
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node))
        setShowAgentPicker(false)
      if (mcpPopoverRef.current && !mcpPopoverRef.current.contains(e.target as Node))
        setShowMcpPopover(false)
      if (toolsPopoverRef.current && !toolsPopoverRef.current.contains(e.target as Node))
        setShowToolsPopover(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const handleCreateSession = async () => {
    try {
      const providers = await talorAPI.providers.list()
      const def = providers.find((p) => p.is_default) || providers[0]
      if (!def) return
      const session = await talorAPI.session.create({ provider_id: def.id })
      await loadSessions()
      setCurrentSession(session.id)
    } catch (e) {
      console.error('Failed to create session', e)
    }
  }

  const handleModelChange = async (modelId: string) => {
    setShowModelPicker(false)
    if (!currentSessionId) return
    try {
      const selectedModel = modelOptions.find((m) => m.id === modelId)
      const updated = await talorAPI.session.updateModel({
        session_id: currentSessionId,
        model_id: modelId,
        provider_id: selectedModel?.providerId,
      })
      if (updated) {
        setCurrentModelId(updated.model_id)
        setModelUnavailable(false)
        await loadSessions()
        setModelSwitchedToast(true)
        setTimeout(() => setModelSwitchedToast(false), 2500)
      }
    } catch (e) {
      console.error('Failed to update model', e)
    }
  }

  const handleAgentChange = async (agentId: string | undefined) => {
    setShowAgentPicker(false)
    if (!currentSessionId) return
    try {
      await (
        talorAPI.agents as { switchAgent?: (s: string, a: string) => Promise<unknown> }
      ).switchAgent?.(currentSessionId, agentId ?? '__chat__')
      setCurrentAgentId(agentId)
      await loadAgentTools(agentId)
      await loadSessions()
    } catch (e) {
      console.error('Failed to switch agent', e)
    }
  }

  const handleRenameSession = async (id: string, nextTitle: string) => {
    const trimmed = nextTitle.trim()
    const current = sessions.find((s) => s.id === id)
    if (!trimmed || trimmed === (current?.title ?? '')) {
      setRenamingSessionId(null)
      return
    }
    try {
      await talorAPI.session.rename({ session_id: id, title: trimmed })
      await loadSessions()
    } catch (e) {
      console.error('Failed to rename session', e)
    } finally {
      setRenamingSessionId(null)
    }
  }

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return
    try {
      await talorAPI.session.delete(sessionToDelete)
      await loadSessions()
      if (currentSessionId === sessionToDelete) setCurrentSession(null)
    } catch (e) {
      console.error('Failed to delete', e)
    } finally {
      setSessionToDelete(null)
    }
  }

  const handleSend = async () => {
    if (
      (!input.trim() && attachments.length === 0) ||
      !currentSessionId ||
      streamState === 'streaming'
    )
      return
    const content = input.trim()
    setInput('')
    clearStreaming()
    clearStreaming()

    // 沉淀模式下输入路由到 workbench session（spec §B.9.4 F2）。
    // 注意：addMessage 用 currentSessionId 时会污染 chat store 显示；
    // 走 workbench 时不 addMessage，依赖 ws.refresh() 在 send 完成后拉到。
    const targetSessionId = ws.workbenchSessionId ?? currentSessionId
    const routedToWorkbench = targetSessionId !== currentSessionId

    if (!routedToWorkbench) {
      addMessage({
        id: `temp-${Date.now()}`,
        session_id: currentSessionId,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      })
    }
    try {
      await talorAPI.chat.send({
        session_id: targetSessionId,
        content,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
      setAttachments([])
      if (routedToWorkbench) {
        await ws.refresh()
      } else {
        await loadMessages(currentSessionId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('FILE_TOO_LARGE')) alert('文件大小超过限制（最大 50MB）')
      else if (msg.includes('UNSUPPORTED_FILE_TYPE')) alert('不支持的文件类型')
      else if (msg.includes('FILE_NOT_FOUND')) alert('文件不存在或无法访问')
      else if (msg.includes('PROVIDER_NO_VISION')) alert('当前模型不支持图片识别')
      else alert(`发送失败: ${msg}`)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStop = async () => {
    if (!currentSessionId) return
    clearStreaming()
    clearStreaming()
    try {
      await talorAPI.chat.abort(currentSessionId)
    } catch {
      /* noop */
    }
  }

  const handleAttachmentClick = async () => {
    if (streamState === 'streaming') return
    try {
      const paths = await talorAPI.file.openDialog({
        title: '选择文件',
        filters: [{ name: '所有文件', extensions: ['*'] }],
        properties: ['openFile', 'multiSelections'],
      })
      if (!paths?.length) return
      const newAtts: Attachment[] = paths
        .filter((p) => !attachments.some((a) => a.path === p))
        .map((p) => ({
          path: p,
          mime_type: 'application/octet-stream',
          filename: p.split(/[\\/]/).pop() || p,
          size_bytes: 0,
        }))
      if (newAtts.length) setAttachments([...attachments, ...newAtts])
    } catch {
      /* noop */
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (streamState !== 'streaming') setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (streamState === 'streaming') return
    const newAtts: Attachment[] = Array.from(e.dataTransfer.files)
      .filter(
        (f) =>
          !attachments.some((a) => a.path === ((f as unknown as { path?: string }).path || f.name)),
      )
      .map((f) => ({
        path: (f as unknown as { path?: string }).path || f.name,
        mime_type: f.type || 'application/octet-stream',
        filename: f.name,
        size_bytes: f.size,
      }))
    if (newAtts.length) setAttachments([...attachments, ...newAtts])
  }

  // Derived display values
  const currentModelOpt = modelOptions.find((m) => m.id === currentModelId)
  const currentModelName =
    currentModelOpt?.displayName ??
    (currentModelId ? (currentModelId.split('/').pop() ?? currentModelId) : '选择模型')
  const currentModelProvider = currentModelOpt?.providerName ?? ''
  const currentAgent = agents.find((a) => a.id === currentAgentId)
  const currentAgentName = currentAgent?.name ?? 'Talor'
  const currentAgentSubtitle = currentAgent?.id ?? 'talor-default'
  const currentAgentColorVal = agentColor(currentAgentId)
  // Split agentTools into builtin (no provider) and mcp (has provider)
  const agentBuiltinTools = agentTools.filter((t) => !t.provider)
  const agentMcpTools = agentTools.filter((t) => !!t.provider)

  // Filter out sub-sessions (parent_session_id non-null) unless user opts in.
  // 默认隐藏子 session：用户视角下子 session 是 delegate_agent 的实施细节，
  // 不是直接对话目标；调试 / 排查时通过开关打开。
  // 工作台 session（agent_id='__crystallizer__'）也始终隐藏（AC-016）—
  // 它是导出 Agent 的内部对话区，不应作为顶层 session 暴露给用户切换。
  const showSubSessions = useUIStore((s) => s.showSubSessions)
  const visibleSessions = sessions.filter(
    (s) => s.agent_id !== '__crystallizer__' && (showSubSessions || s.parent_session_id == null),
  )

  // Group sessions by date
  const todaySessions = visibleSessions.filter((s) => getDateGroup(s.updated_at) === 'today')
  const yesterdaySessions = visibleSessions.filter(
    (s) => getDateGroup(s.updated_at) === 'yesterday',
  )
  const earlierSessions = visibleSessions.filter((s) => getDateGroup(s.updated_at) === 'earlier')

  const agentMap = new Map(agents.map((a) => [a.id, a]))

  return (
    <div
      className="flex h-full w-full overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* ═══════════════════════════════════════════
          DARK SIDEBAR  (260px)
      ═══════════════════════════════════════════ */}
      <div
        className="flex flex-col shrink-0 select-none"
        style={{ width: 260, background: 'linear-gradient(to bottom, #111827, #0f172a)' }}
      >
        {/* Drag region for native traffic lights (macOS) */}
        <div
          style={{ height: 36, WebkitAppRegion: 'drag', flexShrink: 0 } as React.CSSProperties}
        />

        {/* New session button */}
        <div
          className="px-[16px] pt-0 pb-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={handleCreateSession}
            className="w-full flex items-center justify-center text-[13px] font-semibold rounded-[10px] transition-colors hover:opacity-90"
            style={{
              height: 40,
              background: 'rgba(59,130,246,0.12)',
              border: '0.5px solid rgba(59,130,246,0.25)',
              color: '#60a5fa',
            }}
          >
            + 新建会话
          </button>
        </div>

        {/* Session list */}
        <div
          className="flex-1 overflow-y-auto pt-[10px]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {sessions.length === 0 ? (
            <div
              className="text-center text-[12px] mt-8"
              style={{ color: 'rgba(255,255,255,0.15)' }}
            >
              暂无会话
            </div>
          ) : (
            <>
              {todaySessions.length > 0 && (
                <>
                  <div
                    className="px-[20px] py-[6px] text-[10px] font-semibold tracking-[0.05em]"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                  >
                    今天
                  </div>
                  {todaySessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === currentSessionId}
                      agentName={s.agent_id ? agentMap.get(s.agent_id)?.name : undefined}
                      agentColor={agentColor(s.agent_id)}
                      isRenaming={s.id === renamingSessionId}
                      onStartRename={() => setRenamingSessionId(s.id)}
                      onCommitRename={(t) => handleRenameSession(s.id, t)}
                      onCancelRename={() => setRenamingSessionId(null)}
                      onClick={() => setCurrentSession(s.id)}
                      onDelete={() => setSessionToDelete(s.id)}
                    />
                  ))}
                </>
              )}
              {yesterdaySessions.length > 0 && (
                <>
                  <div
                    className="px-[20px] py-[6px] text-[10px] font-semibold tracking-[0.05em]"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                  >
                    昨天
                  </div>
                  {yesterdaySessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === currentSessionId}
                      agentName={s.agent_id ? agentMap.get(s.agent_id)?.name : undefined}
                      agentColor={agentColor(s.agent_id)}
                      isRenaming={s.id === renamingSessionId}
                      onStartRename={() => setRenamingSessionId(s.id)}
                      onCommitRename={(t) => handleRenameSession(s.id, t)}
                      onCancelRename={() => setRenamingSessionId(null)}
                      onClick={() => setCurrentSession(s.id)}
                      onDelete={() => setSessionToDelete(s.id)}
                    />
                  ))}
                </>
              )}
              {earlierSessions.length > 0 && (
                <>
                  <div
                    className="px-[20px] py-[6px] text-[10px] font-semibold tracking-[0.05em]"
                    style={{ color: 'rgba(255,255,255,0.3)' }}
                  >
                    更早
                  </div>
                  {earlierSessions.map((s) => (
                    <SessionItem
                      key={s.id}
                      session={s}
                      isActive={s.id === currentSessionId}
                      agentName={s.agent_id ? agentMap.get(s.agent_id)?.name : undefined}
                      agentColor={agentColor(s.agent_id)}
                      isRenaming={s.id === renamingSessionId}
                      onStartRename={() => setRenamingSessionId(s.id)}
                      onCommitRename={(t) => handleRenameSession(s.id, t)}
                      onCancelRename={() => setRenamingSessionId(null)}
                      onClick={() => setCurrentSession(s.id)}
                      onDelete={() => setSessionToDelete(s.id)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Bottom: settings */}
        <div
          style={
            {
              WebkitAppRegion: 'no-drag',
              background: 'rgba(0,0,0,0.2)',
              borderTop: '0.5px solid rgba(255,255,255,0.06)',
              height: 70,
              flexShrink: 0,
            } as React.CSSProperties
          }
        >
          <button
            onClick={onOpenSettings}
            className="w-full h-full flex items-center gap-[10px] px-[16px] transition-colors hover:opacity-90"
          >
            <div
              className="flex items-center justify-center rounded-[10px]"
              style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ color: 'rgba(255,255,255,0.5)' }}
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </div>
            <div className="text-left">
              <div className="text-[12px] font-medium" style={{ color: 'rgba(255,255,255,0.6)' }}>
                设置
              </div>
              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                快捷键 ⌘,
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          CHAT AREA
      ═══════════════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={{ background: 'linear-gradient(to bottom, #f8fafc, #f1f5f9)' }}
      >
        {currentSessionId ? (
          <>
            {/* Top bar (52px, white) */}
            <div
              className="flex items-center gap-3 px-6 shrink-0"
              style={{ height: 52, background: '#ffffff', borderBottom: '0.5px solid #e2e8f0' }}
            >
              {/* Agent selector */}
              <div className="relative" ref={agentPickerRef}>
                <button
                  onClick={() => setShowAgentPicker((p) => !p)}
                  className="flex items-center gap-2 rounded-[8px] px-2 transition-colors hover:bg-[#f1f5f9]"
                  style={{ height: 34, background: '#f8fafc', border: '0.5px solid #e2e8f0' }}
                >
                  <div
                    className="flex items-center justify-center rounded-[6px] text-[10px] font-bold shrink-0"
                    style={{
                      width: 24,
                      height: 24,
                      background: `rgba(${currentAgentId ? '139,92,246' : '59,130,246'},0.15)`,
                      color: currentAgentId ? '#8b5cf6' : '#3b82f6',
                    }}
                  >
                    {currentAgentName.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div
                      className="text-[12px] font-medium leading-tight"
                      style={{ color: '#334155' }}
                    >
                      {currentAgentName}
                    </div>
                    <div className="text-[9px] leading-tight" style={{ color: '#94a3b8' }}>
                      {currentAgentSubtitle}
                    </div>
                  </div>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{ color: '#94a3b8', flexShrink: 0 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {showAgentPicker && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg z-50 overflow-hidden"
                    style={{ width: 240, border: '1px solid #e2e8f0' }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: '#f1f5f9' }}>
                      <p
                        className="text-[10px] uppercase tracking-wide"
                        style={{ color: '#94a3b8' }}
                      >
                        选择 Agent
                      </p>
                    </div>
                    <div className="overflow-y-auto p-1" style={{ maxHeight: 256 }}>
                      <button
                        onClick={() => handleAgentChange(undefined)}
                        className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors hover:bg-[#f8fafc]"
                        style={{
                          background: !currentAgentId ? '#eff6ff' : undefined,
                          color: !currentAgentId ? '#1d4ed8' : '#374151',
                        }}
                      >
                        <div
                          className="flex items-center justify-center rounded-md text-[10px] font-bold shrink-0"
                          style={{
                            width: 24,
                            height: 24,
                            background: 'rgba(59,130,246,0.1)',
                            color: '#3b82f6',
                          }}
                        >
                          T
                        </div>
                        <div>
                          <div className="text-[12px] font-medium">Talor</div>
                          <div className="text-[10px]" style={{ color: '#94a3b8' }}>
                            通用助手
                          </div>
                        </div>
                      </button>
                      {agents.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => handleAgentChange(a.id)}
                          className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors hover:bg-[#f8fafc]"
                          style={{
                            background: a.id === currentAgentId ? '#eff6ff' : undefined,
                            color: a.id === currentAgentId ? '#1d4ed8' : '#374151',
                          }}
                        >
                          <div
                            className="flex items-center justify-center rounded-md text-[10px] font-bold shrink-0"
                            style={{
                              width: 24,
                              height: 24,
                              background: 'rgba(139,92,246,0.1)',
                              color: '#8b5cf6',
                            }}
                          >
                            {a.name.charAt(0)}
                          </div>
                          <div>
                            <div
                              className="text-[12px] font-medium truncate"
                              style={{ maxWidth: 160 }}
                            >
                              {a.name}
                            </div>
                            <div className="text-[10px]" style={{ color: '#94a3b8' }}>
                              {a.status === 'ready'
                                ? '就绪'
                                : a.status === 'disabled'
                                  ? '未启用'
                                  : '缺少依赖'}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Model selector (left, next to agent picker) */}
              <div className="relative" ref={modelPickerRef}>
                <button
                  onClick={() => setShowModelPicker((p) => !p)}
                  className="flex items-center gap-2 rounded-[8px] px-2 transition-colors hover:bg-[#f1f5f9]"
                  style={{ height: 34, background: '#f8fafc', border: '0.5px solid #e2e8f0' }}
                  data-testid="model-picker-trigger"
                >
                  <div
                    className="rounded-full shrink-0"
                    style={{
                      width: 8,
                      height: 8,
                      background: modelUnavailable ? '#f59e0b' : '#22c55e',
                    }}
                  />
                  <div className="text-left">
                    <div className="text-[11px] leading-tight" style={{ color: '#334155' }}>
                      {currentModelName}
                    </div>
                    {currentModelProvider && (
                      <div className="text-[9px] leading-tight" style={{ color: '#94a3b8' }}>
                        {currentModelProvider}
                      </div>
                    )}
                  </div>
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    style={{ color: '#94a3b8', flexShrink: 0 }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {showModelPicker && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-lg z-50 overflow-hidden"
                    style={{ width: 288, border: '1px solid #e2e8f0' }}
                    data-testid="model-picker-dropdown"
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: '#f1f5f9' }}>
                      <p
                        className="text-[10px] uppercase tracking-wide"
                        style={{ color: '#94a3b8' }}
                      >
                        选择模型
                      </p>
                    </div>
                    <div className="overflow-y-auto p-1" style={{ maxHeight: 256 }}>
                      {modelOptions.length === 0 ? (
                        <p className="text-[12px] text-center py-4" style={{ color: '#94a3b8' }}>
                          加载中…
                        </p>
                      ) : (
                        modelOptions.map((opt) => (
                          <button
                            key={opt.id}
                            onClick={() => handleModelChange(opt.id)}
                            className="w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-[#f8fafc]"
                            style={{
                              background: opt.id === currentModelId ? '#eff6ff' : undefined,
                              color: opt.id === currentModelId ? '#1d4ed8' : '#374151',
                            }}
                            data-testid={`model-option-${opt.id}`}
                          >
                            <div className="text-[12px] font-medium truncate">
                              {opt.displayName}
                            </div>
                            <div className="text-[11px]" style={{ color: '#94a3b8' }}>
                              {opt.providerName}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Export Agent (right) — 沿用左侧 agent / model picker 的视觉规格
                  (h=34, gray bg, 0.5px border, 24x24 icon square, 12px label, 9px subtitle, chevron)
                  状态：箭头方向反映折叠区开关状态（▼ 关 / ▲ 开）。 */}
              {(() => {
                const currentSession = sessions.find((s) => s.id === currentSessionId)
                const showExport =
                  currentSession != null &&
                  currentSession.agent_id !== '__crystallizer__' &&
                  currentSession.parent_session_id == null &&
                  messages.length >= 3
                if (!showExport) return null
                const active = ws.isOpen
                return (
                  <div className="ml-auto">
                    <button
                      type="button"
                      onClick={() => {
                        if (ws.isOpen) {
                          void ws.close()
                        } else {
                          void ws.open().catch((err) => {
                            alert(`无法打开沉淀工作台: ${err instanceof Error ? err.message : err}`)
                          })
                        }
                      }}
                      disabled={ws.isLoading}
                      title={active ? '关闭沉淀工作台' : '基于当前对话提取一个 Agent'}
                      aria-label={
                        active ? 'Close Export Agent workbench' : 'Open Export Agent workbench'
                      }
                      className="flex items-center gap-2 rounded-[8px] px-2 transition-colors hover:bg-[#f1f5f9] disabled:opacity-50"
                      style={{
                        height: 34,
                        background: '#f8fafc',
                        border: '0.5px solid #e2e8f0',
                      }}
                      data-testid="export-as-agent-btn"
                      data-active={active ? 'true' : 'false'}
                    >
                      <div
                        className="flex items-center justify-center rounded-[6px] text-[10px] shrink-0"
                        style={{
                          width: 24,
                          height: 24,
                          background: 'rgba(139,92,246,0.15)',
                          color: '#8b5cf6',
                        }}
                      >
                        {ws.isLoading ? (
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="animate-spin"
                          >
                            <circle
                              cx="12"
                              cy="12"
                              r="10"
                              strokeDasharray="50"
                              strokeDashoffset="20"
                            />
                          </svg>
                        ) : (
                          <span className="leading-none">🔮</span>
                        )}
                      </div>
                      <div className="text-left">
                        <div
                          className="text-[12px] font-medium leading-tight"
                          style={{ color: '#334155' }}
                        >
                          Export Agent
                        </div>
                        <div className="text-[9px] leading-tight" style={{ color: '#94a3b8' }}>
                          {active ? '工作台已展开' : '从当前对话提取'}
                        </div>
                      </div>
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{
                          color: active ? '#8b5cf6' : '#94a3b8',
                          flexShrink: 0,
                          transform: active ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 200ms ease',
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                )
              })()}
            </div>

            {/* Model unavailable banner */}
            {modelUnavailable && (
              <div
                className="flex items-center gap-3 px-4 py-2 text-[13px]"
                style={{
                  background: '#fffbeb',
                  borderBottom: '1px solid #fde68a',
                  color: '#92400e',
                }}
                data-testid="model-unavailable-banner"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className="flex-1">模型不可用 — 该模型已无法使用</span>
                <button
                  onClick={() => setShowModelPicker(true)}
                  className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-white transition-colors"
                  style={{ background: '#d97706' }}
                  data-testid="select-other-model-btn"
                >
                  选择其他模型
                </button>
              </div>
            )}

            {/* Messages */}
            <div
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto px-6 py-6"
              onScroll={() => {
                const el = messagesContainerRef.current
                if (!el) return
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
                userScrolledUpRef.current = !atBottom
              }}
            >
              {messages.length === 0 && streamState !== 'streaming' ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center">
                    <div
                      className="flex items-center justify-center mx-auto mb-3 rounded-[16px]"
                      style={{
                        width: 48,
                        height: 48,
                        background: 'rgba(59,130,246,0.08)',
                        border: '1px solid rgba(59,130,246,0.15)',
                      }}
                    >
                      <span className="font-bold text-xl" style={{ color: '#3b82f6' }}>
                        T
                      </span>
                    </div>
                    <p className="text-[14px] font-semibold mb-1" style={{ color: '#334155' }}>
                      开始对话
                    </p>
                    <p className="text-[13px]" style={{ color: '#94a3b8' }}>
                      在下方输入消息开始对话
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {renderedMessages}
                  {streamState === 'streaming' && <ToolCallLog />}
                  {streamState === 'error' && error && (
                    <div
                      className="flex items-start gap-2 p-3 rounded-xl text-[13px]"
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fee2e2',
                        color: '#dc2626',
                      }}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ flexShrink: 0, marginTop: 1 }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <div>
                        <span className="font-semibold block">{error.code}</span>
                        <span>{error.message}</span>
                      </div>
                    </div>
                  )}

                  {/* Crystallize workbench panel — spec §B.9.2 */}
                  {ws.isOpen && (
                    <div
                      className="rounded-lg overflow-hidden"
                      style={{
                        border: '1px solid #c084fc',
                        background: '#faf5ff',
                      }}
                      data-testid="crystallize-workbench"
                    >
                      <CrystallizeSeparator
                        collapsed={separatorCollapsed}
                        basedOnMessageCount={messages.length}
                        onToggleCollapse={() => setSeparatorCollapsed((v) => !v)}
                      />
                      {!separatorCollapsed && (
                        <>
                          <div className="px-3 py-3 space-y-2">
                            {ws.workbenchMessages.length === 0 ? (
                              <div
                                className="text-[12px] text-center py-4"
                                style={{ color: '#94a3b8' }}
                              >
                                工作台已就绪。在下方输入"开始"或"请基于这段对话提议 agent"，让
                                Crystallizer 提议草稿。
                              </div>
                            ) : (
                              ws.workbenchMessages.map((m) => (
                                <MessageBubble
                                  key={m.id}
                                  message={m}
                                  variant="crystallize"
                                  onReviewDraft={(profile) => setReviewProfile(profile)}
                                />
                              ))
                            )}
                            {/* 流式 token 增量：done 之前的内容渲染成临时
                                assistant bubble；done 后 hook 的 refresh()
                                会把持久化的 message 拉到 workbenchMessages
                                里再清空 streamingText。 */}
                            {ws.isStreaming && (
                              <MessageBubble
                                message={{ role: 'assistant', content: ws.streamingText }}
                                variant="crystallize"
                                isStreaming
                              />
                            )}
                          </div>
                          <WorkbenchAgentList
                            agents={ws.generatedAgents}
                            onPreview={(id) => setPreviewAgentId(id)}
                            onStart={(id) => void startAgentSession(id)}
                            onRemove={(id) => {
                              if (
                                window.confirm(
                                  `从工作台移除 ${id}？\n\nagent.json 文件不会被删除（只从此工作台 list 移除）。要彻底删除请去 Agents 页。`,
                                )
                              ) {
                                void ws.removeAgent(id)
                              }
                            }}
                          />
                        </>
                      )}
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input area */}
            <div
              className="shrink-0 px-6 pb-4 pt-3"
              style={{
                background: 'linear-gradient(to bottom, #ffffff, #f8fafc)',
                borderTop: '0.5px solid #e2e8f0',
              }}
            >
              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((a, i) => (
                    <AttachmentPreview
                      key={i}
                      attachment={a}
                      onRemove={() => removeAttachment(i)}
                      compact
                    />
                  ))}
                </div>
              )}

              {/* Input card — workspace pill inside the card top row */}
              <div
                className="rounded-[14px] transition-all focus-within:shadow-[0_0_0_2px_rgba(59,130,246,0.18)]"
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
                }}
              >
                {/* Workspace + top meta row */}
                <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                  <WorkspaceSelector
                    sessionId={currentSessionId}
                    workspace={currentWorkspace}
                    onWorkspaceChange={(ws) => {
                      setCurrentWorkspace(ws)
                      loadSessions()
                    }}
                    disabled={streamState === 'streaming'}
                  />
                  {currentWorkspace && (
                    <div className="ml-auto">
                      <PermissionsPopover workspacePath={currentWorkspace} />
                    </div>
                  )}
                </div>

                {/* Textarea */}
                <div className="px-4 pb-1">
                  {ws.isOpen && (
                    <div
                      className="text-[11px] mb-1"
                      style={{ color: '#7c3aed' }}
                      data-testid="crystallize-input-hint"
                    >
                      🔮 Crystallizer 沉淀模式 — 关闭工作台回到 {currentAgentName}
                    </div>
                  )}
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={
                      ws.isOpen
                        ? '描述你想从对话中提取什么样的 agent...'
                        : `给 ${currentAgentName} 发消息...`
                    }
                    disabled={streamState === 'streaming'}
                    className="w-full resize-none outline-none bg-transparent text-[13px] leading-relaxed placeholder-[#94a3b8] disabled:opacity-50"
                    style={{ color: '#334155', minHeight: 48, maxHeight: 160 }}
                    rows={2}
                  />
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-1 px-2.5 pb-2.5">
                  {/* Attachment */}
                  <button
                    onClick={handleAttachmentClick}
                    disabled={streamState === 'streaming'}
                    title="添加附件"
                    className="flex items-center justify-center w-7 h-7 rounded-[7px] transition-colors hover:bg-[#f1f5f9] disabled:opacity-40"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ color: '#b0b9c6' }}
                    >
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>

                  <div className="w-px h-3 mx-1" style={{ background: '#e8ecf0' }} />

                  {/* Tools badge + popover — agent 内置工具，排在 MCP 前面 */}
                  <div className="relative" ref={toolsPopoverRef}>
                    <button
                      onClick={() => {
                        const next = !showToolsPopover
                        setShowToolsPopover(next)
                        setShowMcpPopover(false)
                        if (next) loadAgentTools(currentAgentId)
                      }}
                      className="flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-medium transition-all"
                      style={{
                        background: showToolsPopover ? 'rgba(16,185,129,0.12)' : 'transparent',
                        color: showToolsPopover ? '#059669' : '#94a3b8',
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                      </svg>
                      Tools · {agentBuiltinTools.length}
                    </button>
                    {showToolsPopover && (
                      <div
                        className="absolute bottom-full left-0 mb-2 rounded-xl shadow-xl z-50 overflow-hidden"
                        style={{
                          width: 300,
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        }}
                      >
                        <div
                          className="flex items-center justify-between px-3 py-2.5 border-b"
                          style={{ borderColor: '#f1f5f9' }}
                        >
                          <div>
                            <div className="text-[11px] font-semibold" style={{ color: '#059669' }}>
                              内置工具
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                              {currentAgentName} 的内置工具
                            </div>
                          </div>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}
                          >
                            {agentBuiltinTools.length} 个
                          </span>
                        </div>
                        <div className="p-1.5 overflow-y-auto" style={{ maxHeight: 360 }}>
                          {agentBuiltinTools.map((t) => (
                            <div
                              key={t.name}
                              className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#f8fafc] transition-colors"
                            >
                              <div
                                className="flex items-center justify-center rounded-md shrink-0 mt-0.5"
                                style={{
                                  width: 20,
                                  height: 20,
                                  background:
                                    t.riskLevel === 'HIGH'
                                      ? 'rgba(239,68,68,0.08)'
                                      : 'rgba(16,185,129,0.08)',
                                }}
                              >
                                <svg
                                  width="10"
                                  height="10"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke={t.riskLevel === 'HIGH' ? '#ef4444' : '#059669'}
                                  strokeWidth="2.5"
                                >
                                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                                </svg>
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[12px] font-medium"
                                    style={{ color: '#334155' }}
                                  >
                                    {t.name}
                                  </span>
                                  {t.riskLevel === 'HIGH' && (
                                    <span
                                      className="text-[9px] px-1 py-0.5 rounded font-medium"
                                      style={{
                                        background: 'rgba(239,68,68,0.08)',
                                        color: '#ef4444',
                                      }}
                                    >
                                      HIGH
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="text-[11px] mt-0.5 line-clamp-2"
                                  style={{ color: '#94a3b8' }}
                                  title={t.description}
                                >
                                  {t.description}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* MCP badge + popover — agent 绑定的 MCP 工具 */}
                  <div className="relative" ref={mcpPopoverRef}>
                    <button
                      onClick={() => {
                        const next = !showMcpPopover
                        setShowMcpPopover(next)
                        setShowToolsPopover(false)
                        // MCP 比 UI mount 慢:按需刷新一次,确保用户看到最新工具列表
                        if (next) loadAgentTools(currentAgentId)
                      }}
                      className="flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-medium transition-all"
                      style={{
                        background: showMcpPopover ? 'rgba(99,102,241,0.12)' : 'transparent',
                        color: showMcpPopover ? '#6366f1' : '#94a3b8',
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                      </svg>
                      MCP{agentMcpTools.length > 0 ? ` · ${agentMcpTools.length}` : ''}
                    </button>
                    {showMcpPopover && (
                      <div
                        className="absolute bottom-full left-0 mb-2 rounded-xl shadow-xl z-50 overflow-hidden"
                        style={{
                          width: 320,
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                        }}
                      >
                        <div
                          className="flex items-center justify-between px-3 py-2.5 border-b"
                          style={{ borderColor: '#f1f5f9' }}
                        >
                          <div>
                            <div className="text-[11px] font-semibold" style={{ color: '#6366f1' }}>
                              MCP 工具
                            </div>
                            <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                              {currentAgentName} 绑定的 MCP 工具
                            </div>
                          </div>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
                            style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                          >
                            {agentMcpTools.length} 个
                          </span>
                        </div>
                        {agentMcpTools.length === 0 ? (
                          <div
                            className="px-3 py-6 text-center text-[11px]"
                            style={{ color: '#cbd5e1' }}
                          >
                            未配置 MCP Server
                          </div>
                        ) : (
                          <div className="overflow-y-auto py-1.5" style={{ maxHeight: 300 }}>
                            {Object.entries(
                              agentMcpTools.reduce<Record<string, typeof agentMcpTools>>(
                                (acc, t) => {
                                  const key = t.provider ?? '未知来源'
                                  ;(acc[key] ??= []).push(t)
                                  return acc
                                },
                                {},
                              ),
                            ).map(([provider, tools]) => {
                              const expanded = expandedMcpServers.has(provider)
                              const toggle = () =>
                                setExpandedMcpServers((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(provider)) next.delete(provider)
                                  else next.add(provider)
                                  return next
                                })
                              return (
                                <div key={provider}>
                                  <button
                                    onClick={toggle}
                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#f8fafc] transition-colors"
                                  >
                                    <div
                                      className="flex items-center justify-center rounded-md shrink-0"
                                      style={{
                                        width: 22,
                                        height: 22,
                                        background: 'rgba(99,102,241,0.12)',
                                      }}
                                    >
                                      <svg
                                        width="11"
                                        height="11"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="#6366f1"
                                        strokeWidth="2.5"
                                      >
                                        <rect x="2" y="2" width="20" height="8" rx="2" />
                                        <rect x="2" y="14" width="20" height="8" rx="2" />
                                        <line x1="6" y1="6" x2="6.01" y2="6" />
                                        <line x1="6" y1="18" x2="6.01" y2="18" />
                                      </svg>
                                    </div>
                                    <span
                                      className="text-[12px] font-semibold flex-1 text-left"
                                      style={{ color: '#334155' }}
                                    >
                                      {provider}
                                    </span>
                                    <span
                                      className="text-[10px] px-1.5 py-0.5 rounded"
                                      style={{
                                        background: 'rgba(99,102,241,0.08)',
                                        color: '#6366f1',
                                      }}
                                    >
                                      {tools.length} tools
                                    </span>
                                    <svg
                                      width="10"
                                      height="10"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="#94a3b8"
                                      strokeWidth="2.5"
                                      className="shrink-0 transition-transform"
                                      style={{
                                        transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                                      }}
                                    >
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                  {expanded && (
                                    <div
                                      className="ml-3 border-l mb-1"
                                      style={{ borderColor: '#e2e8f0' }}
                                    >
                                      {tools.map((t) => (
                                        <div
                                          key={t.name}
                                          className="flex items-start gap-2 py-1.5 pl-3 pr-3 hover:bg-[#f8fafc] transition-colors"
                                        >
                                          <svg
                                            width="10"
                                            height="10"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="#a5b4fc"
                                            strokeWidth="2.5"
                                            className="shrink-0 mt-0.5"
                                          >
                                            <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                                          </svg>
                                          <div className="min-w-0">
                                            <div
                                              className="text-[11px] font-medium"
                                              style={{ color: '#475569' }}
                                            >
                                              {t.name}
                                            </div>
                                            {t.description && (
                                              <div
                                                className="text-[10px] mt-0.5 line-clamp-1"
                                                style={{ color: '#94a3b8' }}
                                              >
                                                {t.description}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex-1" />

                  {/* Send / Stop */}
                  {streamState === 'streaming' ? (
                    <button
                      onClick={handleStop}
                      className="flex items-center justify-center rounded-[8px] transition-colors hover:opacity-90"
                      style={{ width: 30, height: 30, background: '#f1f5f9', color: '#64748b' }}
                      title="停止生成"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() && attachments.length === 0}
                      className="flex items-center justify-center rounded-[8px] transition-all hover:opacity-90 disabled:opacity-30"
                      style={{
                        width: 30,
                        height: 30,
                        background:
                          input.trim() || attachments.length > 0
                            ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                            : '#e2e8f0',
                        color: input.trim() || attachments.length > 0 ? '#ffffff' : '#94a3b8',
                      }}
                      title="发送 (Enter)"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{ marginLeft: 1 }}
                      >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* ── Empty state ── */
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
            <div className="text-center">
              <div
                className="flex items-center justify-center mx-auto mb-4 rounded-[16px]"
                style={{
                  width: 64,
                  height: 64,
                  background: 'rgba(59,130,246,0.08)',
                  border: '1px solid rgba(59,130,246,0.15)',
                }}
              >
                <span className="font-bold text-2xl" style={{ color: '#3b82f6' }}>
                  T
                </span>
              </div>
              <h2 className="text-[20px] font-semibold mb-2" style={{ color: '#334155' }}>
                开始新对话
              </h2>
              <p className="text-[13px]" style={{ color: '#94a3b8' }}>
                选择一个 Agent 或直接开始聊天
              </p>
            </div>

            {/* Agent quick cards */}
            <div className="flex flex-wrap gap-3 justify-center" style={{ maxWidth: 620 }}>
              <button
                onClick={handleCreateSession}
                className="flex items-center gap-3 rounded-[12px] p-4 transition-all hover:border-blue-300 hover:bg-blue-50"
                style={{
                  background: '#ffffff',
                  border: '0.5px solid #e2e8f0',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  width: 180,
                }}
              >
                <div
                  className="flex items-center justify-center rounded-[8px] text-[14px] font-bold shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    background: 'rgba(59,130,246,0.1)',
                    color: '#3b82f6',
                  }}
                >
                  T
                </div>
                <div className="text-left">
                  <div className="text-[12px] font-semibold" style={{ color: '#334155' }}>
                    Talor
                  </div>
                  <div className="text-[10px]" style={{ color: '#94a3b8' }}>
                    通用助手
                  </div>
                </div>
              </button>
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={async () => {
                    const { session_id } = await talorAPI.agents.createSession(a.id)
                    await loadSessions()
                    setCurrentSession(session_id)
                  }}
                  className="flex items-center gap-3 rounded-[12px] p-4 transition-all hover:border-blue-300 hover:bg-blue-50"
                  style={{
                    background: '#ffffff',
                    border: '0.5px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    width: 180,
                  }}
                >
                  <div
                    className="flex items-center justify-center rounded-[8px] text-[14px] font-bold shrink-0"
                    style={{
                      width: 32,
                      height: 32,
                      background: 'rgba(139,92,246,0.1)',
                      color: '#8b5cf6',
                    }}
                  >
                    {a.name.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div
                      className="text-[12px] font-semibold truncate"
                      style={{ color: '#334155', maxWidth: 100 }}
                    >
                      {a.name}
                    </div>
                    <div className="text-[10px]" style={{ color: '#94a3b8' }}>
                      {a.id}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Suggested prompts */}
            <div className="flex gap-3 flex-wrap justify-center">
              {['💡 帮我写一份项目总结', '📊 分析这份数据报表'].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    void handleCreateSession().then(() => setInput(p.replace(/^[^\s]+\s/, '')))
                  }}
                  className="px-4 py-2.5 rounded-[10px] text-[11px] transition-colors hover:bg-gray-50"
                  style={{ background: '#ffffff', border: '0.5px solid #e2e8f0', color: '#64748b' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {sessionToDelete && (
        <ConfirmDialog
          title="删除会话"
          message="确定要删除该会话吗？此操作不可恢复。"
          danger
          confirmLabel="删除"
          onConfirm={handleDeleteSession}
          onCancel={() => setSessionToDelete(null)}
        />
      )}
      {reviewProfile && ws.workbenchSessionId && (
        <DraftReviewModal
          open
          initialProfile={reviewProfile}
          workbenchSessionId={ws.workbenchSessionId}
          onClose={() => setReviewProfile(null)}
          onSaved={() => {
            void ws.refresh()
          }}
        />
      )}
      {previewAgentId && (
        <AgentPreviewModal
          open
          agentId={previewAgentId}
          onClose={() => setPreviewAgentId(null)}
          onStart={startAgentSession}
        />
      )}
      {/* ToolConfirmDialog 和 PermissionDialog 都已迁移到 PermissionsPopover
          内嵌卡片展示,授权 UX 统一为 popover。两个独立对话框组件源码保留,
          未来若引入全屏 agent 模式再复用。 */}
      {modelSwitchedToast && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[13px] text-white shadow-lg z-50 pointer-events-none"
          style={{ background: '#1e293b' }}
          data-testid="model-switched-toast"
        >
          已切换模型
        </div>
      )}
      {isDragging && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(59,130,246,0.06)', border: '3px dashed #3b82f6' }}
        >
          <div
            className="text-center rounded-2xl p-8 shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid #bfdbfe',
            }}
          >
            <div className="text-4xl mb-3">📎</div>
            <div className="text-[18px] font-semibold mb-1" style={{ color: '#1d4ed8' }}>
              拖放文件到此处
            </div>
            <div className="text-[13px]" style={{ color: '#64748b' }}>
              释放文件以添加为附件
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
