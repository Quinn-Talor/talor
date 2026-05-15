import { useState } from 'react'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'

export function App() {
  const [page, setPage] = useState<'chat' | 'settings'>('chat')

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <main className="flex-1 overflow-hidden">
        {page === 'chat' && <ChatPage onOpenSettings={() => setPage('settings')} />}
        {page === 'settings' && <SettingsPage onBack={() => setPage('chat')} />}
      </main>
    </div>
  )
}
