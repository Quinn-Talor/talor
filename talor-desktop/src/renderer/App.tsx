import { Header } from './components/Header'
import { SettingsPage } from './pages/Settings'

export function App() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <Header title="Talor" />
      <main className="flex-1 overflow-auto">
        <SettingsPage />
      </main>
    </div>
  )
}
