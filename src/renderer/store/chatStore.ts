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

/**
 * 一次 chat:send 在渲染端的生命周期:发起时建立,chat:send 返回时移除。
 *
 * 主进程在整轮结束后才返回 chat:send,首个流事件之前(推理模型可能几十秒)
 * 渲染端拿不到 message_id,所以 messageId 由首个流事件锁定;此后只认这一轮的事件。
 */
export interface ActiveTurn {
  messageId: string | null
  /** 用户已点停止:该轮余下事件全部丢弃,直到 chat:send 返回 */
  stopped: boolean
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: ChatMessage[]
  streamState: 'idle' | 'streaming' | 'done' | 'error' | 'aborted'
  streamItems: StreamItem[]
  error: { code: string; message: string } | null
  attachments: Attachment[]
  /** 进行中的轮次,按 session id 索引(同一 session 同时至多一轮) */
  turns: Record<string, ActiveTurn>
  /** 待确认的高风险工具调用,按到达顺序;并行工具调用各占一项 */
  toolConfirmQueue: ToolConfirmRequest[]
  /** 待授权请求,按到达顺序 */
  permissionQueue: PermissionRequest[]

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
  /** 收到某轮的 done 事件:仅当它属于当前 session 正在展示的这一轮时收尾 */
  commitStreaming: (messageId: string) => void
  /**
   * 清掉 streamItems 中 stepIndex <= persistedStepIndex 的项。
   *
   * 调用时机: 收到 chat:message-persisted 事件且 messages 已重新拉取后。
   * 此时这一步已由持久化消息渲染,对应的 streamItems 必须清掉,否则
   * ToolCallLog 会再渲染一遍同样的工具调用列表。
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

  /** 发起一轮:立即进入 streaming(当前 session),不等首个事件 */
  beginTurn: (sessionId: string) => void
  /** chat:send 返回:移除轮次;若当前 session 仍停在 streaming(done 事件未被接收),收尾为 done */
  finishTurn: (sessionId: string) => void
  /** 用户停止:标记轮次已停止,界面回到 idle */
  stopTurn: (sessionId: string) => void
  /**
   * 判断一条流事件是否属于该 session 正在进行的轮次,首个事件时锁定 messageId。
   * 无进行中轮次时(例如本页面重新挂载前发起的轮次)放行。
   */
  claimTurnEvent: (sessionId: string, messageId: string) => boolean

  enqueueToolConfirm: (req: ToolConfirmRequest) => void
  removeToolConfirm: (toolCallId: string) => void
  /** 取出并移除某轮(含子 session)的全部待确认请求 */
  takeToolConfirmsForRoot: (rootSessionId: string) => ToolConfirmRequest[]
  takePermissionsForRoot: (rootSessionId: string) => PermissionRequest[]
  enqueuePermission: (req: PermissionRequest) => void
  removePermission: (requestId: string) => void
}

/** 确认请求所属的轮次 session:入口层补的 rootSessionId,缺省时回退发起 session */
export function rootSessionOf(req: ToolConfirmRequest): string {
  return req.rootSessionId ?? req.sessionId
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streamState: 'idle',
  streamItems: [],
  error: null,
  attachments: [],
  turns: {},
  toolConfirmQueue: [],
  permissionQueue: [],

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) =>
    set((state) => {
      if (id === state.currentSessionId) return state
      const turn = id ? state.turns[id] : undefined
      return {
        currentSessionId: id,
        streamState: turn && !turn.stopped ? 'streaming' : 'idle',
        streamItems: [],
        error: null,
        attachments: [],
      }
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

  commitStreaming: (messageId) =>
    set((state) => {
      const turn = state.currentSessionId ? state.turns[state.currentSessionId] : undefined
      if (turn && (turn.stopped || (turn.messageId !== null && turn.messageId !== messageId))) {
        return state
      }
      return { streamState: 'done', streamItems: [], error: null }
    }),
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

  beginTurn: (sessionId) =>
    set((state) => {
      const turns = { ...state.turns, [sessionId]: { messageId: null, stopped: false } }
      if (sessionId !== state.currentSessionId) return { turns }
      return { turns, streamState: 'streaming', streamItems: [], error: null }
    }),
  finishTurn: (sessionId) =>
    set((state) => {
      if (!state.turns[sessionId]) return state
      const turns = { ...state.turns }
      delete turns[sessionId]
      if (sessionId === state.currentSessionId && state.streamState === 'streaming') {
        return { turns, streamState: 'done', streamItems: [] }
      }
      return { turns }
    }),
  stopTurn: (sessionId) =>
    set((state) => {
      const turn = state.turns[sessionId]
      const turns = turn ? { ...state.turns, [sessionId]: { ...turn, stopped: true } } : state.turns
      if (sessionId !== state.currentSessionId) return { turns }
      return { turns, streamState: 'idle', streamItems: [], error: null }
    }),
  claimTurnEvent: (sessionId, messageId) => {
    const turn = get().turns[sessionId]
    if (!turn) return true
    if (turn.stopped) return false
    if (turn.messageId === null) {
      set((state) => ({ turns: { ...state.turns, [sessionId]: { ...turn, messageId } } }))
      return true
    }
    return turn.messageId === messageId
  },

  enqueueToolConfirm: (req) =>
    set((state) =>
      state.toolConfirmQueue.some((r) => r.toolCallId === req.toolCallId)
        ? state
        : { toolConfirmQueue: [...state.toolConfirmQueue, req] },
    ),
  removeToolConfirm: (toolCallId) =>
    set((state) => ({
      toolConfirmQueue: state.toolConfirmQueue.filter((r) => r.toolCallId !== toolCallId),
    })),
  takeToolConfirmsForRoot: (rootSessionId) => {
    const taken = get().toolConfirmQueue.filter((r) => rootSessionOf(r) === rootSessionId)
    if (taken.length > 0) {
      set((state) => ({
        toolConfirmQueue: state.toolConfirmQueue.filter((r) => rootSessionOf(r) !== rootSessionId),
      }))
    }
    return taken
  },
  enqueuePermission: (req) =>
    set((state) =>
      state.permissionQueue.some((r) => r.requestId === req.requestId)
        ? state
        : { permissionQueue: [...state.permissionQueue, req] },
    ),
  takePermissionsForRoot: (rootSessionId) => {
    const taken = get().permissionQueue.filter((r) => r.rootSessionId === rootSessionId)
    if (taken.length > 0) {
      set((state) => ({
        permissionQueue: state.permissionQueue.filter((r) => r.rootSessionId !== rootSessionId),
      }))
    }
    return taken
  },
  removePermission: (requestId) =>
    set((state) => ({
      permissionQueue: state.permissionQueue.filter((r) => r.requestId !== requestId),
    })),
}))
