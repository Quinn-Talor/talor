import { useSessionStore } from '../store/sessionStore'
import { MessageList } from './MessageList'

export function ChatView() {
  const { currentSessionId, sessions } = useSessionStore()
  const currentSession = sessions.find(s => s.id === currentSessionId)

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Select a session to start
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b p-4 font-semibold">
        {currentSession.title}
      </div>
      <MessageList messages={currentSession.messages} />
    </div>
  )
}
