import { useState } from 'react'
import { Layout } from './components/Layout'
import { SessionList } from './components/SessionList'
import { ChatView } from './components/ChatView'
import { PromptInput } from './components/PromptInput'
import { ProviderSettings } from './components/ProviderSettings'
import { useSessionStore } from './store/sessionStore'

type View = 'chat' | 'settings'

function App() {
  const [view, setView] = useState<View>('chat')
  const currentSessionId = useSessionStore((s) => s.currentSessionId)

  const handleSend = (message: string) => {
    console.log('Send message:', message)
  }

  return (
    <Layout>
      <aside className="w-64 bg-gray-900 flex flex-col">
        <div className="p-4 font-bold text-white border-b border-gray-800">
          Talor
        </div>
        <nav className="border-b border-gray-800">
          <button
            onClick={() => setView('chat')}
            className={`w-full text-left px-4 py-2 text-sm ${
              view === 'chat' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setView('settings')}
            className={`w-full text-left px-4 py-2 text-sm ${
              view === 'settings' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800'
            }`}
          >
            Settings
          </button>
        </nav>
        {view === 'chat' && <SessionList />}
      </aside>
      <main className="flex-1 flex flex-col">
        {view === 'chat' ? (
          <>
            <ChatView />
            {currentSessionId && <PromptInput onSend={handleSend} />}
          </>
        ) : (
          <ProviderSettings />
        )}
      </main>
    </Layout>
  )
}

export default App
