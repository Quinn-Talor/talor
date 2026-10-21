import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import type { ChatStreamEvent, ChatToolCallEvent, ChatToolResultEvent } from '../types/chat'
import { talorAPI } from '../api/talorAPI'

/**
 * 订阅当前 session 的流事件(文本增量 / 工具调用 / 工具结果)写入 chatStore。
 *
 * 只接收属于该 session 进行中轮次的事件(claimTurnEvent 按 message_id 过滤),
 * 已停止或已被取代的轮次的迟到事件不会改写当前展示。
 * 工具确认 / 授权请求不在这里订阅 —— 见 usePendingApprovals(App 层,跨页面存活)。
 */
export function useStreamingMessage(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return

    const unsubscribeStream = talorAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.session_id !== sessionId) return
      const s = useChatStore.getState()
      if (!s.claimTurnEvent(sessionId, event.message_id)) return

      if (event.error_code) {
        if (event.delta) s.appendStreamText(event.step_index, event.delta)
        s.setError({ code: event.error_code, message: event.error_message ?? '' })
        s.setStreamState('error')
        return
      }

      if (event.delta) {
        s.appendStreamText(event.step_index, event.delta)
        s.setStreamState('streaming')
      }

      if (event.done) {
        const messageId = event.message_id
        setTimeout(() => useChatStore.getState().commitStreaming(messageId), 0)
      }
    })

    const unsubscribeToolCall = talorAPI.chat.onToolCall((event: ChatToolCallEvent) => {
      if (event.session_id !== sessionId) return
      const s = useChatStore.getState()
      if (!s.claimTurnEvent(sessionId, event.message_id)) return
      s.addToolCall({
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        input: event.input,
        stepIndex: event.step_index,
        startedAt: event.started_at,
      })
      s.setStreamState('streaming')
    })

    const unsubscribeToolResult = talorAPI.chat.onToolResult((event: ChatToolResultEvent) => {
      if (event.session_id !== sessionId) return
      const s = useChatStore.getState()
      if (!s.claimTurnEvent(sessionId, event.message_id)) return
      s.updateToolResult(
        event.tool_call_id,
        event.result,
        event.is_error ? 'error' : 'done',
        event.duration_ms,
      )
    })

    return () => {
      unsubscribeStream()
      unsubscribeToolCall()
      unsubscribeToolResult()
    }
  }, [sessionId])
}
