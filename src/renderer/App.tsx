import { useState } from 'react'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'
import { ArtifactDrawer } from './artifacts/ArtifactDrawer'
import { usePendingApprovals } from './hooks/usePendingApprovals'
import { useChatStore } from './store/chatStore'

export function App() {
  const [page, setPage] = useState<'chat' | 'settings'>('chat')
  // 工具确认 / 授权请求的订阅挂在 App 层:聊天页卸载(进入设置页)时请求仍进队列
  usePendingApprovals()
  const pendingCount = useChatStore((s) => s.permissionQueue.length + s.toolConfirmQueue.length)

  return (
    <div className="flex flex-col h-screen bg-canvas">
      {page === 'settings' && pendingCount > 0 && (
        <div
          className="flex items-center gap-3 px-4 py-2 text-[13px] shrink-0"
          style={{ background: '#fffbeb', borderBottom: '1px solid #fde68a', color: '#92400e' }}
          data-testid="pending-approvals-banner"
        >
          <span className="flex-1">有 {pendingCount} 个工具调用 / 授权请求等待你确认</span>
          <button
            onClick={() => setPage('chat')}
            className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-white"
            style={{ background: '#d97706' }}
          >
            返回聊天处理
          </button>
        </div>
      )}
      <main className="flex-1 overflow-hidden">
        {page === 'chat' && <ChatPage onOpenSettings={() => setPage('settings')} />}
        {page === 'settings' && <SettingsPage onBack={() => setPage('chat')} />}
      </main>
      {/* 案卷抽屉(平台通用):监听 artifact:open 事件,按 type 渲染,与页面/业务解耦 */}
      <ArtifactDrawer />
    </div>
  )
}
