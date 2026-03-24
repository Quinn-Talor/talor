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

      const selectedPath = paths[0]
      setIsUpdating(true)

      const updated = await talorAPI.session.updateWorkspace({
        session_id: sessionId,
        workspace: selectedPath,
      })

      if (updated?.workspace) {
        onWorkspaceChange(updated.workspace)
      }
    } catch (e) {
      console.error('[WorkspaceSelector] Failed to update workspace:', e)
    } finally {
      setIsUpdating(false)
    }
  }

  const displayPath = workspace
    ? workspace.split(/[\\/]/).pop() || workspace
    : null

  const hasWorkspace = Boolean(workspace)

  return (
    <button
      onClick={handleSelectWorkspace}
      disabled={disabled || isUpdating}
      title={workspace ? `工作目录: ${workspace}` : '设置工作目录（启用工具调用）'}
      data-testid="workspace-selector"
      className={`flex flex-col items-center justify-center gap-0.5 w-14 shrink-0 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed
        ${hasWorkspace
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
          : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      style={{ minHeight: '52px' }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span className="text-[10px] font-medium leading-none truncate w-full text-center px-1">
        {isUpdating ? '更新中' : displayPath ?? '目录'}
      </span>
    </button>
  )
}
