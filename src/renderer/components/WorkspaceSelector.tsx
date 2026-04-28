import { useState } from 'react'
import { talorAPI } from '../api/talorAPI'

interface WorkspaceSelectorProps {
  sessionId: string
  workspace?: string
  onWorkspaceChange: (workspace: string) => void
  disabled?: boolean
}

export function WorkspaceSelector({
  sessionId,
  workspace,
  onWorkspaceChange,
  disabled = false,
}: WorkspaceSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false)

  const handleSelectWorkspace = async () => {
    if (disabled || isUpdating) return
    try {
      const paths = await talorAPI.file.openDialog({
        title: '选择工作目录',
        buttonLabel: '选择',
        properties: ['openDirectory', 'createDirectory'],
      })
      if (!paths || paths.length === 0) return
      setIsUpdating(true)
      const updated = await talorAPI.session.updateWorkspace({
        session_id: sessionId,
        workspace: paths[0],
      })
      if (updated?.workspace) onWorkspaceChange(updated.workspace)
    } catch (e) {
      console.error('[WorkspaceSelector] Failed:', e)
    } finally {
      setIsUpdating(false)
    }
  }

  const MAX_DISPLAY_LEN = 40

  const displayPath = (() => {
    if (!workspace) return null
    if (isUpdating) return '更新中…'
    if (workspace.length <= MAX_DISPLAY_LEN) return workspace
    // Show trailing portion with ellipsis prefix
    return '…' + workspace.slice(-(MAX_DISPLAY_LEN - 1))
  })()

  return (
    <button
      onClick={handleSelectWorkspace}
      disabled={disabled || isUpdating}
      title={workspace ?? '设置工作目录'}
      data-testid="workspace-selector"
      className="flex items-center gap-1 h-5 px-1.5 rounded transition-colors hover:bg-[#f1f5f9] disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: '#94a3b8' }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className="font-mono text-[11px]" style={{ color: displayPath ? '#64748b' : '#94a3b8' }}>
        {displayPath ?? '设置工作目录'}
      </span>
    </button>
  )
}
