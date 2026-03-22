import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '../store/chatStore'
import type { ChatStreamEvent } from '../types/chat'
import { talorAPI } from '../api/talorAPI'

export function useStreamingMessage(sessionId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<ChatStreamEvent[]>([])

  const {
    appendStreamingContent,
    commitStreaming,
    setStreamState,
    setError,
  } = useChatStore()

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return
    const pending = pendingRef.current
    pendingRef.current = []

    for (const event of pending) {
      if (event.error_code) {
        if (event.delta) {
          appendStreamingContent(event.delta)
        }
        setError({ code: event.error_code, message: event.error_message ?? '' })
        setStreamState('error')
        timerRef.current = null
        return
      }
      if (event.delta) {
        appendStreamingContent(event.delta)
      }
      if (event.done) {
        commitStreaming(event.message_id)
      }
    }

    if (pending.some(e => !e.done && e.delta)) {
      setStreamState('streaming')
    }

    timerRef.current = null
  }, [appendStreamingContent, commitStreaming, setStreamState, setError])

  useEffect(() => {
    if (!sessionId) return

    const unsubscribe = talorAPI.chat.onStream((event: ChatStreamEvent) => {
      if (event.session_id !== sessionId) return
      pendingRef.current.push(event)

      if (timerRef.current === null) {
        timerRef.current = setTimeout(flushPending, 0)
      }
    })

    return () => {
      unsubscribe()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [sessionId, flushPending])
}
