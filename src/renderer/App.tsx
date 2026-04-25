import { useState } from 'react'
import { Header } from './components/Header'
import { HomePage } from './pages/Home'
import { SettingsPage } from './pages/Settings'
import { ChatPage } from './pages/Chat'

export function App() {
  const [page, setPage] = useState<'home' | 'chat' | 'settings'>('home')

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header 
        title="Talor" 
        onSettingsClick={() => setPage('settings')}
        onChatClick={() => setPage('chat')}
      />
      <main className="flex-1 overflow-hidden">
        {page === 'home' && <HomePage onSettingsClick={() => setPage('settings')} onChatClick={() => setPage('chat')} />}
        {page === 'chat' && <ChatPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
