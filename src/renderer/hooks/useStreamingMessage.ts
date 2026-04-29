import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import type { ChatStreamEvent, ChatToolCallEvent, ChatToolResultEvent } from '../types/chat'
import type { ToolConfirmRequest } from '@shared/types/message'
import type { PermissionRequest } from '@shared/types/permissions'
import { talorAPI } from '../api/talorAPI'

export function useStreamingMessage(sessionId: string | null) {
  useEffect(() => {
    if (!sessionId) return

    const store = useChatStore.getState()
    store.clearToolCalls()

    const unsubscribeStream = talorAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.session_id !== sessionId) return
      const s = useChatStore.getState()

      if (event.error_code) {
        if (event.delta) s.appendStreamingContent(event.delta)
        s.setError({ code: event.error_code, message: event.error_message ?? '' })
        s.setStreamState('error')
        return
      }

      if (event.delta) {
        s.appendStreamingContent(event.delta)
        s.setStreamState('streaming')
      }

      if (event.done) {
        // Defer commit by one tick so React renders the final delta before
        // commitStreaming clears streamingContent.
        const messageId = event.message_id
        setTimeout(() => useChatStore.getState().commitStreaming(messageId), 0)
      }
    })

    const unsubscribeToolCall = talorAPI.chat.onToolCall((event: ChatToolCallEvent) => {
      if (event.session_id !== sessionId) return
      const s = useChatStore.getState()
      s.addToolCall({
        toolCallId: event.tool_call_id,
        toolName: event.tool_name,
        input: event.input,
      })
      s.setStreamState('streaming')
    })

    const unsubscribeToolResult = talorAPI.chat.onToolResult((event: ChatToolResultEvent) => {
      if (event.session_id !== sessionId) return
      useChatStore.getState().updateToolResult(event.tool_call_id, event.result, 'done')
    })

    const unsubscribeToolConfirm = talorAPI.chat.onToolConfirm((event: ToolConfirmRequest) => {
      if (event.sessionId !== sessionId) return
      useChatStore.getState().setPendingToolConfirm(event)
    })

    const unsubscribePermission = talorAPI.chat.onPermissionRequest((event: PermissionRequest) => {
      // PermissionRequest 不带 sessionId——第一版允许当前主界面直接接所有请求。
      useChatStore.getState().setPendingPermission(event)
    })

    return () => {
      unsubscribeStream()
      unsubscribeToolCall()
      unsubscribeToolResult()
      unsubscribeToolConfirm()
      unsubscribePermission()
    }
  }, [sessionId])
}
