import type { ChatSession } from '../types/chat'

interface SessionItemProps {
  session: ChatSession
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

export function SessionItem({ session, isActive, onClick, onDelete }: SessionItemProps) {
  return (
    <div 
      className={`group flex items-center justify-between p-3 cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-100 transition-colors ${
        isActive ? 'bg-blue-50 hover:bg-blue-50' : 'bg-transparent'
      }`}
      onClick={onClick}
    >
      <div className="flex flex-col overflow-hidden">
        <span className={`text-sm truncate ${isActive ? 'font-medium text-blue-700' : 'text-gray-700'}`}>
          {session.title || '新会话'}
        </span>
        <span className="text-xs text-gray-400">
          {new Date(session.updated_at).toLocaleDateString()}
        </span>
      </div>
      <button 
        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 rounded hover:bg-gray-200 transition-all"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        title="删除会话"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"></path>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
        </svg>
      </button>
    </div>
  )
}
