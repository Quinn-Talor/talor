import { useState } from 'react'
import { Header } from './components/Header'
import { HomePage } from './pages/Home'
import { SettingsPage } from './pages/Settings'

export function App() {
  const [page, setPage] = useState<'home' | 'settings'>('home')

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header title="Talor" onSettingsClick={() => setPage('settings')} />
      <main className="flex-1 overflow-auto">
        {page === 'home' && <HomePage onSettingsClick={() => setPage('settings')} />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
