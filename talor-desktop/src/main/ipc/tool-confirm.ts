import { BrowserWindow, ipcMain } from 'electron'
import type { ToolConfirmRequest } from '@shared/types/message'

export async function requestToolConfirm(
  mainWindow: BrowserWindow,
  req: ToolConfirmRequest
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve(false)  // auto-reject on timeout
    }, 30_000)

    const handler = (_event: Electron.IpcMainEvent, response: { toolCallId: string; decision: string }) => {
      if (response.toolCallId !== req.toolCallId) return
      clearTimeout(timeout)
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve(response.decision === 'approved')
    }

    ipcMain.on('chat:tool-confirm-response', handler)
    mainWindow.webContents.send('chat:tool-confirm', req)
  })
}

export function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') {
    return String(obj.command ?? '').slice(0, MAX)
  }
  if (toolName === 'write') {
    const lines = String(obj.content ?? '').split('\n').slice(0, 20).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '').split('\n').slice(0, 10).map(l => l.slice(0, 80))
    return `文件: ${obj.path}\n旧内容:\n${lines.join('\n')}`.slice(0, MAX)
  }
  return JSON.stringify(input).slice(0, MAX)
}
