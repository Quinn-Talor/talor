import { create } from 'zustand'
import type { ChatSession, ChatMessage, Attachment } from '../types/chat'

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  streamState: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  streamingContent: string
  error: { code: string; message: string } | null
  attachments: Attachment[]

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
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streamState: 'idle',
  streamingContent: '',
  error: null,
  attachments: [],

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ 
    currentSessionId: id, 
    streamState: 'idle', 
    streamingContent: '', 
    error: null,
    attachments: [] // 切换会话时清空附件
  }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendStreamingContent: (delta) => set((state) => ({ streamingContent: state.streamingContent + delta })),
  commitStreaming: (_messageId) => set({ streamState: 'idle', streamingContent: '', error: null }),
  setStreamState: (streamState) => set({ streamState }),
  setError: (error) => set({ error }),
  clearStreaming: () => set({ streamState: 'idle', streamingContent: '', error: null }),
  setAttachments: (attachments) => set({ attachments }),
  addAttachment: (attachment) => set((state) => ({ attachments: [...state.attachments, attachment] })),
  removeAttachment: (index) => set((state) => ({
    attachments: state.attachments.filter((_, i) => i !== index)
  })),
  clearAttachments: () => set({ attachments: [] }),
}))
