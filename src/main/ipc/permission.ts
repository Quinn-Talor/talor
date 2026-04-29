// src/main/ipc/permission.ts — 入口层：权限请求 IPC
//
// 协议：
//   - main → renderer：`chat:permission-request` 发送 PermissionRequest
//   - renderer → main：`chat:permission-response` 回 PermissionResponse
//   只有 requestId 匹配的响应才被本次 Promise 消费
//
// 超时默认 5 分钟（授权场景用户可能离开电脑），到期视为 rejected。
//
// 允许依赖：shared/*、permissions/*
// 禁止依赖：业务层运行时

import { BrowserWindow, ipcMain } from 'electron'
import log from 'electron-log'
import { permissionStore } from '../permissions/permission-store'
import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRuleView,
} from '@shared/types/permissions'

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export async function requestPermissionFromRenderer(
  mainWindow: BrowserWindow,
  req: PermissionRequest,
): Promise<PermissionResponse> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('chat:permission-response', handler)
      log.warn('[permission] request timed out, auto-rejecting:', req.requestId)
      resolve({ requestId: req.requestId, decision: 'rejected' })
    }, REQUEST_TIMEOUT_MS)

    const handler = (_event: Electron.IpcMainEvent, response: PermissionResponse) => {
      if (response.requestId !== req.requestId) return
      clearTimeout(timeout)
      ipcMain.removeListener('chat:permission-response', handler)
      resolve(response)
    }

    ipcMain.on('chat:permission-response', handler)
    mainWindow.webContents.send('chat:permission-request', req)
  })
}

/**
 * 注册规则管理 IPC：供 Settings 页面查看/删除规则。
 * 独立注册函数，与 sendChat 无耦合，调用一次即可。
 */
export function registerPermissionHandlers(): void {
  ipcMain.handle(
    'permissions:list',
    (_event, workspacePath: string): PermissionRuleView => {
      return permissionStore.listAll(workspacePath)
    },
  )

  ipcMain.handle(
    'permissions:remove',
    (_event, params: { workspacePath: string; ruleId: string }): boolean => {
      return permissionStore.removeRule(params.workspacePath, params.ruleId)
    },
  )

  ipcMain.handle(
    'permissions:clearSession',
    (_event, workspacePath: string): void => {
      permissionStore.clearSession(workspacePath)
    },
  )
}
