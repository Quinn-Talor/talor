// useCrystallizeWorkbench — manages the inline "Export as Agent" workbench
// session lifecycle (open / refresh / close) and the list of agents created
// from it. Per spec §B.9: this is an *inline* panel (not a separate route).
//
// State machine (spec §B.9.3):
//   closed → opening → open(+expanded|collapsed) → closing → closed
//
// 流式分片：hook 自己订阅 chat:stream 但只接收 session_id===workbenchSessionId
// 的事件，本地维护 streamingText/isStreaming，渲染端拼到末尾。这样工作台能
// 看到 token 级流式增量，而不污染 chatStore 全局状态（chatStore 仍由
// useStreamingMessage(currentSessionId) 独立持有）。
//
// Closing the panel does NOT delete the workbench session in the DB — the
// IPC just logs and the next open() can reuse the same workbench (so the
// user's iterative crystallizer dialog persists across sessions).

import { useCallback, useEffect, useState } from 'react'
import { talorAPI } from '../api/talorAPI'
import type {
  ChatMessage,
  ChatStreamEvent,
  ChatToolCallEvent,
  ChatToolResultEvent,
} from '../types/chat'

export interface GeneratedAgentEntry {
  id: string
  name: string
  created_at: string
}

export interface UseCrystallizeWorkbenchOpts {
  originSessionId: string | null | undefined
}

export interface CrystallizeWorkbenchState {
  isOpen: boolean
  isLoading: boolean
  workbenchSessionId: string | null
  workbenchMessages: ChatMessage[]
  generatedAgents: GeneratedAgentEntry[]
  /** 累积的流式 delta — done 时清空。空字符串表示无活跃流。 */
  streamingText: string
  /** true = LLM 正在向工作台 session 流式输出 */
  isStreaming: boolean
  open: () => Promise<void>
  close: () => Promise<void>
  refresh: () => Promise<void>
  removeAgent: (agentId: string) => Promise<void>
}

export function useCrystallizeWorkbench(
  opts: UseCrystallizeWorkbenchOpts,
): CrystallizeWorkbenchState {
  const { originSessionId } = opts
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [workbenchSessionId, setWorkbenchSessionId] = useState<string | null>(null)
  const [workbenchMessages, setWorkbenchMessages] = useState<ChatMessage[]>([])
  const [generatedAgents, setGeneratedAgents] = useState<GeneratedAgentEntry[]>([])
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const refresh = useCallback(async () => {
    if (!workbenchSessionId) return
    try {
      const [msgs, agents] = await Promise.all([
        talorAPI.session.getMessages(workbenchSessionId),
        talorAPI.agents.listFromWorkbench(workbenchSessionId),
      ])
      setWorkbenchMessages(msgs)
      setGeneratedAgents(agents)
    } catch (err) {
      console.error('[useCrystallizeWorkbench] refresh failed', err)
    }
  }, [workbenchSessionId])

  const open = useCallback(async () => {
    if (!originSessionId) return
    if (isOpen || isLoading) return
    setIsLoading(true)
    try {
      const result = await talorAPI.agents.startCrystallize(originSessionId)
      if (!result.success || !result.workbench_session_id) {
        throw new Error(result.error ?? 'startCrystallize failed (no workbench id)')
      }
      const wbId = result.workbench_session_id
      setWorkbenchSessionId(wbId)
      setIsOpen(true)

      // 不再自动触发 ReactLoop —— backend 已注入两条预置消息：
      //   1. user(snapshot)：S1 历史快照（折叠显示）
      //   2. assistant(welcome)：欢迎语 + 引导用户描述意图
      // 用户输入描述后才走标准 chat.send 触发 LLM。这样可控性优先于自动化。
      // (issue: 用户反馈"直接提取不可控")
      const [msgs, agents] = await Promise.all([
        talorAPI.session.getMessages(wbId),
        talorAPI.agents.listFromWorkbench(wbId),
      ])
      setWorkbenchMessages(msgs)
      setGeneratedAgents(agents)
    } catch (err) {
      console.error('[useCrystallizeWorkbench] open failed', err)
      // 让调用方决定 toast；hook 不直接弹
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [originSessionId, isOpen, isLoading])

  const close = useCallback(async () => {
    if (!workbenchSessionId) {
      setIsOpen(false)
      return
    }
    setIsLoading(true)
    try {
      await talorAPI.agents.finishCrystallize(workbenchSessionId)
    } catch (err) {
      // finish 失败不阻塞关闭 UI；DB 工作台仍在,下次 open 会复用。
      console.warn('[useCrystallizeWorkbench] finish failed (UI still closes)', err)
    } finally {
      setWorkbenchSessionId(null)
      setIsOpen(false)
      setWorkbenchMessages([])
      setGeneratedAgents([])
      setStreamingText('')
      setIsStreaming(false)
      setIsLoading(false)
    }
  }, [workbenchSessionId])

  const removeAgent = useCallback(
    async (agentId: string) => {
      if (!workbenchSessionId) return
      try {
        await talorAPI.agents.removeFromWorkbench(workbenchSessionId, agentId)
        setGeneratedAgents((prev) => prev.filter((a) => a.id !== agentId))
      } catch (err) {
        console.error('[useCrystallizeWorkbench] removeAgent failed', err)
        throw err
      }
    },
    [workbenchSessionId],
  )

  // 流式分片：订阅 session_id 匹配工作台的 chat:stream + tool-call + tool-result。
  // 当前 crystallizer scope=[] 实际不调用工具，但 tool 事件订阅做兜底 —— 若未来
  // profile 升级允许工具调用（例如 read 配置），UI 不至于看不到状态。
  // 工作台 token 级流式（streamingText）独立于 chatStore，避免污染原 session 状态。
  useEffect(() => {
    if (!workbenchSessionId) {
      setStreamingText('')
      setIsStreaming(false)
      return
    }
    const unsubStream = talorAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.session_id !== workbenchSessionId) return
      if (event.error_code) {
        // 流出错：清空增量缓冲；调用 refresh 拉到错误信封 message
        setStreamingText('')
        setIsStreaming(false)
        void refresh()
        return
      }
      if (event.delta) {
        setStreamingText((prev) => prev + event.delta)
        setIsStreaming(true)
      }
      if (event.done) {
        // 完成：refresh 把刚持久化的 assistant message 拉到 workbenchMessages 里，
        // 然后再清空 streamingText，避免"先消失再出现"的视觉断层。
        setIsStreaming(false)
        void refresh().then(() => setStreamingText(''))
      }
    })
    const unsubToolCall = talorAPI.chat.onToolCall((event: ChatToolCallEvent) => {
      if (event.session_id !== workbenchSessionId) return
      // 当前不渲染 tool 调用 UI（crystallizer scope=[] 不会触发）；保持 isStreaming
      // 让用户感知"还在跑"，message 落盘后由 done + refresh 拿到完整记录。
      setIsStreaming(true)
    })
    const unsubToolResult = talorAPI.chat.onToolResult((event: ChatToolResultEvent) => {
      if (event.session_id !== workbenchSessionId) return
      // 工具结果到 → 通过 refresh 拉到 messages 里（保证可审计性）。
      void refresh()
    })
    return () => {
      unsubStream()
      unsubToolCall()
      unsubToolResult()
    }
  }, [workbenchSessionId, refresh])

  // Auto-close when origin session changes (spec §B.9.4 F6)
  useEffect(() => {
    if (!isOpen) return
    // origin changed → close stale workbench
    void close()
    // we intentionally only react to originSessionId; close is stable per workbenchSessionId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originSessionId])

  return {
    isOpen,
    isLoading,
    workbenchSessionId,
    workbenchMessages,
    generatedAgents,
    streamingText,
    isStreaming,
    open,
    close,
    refresh,
    removeAgent,
  }
}
