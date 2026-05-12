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
  startedAt: number
  durationMs?: number
}

export type StreamItem =
  | { type: 'text'; stepIndex: number; content: string }
  | { type: 'tool_call'; stepIndex: number; entry: ToolCallEntry }

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  streamState: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  streamItems: StreamItem[]
  error: { code: string; message: string } | null
  attachments: Attachment[]
  pendingToolConfirm: ToolConfirmRequest | null
  pendingPermission: PermissionRequest | null
  permissionAutoOpenTick: number

  setSessions: (sessions: ChatSession[]) => void
  setCurrentSession: (id: string | null) => void
  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  appendStreamText: (stepIndex: number, delta: string) => void
  addToolCall: (entry: Omit<ToolCallEntry, 'status'> & { stepIndex: number }) => void
  updateToolResult: (
    toolCallId: string,
    result: unknown,
    status: 'done' | 'error' | 'timeout',
    durationMs?: number,
  ) => void
  commitStreaming: (messageId: string) => void
  /**
   * v3.6: 清掉 streamItems 中 stepIndex <= persistedStepIndex 的项。
   *
   * 调用时机: 收到 chat:message-persisted 事件时,主进程已把这一步的
   * assistant + tool 消息落库, renderedMessages 会渲染 ToolCallMessage,
   * 此时这步对应的 streamItems 必须清掉,否则 ToolCallLog 会再渲染一遍
   * 同样的工具调用列表 (1:1 视觉重复 — 旧 polling 版本因为间隔大不显眼,
   * 事件驱动版本一落库立刻 reload 暴露此 bug)。
   *
   * 不影响仍在跑的 step (stepIndex > persistedStepIndex 保留)。
   */
  dropStreamItemsUpToStep: (persistedStepIndex: number) => void
  setStreamState: (state: ChatState['streamState']) => void
  setError: (error: { code: string; message: string } | null) => void
  clearStreaming: () => void
  setAttachments: (attachments: Attachment[]) => void
  addAttachment: (attachment: Attachment) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  setPendingToolConfirm: (req: ToolConfirmRequest | null) => void
  setPendingPermission: (req: PermissionRequest | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streamState: 'idle',
  streamItems: [],
  error: null,
  attachments: [],
  pendingToolConfirm: null,
  pendingPermission: null,
  permissionAutoOpenTick: 0,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) =>
    set({
      currentSessionId: id,
      streamState: 'idle',
      streamItems: [],
      error: null,
      attachments: [],
    }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),

  appendStreamText: (stepIndex, delta) =>
    set((state) => {
      const items = [...state.streamItems]
      const last = items[items.length - 1]
      if (last && last.type === 'text' && last.stepIndex === stepIndex) {
        items[items.length - 1] = { ...last, content: last.content + delta }
      } else {
        items.push({ type: 'text', stepIndex, content: delta })
      }
      return { streamItems: items }
    }),

  addToolCall: ({ stepIndex, ...entry }) =>
    set((state) => ({
      streamItems: [
        ...state.streamItems,
        { type: 'tool_call', stepIndex, entry: { ...entry, status: 'pending' as const } },
      ],
    })),

  updateToolResult: (toolCallId, result, status, durationMs) =>
    set((state) => {
      let matched = false
      const next = state.streamItems.map((item) => {
        if (item.type !== 'tool_call') return item
        if (item.entry.toolCallId !== toolCallId) return item
        matched = true
        return { ...item, entry: { ...item.entry, result, status, durationMs } }
      })
      if (!matched) {
        // 防御：tool-result 在 tool-call 之前到达，或工具调用 ID 不一致都会卡 spinner。
        // 至少留一条警告便于排查。
        console.warn('[chatStore] tool-result for unknown toolCallId:', toolCallId)
      }
      return { streamItems: next }
    }),

  commitStreaming: (_messageId) => set({ streamState: 'done', streamItems: [], error: null }),
  dropStreamItemsUpToStep: (persistedStepIndex) =>
    set((state) => ({
      streamItems: state.streamItems.filter((it) => it.stepIndex > persistedStepIndex),
    })),
  setStreamState: (streamState) => set({ streamState }),
  setError: (error) => set({ error }),
  clearStreaming: () => set({ streamState: 'idle', streamItems: [], error: null }),
  setAttachments: (attachments) => set({ attachments }),
  addAttachment: (attachment) =>
    set((state) => ({ attachments: [...state.attachments, attachment] })),
  removeAttachment: (index) =>
    set((state) => ({
      attachments: state.attachments.filter((_, i) => i !== index),
    })),
  clearAttachments: () => set({ attachments: [] }),
  setPendingToolConfirm: (req) =>
    set((state) => ({
      pendingToolConfirm: req,
      permissionAutoOpenTick:
        req !== null ? state.permissionAutoOpenTick + 1 : state.permissionAutoOpenTick,
    })),
  setPendingPermission: (req) =>
    set((state) => ({
      pendingPermission: req,
      permissionAutoOpenTick:
        req !== null ? state.permissionAutoOpenTick + 1 : state.permissionAutoOpenTick,
    })),
}))
