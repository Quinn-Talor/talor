import { useState } from 'react'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'
import { ArtifactDrawer } from './artifacts/ArtifactDrawer'

export function App() {
  const [page, setPage] = useState<'chat' | 'settings'>('chat')

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <main className="flex-1 overflow-hidden">
        {page === 'chat' && <ChatPage onOpenSettings={() => setPage('settings')} />}
        {page === 'settings' && <SettingsPage onBack={() => setPage('chat')} />}
      </main>
      {/* 案卷抽屉(平台通用):监听 artifact:open 事件,按 type 渲染,与页面/业务解耦 */}
      <ArtifactDrawer />
    </div>
  )
}
