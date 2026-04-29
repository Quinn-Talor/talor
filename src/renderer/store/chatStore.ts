import { create } from 'zustand'
import type { ChatSession, ChatMessage, Attachment } from '../types/chat'
import type { ToolConfirmRequest } from '@shared/types/message'
import type { PermissionRequest } from '@shared/types/permissions'

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'done' | 'error' | 'timeout'
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  streamState: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  streamingContent: string
  error: { code: string; message: string } | null
  attachments: Attachment[]
  toolCalls: ToolCallEntry[]
  pendingToolConfirm: ToolConfirmRequest | null
  pendingPermission: PermissionRequest | null
  /**
   * 每当有新 permission request 到达时递增。PermissionsPopover 监听这个数字，
   * 自动展开弹窗让用户处理待授权请求。用计数器而非 boolean 是为了"同一个
   * request 来两次"也能再次触发（虽然当前 IPC 协议不会出现，但防守性设计）。
   */
  permissionAutoOpenTick: number

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (id: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  appendStreamingContent: (delta: string) => void
  commitStreaming: (messageId: string) => void
  setStreamState: (state: ChatState['streamState']) => void
  setError: (error: { code: string; message: string } | null) => void
  clearStreaming: () => void
  setAttachments: (attachments: Attachment[]) => void
  addAttachment: (attachment: Attachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  addToolCall: (entry: Omit<ToolCallEntry, 'status'>) => void
  updateToolResult: (toolCallId: string, result: unknown, status: 'done' | 'error' | 'timeout') => void
  clearToolCalls: () => void
  setPendingToolConfirm: (req: ToolConfirmRequest | null) => void
  setPendingPermission: (req: PermissionRequest | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streamState: 'idle',
  streamingContent: '',
  error: null,
  attachments: [],
  toolCalls: [],
  pendingToolConfirm: null,
  pendingPermission: null,
  permissionAutoOpenTick: 0,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ 
    currentSessionId: id, 
    streamState: 'idle', 
    streamingContent: '', 
    error: null,
    attachments: [],
    toolCalls: [],
  }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendStreamingContent: (delta) => set((state) => ({ streamingContent: state.streamingContent + delta })),
  commitStreaming: (_messageId) => set({ streamState: 'done', streamingContent: '', error: null, toolCalls: [] }),
  setStreamState: (streamState) => set({ streamState }),
  setError: (error) => set({ error }),
  clearStreaming: () => set({ streamState: 'idle', streamingContent: '', error: null }),
  setAttachments: (attachments) => set({ attachments }),
  addAttachment: (attachment) => set((state) => ({ attachments: [...state.attachments, attachment] })),
  removeAttachment: (index) => set((state) => ({
    attachments: state.attachments.filter((_, i) => i !== index)
  })),
  clearAttachments: () => set({ attachments: [] }),
  addToolCall: (entry) => set((state) => ({
    toolCalls: [...state.toolCalls, { ...entry, status: 'pending' as const }],
  })),
  updateToolResult: (toolCallId, result, status) => set((state) => ({
    toolCalls: state.toolCalls.map((tc) =>
      tc.toolCallId === toolCallId ? { ...tc, result, status } : tc
    ),
  })),
  clearToolCalls: () => set({ toolCalls: [] }),
  setPendingToolConfirm: (req) => set({ pendingToolConfirm: req }),
  setPendingPermission: (req) => set(state => ({
    pendingPermission: req,
    // 只有从 null → 非 null 时才 bump tick（auto-open 触发）；清空不触发。
    permissionAutoOpenTick: req !== null ? state.permissionAutoOpenTick + 1 : state.permissionAutoOpenTick,
  })),
}))
