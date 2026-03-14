import { Layout } from './components/Layout'
import { SessionList } from './components/SessionList'
import { ChatView } from './components/ChatView'
import { PromptInput } from './components/PromptInput'
import { useSessionStore } from './store/sessionStore'

function App() {
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
        <SessionList />
      </aside>
      <main className="flex-1 flex flex-col">
        <ChatView />
        {currentSessionId && <PromptInput onSend={handleSend} />}
      </main>
    </Layout>
  )
}

export default App
