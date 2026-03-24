import { useEffect, useState, useRef } from 'react'
import { useChatStore } from '../../store/chatStore'
import { useStreamingMessage } from '../../hooks/useStreamingMessage'
import { talorAPI } from '../../api/talorAPI'
import { MessageBubble } from '../../components/MessageBubble'
import { SessionItem } from '../../components/SessionItem'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { AttachmentPreview } from '../../components/AttachmentPreview'
import { WorkspaceSelector } from '../../components/WorkspaceSelector'
import { ToolCallLog } from '../../components/ToolCallLog'
import type { Attachment } from '../../types/chat'
import type { ModelInfo } from '../../types/models'

interface ModelOption {
  id: string
  displayName: string
  providerName: string
  supportsVision: boolean
}

export function ChatPage() {
  const {
    sessions,
    currentSessionId,
    messages,
    streamState,
    streamingContent,
    error,
    attachments,
    setSessions,
    setCurrentSession,
    setMessages,
    addMessage,
    clearStreaming,
    clearToolCalls,
    setAttachments,
    removeAttachment,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined)
  const [currentWorkspace, setCurrentWorkspace] = useState<string | undefined>(undefined)
  const [modelSwitchedToast, setModelSwitchedToast] = useState(false)
  const [modelUnavailable, setModelUnavailable] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  useStreamingMessage(currentSessionId)

  const loadSessions = async () => {
    try {
      const data = await talorAPI.session.list()
      setSessions(data)
    } catch (e) {
      console.error('Failed to load sessions', e)
    }
  }

  const loadMessages = async (sessionId: string) => {
    try {
      const data = await talorAPI.session.getMessages(sessionId)
      setMessages(data)
    } catch (e) {
      console.error('Failed to load messages', e)
    }
  }

  const loadModelOptions = async () => {
    try {
      const providers = await talorAPI.providers.list()
      const options: ModelOption[] = []
      for (const provider of providers) {
        const response = await talorAPI.providers.getModels(provider.id)
        for (const model of response.models) {
          options.push({
            id: model.id,
            displayName: (model as ModelInfo).display_name || (model as ModelInfo).name,
            providerName: provider.name,
            supportsVision: (model as ModelInfo).supports_vision ?? false,
          })
        }
      }
      setModelOptions(options)
    } catch (e) {
      console.error('Failed to load model options', e)
    }
  }

  useEffect(() => {
    loadSessions()
    loadModelOptions()
  }, [])

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId)
      const session = sessions.find(s => s.id === currentSessionId)
      setCurrentModelId(session?.model_id)
      setCurrentWorkspace(session?.workspace ?? undefined)
      setModelUnavailable(false)
      if (session?.model_id) {
        talorAPI.session.checkModelAvailability({ session_id: currentSessionId }).then(result => {
          if (!result.available) setModelUnavailable(true)
        }).catch(() => {})
      }
    } else {
      setMessages([])
      setCurrentModelId(undefined)
      setCurrentWorkspace(undefined)
      setModelUnavailable(false)
    }
  }, [currentSessionId])

  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId)
      setCurrentModelId(session?.model_id)
      setCurrentWorkspace(session?.workspace ?? undefined)
    }
  }, [sessions, currentSessionId])

  useEffect(() => {
    if (streamState === 'done') {
      if (currentSessionId) {
        loadMessages(currentSessionId)
      }
    }
  }, [streamState, currentSessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent, streamState])

  // Dev-only test hook: allows Playwright to inject attachments for Layer 2 verification
  useEffect(() => {
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__test_setAttachments = setAttachments
    }
    return () => {
      if (import.meta.env.DEV) {
        delete (window as unknown as Record<string, unknown>).__test_setAttachments
      }
    }
  }, [setAttachments])

  // Close model picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false)
      }
    }
    if (showModelPicker) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showModelPicker])

  const handleCreateSession = async () => {
    try {
      const providers = await talorAPI.providers.list()
      const defaultProvider = providers.find(p => p.is_default) || providers[0]
      if (!defaultProvider) {
        console.error('No providers configured')
        return
      }
      const session = await talorAPI.session.create({ provider_id: defaultProvider.id })
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
      const updated = await talorAPI.session.updateModel({ session_id: currentSessionId, model_id: modelId })
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

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return
    try {
      await talorAPI.session.delete(sessionToDelete)
      await loadSessions()
      if (currentSessionId === sessionToDelete) {
        setCurrentSession(null)
      }
    } catch (e) {
      console.error('Failed to delete session', e)
    } finally {
      setSessionToDelete(null)
    }
  }

  const handleSend = async () => {
    if ((!input.trim() && attachments.length === 0) || !currentSessionId || streamState === 'streaming') return

    const content = input.trim()
    setInput('')
    clearStreaming()
    clearToolCalls()

    addMessage({
      id: `temp-${Date.now()}`,
      session_id: currentSessionId,
      role: 'user',
      content,
      created_at: new Date().toISOString(),
    })
    
    try {
      await talorAPI.chat.send({ 
        session_id: currentSessionId, 
        content,
        attachments: attachments.length > 0 ? attachments : undefined
      })
      setAttachments([]) // Clear attachments after sending
      await loadMessages(currentSessionId)
    } catch (e) {
      console.error('Send error:', e)
      
      // 处理附件验证错误
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (errorMessage.includes('FILE_TOO_LARGE')) {
        alert('文件大小超过限制（最大 50MB）')
      } else if (errorMessage.includes('UNSUPPORTED_FILE_TYPE')) {
        alert('不支持的文件类型。支持：PNG、JPG、GIF、WebP、PDF、TXT、MD、JSON、CSV')
      } else if (errorMessage.includes('FILE_NOT_FOUND')) {
        alert('文件不存在或无法访问')
      } else if (errorMessage.includes('PROVIDER_NO_VISION')) {
        alert('当前模型提供商不支持图片识别，请更换支持视觉的模型（如 GPT-4 Vision、Claude 3.5 Sonnet）')
      } else {
        // 其他错误
        alert(`发送失败: ${errorMessage}`)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStop = async () => {
    if (currentSessionId) {
      try {
        await talorAPI.chat.abort(currentSessionId)
        clearToolCalls()
      } catch (e) {
        console.error('Failed to abort:', e)
      }
    }
  }

  const handleAttachmentClick = async () => {
    if (streamState === 'streaming') return
    
    try {
      const filePaths = await talorAPI.file.openDialog({
        title: '选择文件',
        filters: [
          { name: '所有文件', extensions: ['*'] },
          { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'] },
          { name: '文档', extensions: ['pdf', 'txt', 'md', 'doc', 'docx'] },
          { name: '代码', extensions: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'go', 'rs'] },
        ],
        properties: ['openFile', 'multiSelections']
      })

      if (!filePaths || filePaths.length === 0) {
        return
      }

      const newAttachments: Attachment[] = []
      for (const filePath of filePaths) {
        try {
          const exists = attachments.some(a => a.path === filePath)
          if (exists) {
            console.warn(`文件已添加: ${filePath}`)
            continue
          }

          // 使用 IPC 获取文件信息（更安全的方式）
          // 注意：需要先实现 file:getAttachments IPC handler
          // 暂时使用基本文件信息
          const filename = filePath.split(/[\\/]/).pop() || filePath
          
          newAttachments.push({
            path: filePath,
            mime_type: 'application/octet-stream', // 暂时使用通用类型
            filename,
            size_bytes: 0, // 暂时设为 0，后续通过 IPC 获取
          })
        } catch (error) {
          console.error(`无法读取文件 ${filePath}:`, error)
        }
      }

      if (newAttachments.length > 0) {
        setAttachments([...attachments, ...newAttachments])
      }
    } catch (e) {
      console.error('打开文件对话框失败:', e)
      alert(`无法选择文件: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleRemoveAttachment = (index: number) => {
    removeAttachment(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (streamState !== 'streaming') {
      setIsDragging(true)
    }
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

    if (streamState === 'streaming') {
      return
    }

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    const newAttachments: Attachment[] = []
    for (const file of files) {
      try {
        const filePath = (file as any).path || file.name
        const exists = attachments.some(a => a.path === filePath)
        if (exists) {
          console.warn(`文件已添加: ${filePath}`)
          continue
        }

        const filename = file.name
        const mimeType = file.type || 'application/octet-stream'
        
        newAttachments.push({
          path: filePath,
          mime_type: mimeType,
          filename,
          size_bytes: file.size,
        })
      } catch (error) {
        console.error(`无法处理文件:`, error)
      }
    }

    if (newAttachments.length > 0) {
      setAttachments([...attachments, ...newAttachments])
    }
  }

  const currentModelName = currentModelId
    ? (modelOptions.find(m => m.id === currentModelId)?.displayName ?? currentModelId.split('/').pop() ?? currentModelId)
    : '选择模型'

  return (
    <div 
      className="flex h-full w-full bg-white overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-60 border-r border-gray-200 flex flex-col bg-gray-50/50">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="font-semibold text-gray-700">会话</h2>
          <button 
            onClick={handleCreateSession}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-600 transition-colors"
            title="新建会话"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 text-center">暂无会话</div>
          ) : (
            sessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={session.id === currentSessionId}
                onClick={() => setCurrentSession(session.id)}
                onDelete={() => setSessionToDelete(session.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 bg-white relative">
        {currentSessionId ? (
          <>
            {modelUnavailable && (
              <div
                className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm"
                data-testid="model-unavailable-banner"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span className="flex-1">模型不可用 — 该模型已无法使用</span>
                <button
                  onClick={() => setShowModelPicker(true)}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-medium transition-colors"
                  data-testid="select-other-model-btn"
                >
                  选择其他模型
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
              {messages.length === 0 && streamState !== 'streaming' ? (
                <div className="h-full flex items-center justify-center text-gray-400">
                  <div className="text-center">
                    <div className="mb-2">👋</div>
                    <p>在下方输入消息开始对话</p>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} />
                  ))}
                  {streamState === 'streaming' && (
                    <ToolCallLog />
                  )}
                  {streamState === 'streaming' && streamingContent && (
                    <MessageBubble 
                      message={{ role: 'assistant', content: streamingContent }} 
                      isStreaming={true} 
                    />
                  )}
                  {streamState === 'error' && error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm border border-red-100 flex items-start gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <div>
                        <span className="font-semibold block">{error.code}</span>
                        <span>{error.message}</span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-white">
              {/* Attachment preview area */}
              {attachments.length > 0 && (
                <div className="max-w-4xl mx-auto mb-3 flex flex-wrap gap-2">
                  {attachments.map((attachment, index) => (
                    <AttachmentPreview
                      key={index}
                      attachment={attachment}
                      onRemove={() => handleRemoveAttachment(index)}
                      compact={true}
                    />
                  ))}
                </div>
              )}
              
              <div className="max-w-4xl mx-auto flex items-stretch gap-2">
                {currentSessionId && (
                  <WorkspaceSelector
                    sessionId={currentSessionId}
                    workspace={currentWorkspace}
                    onWorkspaceChange={(ws) => {
                      setCurrentWorkspace(ws)
                      loadSessions()
                    }}
                    disabled={streamState === 'streaming'}
                  />
                )}

                <div className="flex-1 flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl p-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all">
                {/* Attachment button */}
                <button
                  onClick={handleAttachmentClick}
                  className="p-2 h-10 w-10 flex items-center justify-center text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors shrink-0"
                  title="添加附件"
                  disabled={streamState === 'streaming'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>

                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行"
                  className="flex-1 max-h-32 min-h-[40px] bg-transparent resize-none outline-none text-sm p-2"
                  rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length, 5) : 1}
                  disabled={streamState === 'streaming'}
                />
                
                {/* Model picker */}
                <div className="relative shrink-0" ref={modelPickerRef}>
                  <button
                    onClick={() => setShowModelPicker(prev => !prev)}
                    className="flex items-center gap-1 px-2 py-1.5 h-10 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors max-w-[120px]"
                    title="切换模型"
                    data-testid="model-picker-trigger"
                  >
                    <span className="truncate">{currentModelName}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </button>
                  {showModelPicker && (
                    <div
                      className="absolute bottom-full right-0 mb-1 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden"
                      data-testid="model-picker-dropdown"
                    >
                      <div className="p-2 border-b border-gray-100">
                        <p className="text-xs text-gray-500 px-1">选择模型</p>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {modelOptions.length === 0 ? (
                          <p className="text-xs text-gray-400 px-3 py-4 text-center">加载模型...</p>
                        ) : (
                          modelOptions.map(option => (
                            <button
                              key={option.id}
                              onClick={() => handleModelChange(option.id)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                option.id === currentModelId
                                  ? 'bg-blue-50 text-blue-700'
                                  : 'text-gray-700 hover:bg-gray-100'
                              }`}
                              data-testid={`model-option-${option.id}`}
                            >
                              <div className="font-medium truncate">{option.displayName}</div>
                              <div className="text-xs text-gray-400 truncate">{option.providerName}</div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {streamState === 'streaming' ? (
                  <button
                    onClick={handleStop}
                    className="p-2 h-10 w-10 flex items-center justify-center bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors shrink-0"
                    title="停止生成"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    </svg>
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && attachments.length === 0}
                    className="p-2 h-10 w-10 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500 text-white rounded-lg transition-colors shrink-0"
                    title="发送"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                )}
              </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState message="选择左侧会话或新建一个对话" />
          </div>
        )}
      </div>

      {sessionToDelete && (
        <ConfirmDialog
          title="删除会话"
          message="确定要删除该会话吗？此操作不可恢复。"
          danger={true}
          confirmLabel="删除"
          onConfirm={handleDeleteSession}
          onCancel={() => setSessionToDelete(null)}
        />
      )}

      {modelSwitchedToast && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 pointer-events-none"
          data-testid="model-switched-toast"
        >
          已切换模型
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 border-4 border-dashed border-blue-400 rounded-lg z-50 flex items-center justify-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-xl p-8 shadow-2xl border border-blue-200 max-w-md text-center">
            <div className="text-4xl mb-4">📎</div>
            <div className="text-xl font-semibold text-blue-700 mb-2">拖放文件到此处</div>
            <div className="text-gray-600">释放文件以添加为附件</div>
            <div className="text-sm text-gray-500 mt-4">支持图片、文档、代码文件等</div>
          </div>
        </div>
      )}
    </div>
  )
}
