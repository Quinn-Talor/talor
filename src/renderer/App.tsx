import { useState } from 'react'
import { Header } from './components/Header'
import { HomePage } from './pages/Home'
import { SettingsPage } from './pages/Settings'
import { ChatPage } from './pages/Chat'
import { AgentsPage } from './pages/Agents'

export function App() {
  const [page, setPage] = useState<'home' | 'chat' | 'settings' | 'agents'>('home')

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header
        title="Talor"
        onSettingsClick={() => setPage('settings')}
        onChatClick={() => setPage('chat')}
        onAgentsClick={() => setPage('agents')}
      />
      <main className="flex-1 overflow-hidden">
        {page === 'home' && <HomePage onSettingsClick={() => setPage('settings')} onChatClick={() => setPage('chat')} />}
        {page === 'chat' && <ChatPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'agents' && <AgentsPage onNavigateChat={() => setPage('chat')} />}
      </main>
    </div>
  )
}
