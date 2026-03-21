import { talorAPI } from '../api/talorAPI'
import { useState, useEffect } from 'react'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    talorAPI.window.isMaximized().then(setIsMaximized)
  }, [])

  const handleMinimize = () => talorAPI.window.minimize()
  const handleMaximize = () => {
    talorAPI.window.maximize()
    talorAPI.window.isMaximized().then(setIsMaximized)
  }
  const handleClose = () => talorAPI.window.close()

  return (
    <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center">
          <span className="text-white font-bold text-sm">T</span>
        </div>
        <h1 className="text-base font-semibold text-gray-800">{title}</h1>
      </div>

      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={handleMinimize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors"
          title="最小化"
        >
          <svg width="12" height="1" viewBox="0 0 12 1" fill="currentColor">
            <rect width="12" height="1" />
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="4.5" width="7" height="7" />
              <polyline points="4.5,4.5 4.5,2.5 12.5,2.5 12.5,10.5 10.5,10.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500 hover:text-white text-gray-500 transition-colors"
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </header>
  )
}
