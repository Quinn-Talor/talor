import { useSessionStore } from '../store/sessionStore'

export function SessionList() {
  const { sessions, currentSessionId, setCurrentSession } = useSessionStore()

  return (
    <div className="p-2">
      <div className="text-xs font-semibold text-gray-400 px-2 py-1">Sessions</div>
      {sessions.length === 0 ? (
        <div className="text-gray-500 text-sm px-2 py-4 text-center">No sessions</div>
      ) : (
        sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => setCurrentSession(session.id)}
            className={`w-full text-left px-2 py-2 rounded text-sm truncate ${
              currentSessionId === session.id 
                ? 'bg-gray-700 text-white' 
                : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            {session.title}
          </button>
        ))
      )}
    </div>
  )
}
