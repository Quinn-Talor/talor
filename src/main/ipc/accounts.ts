// src/main/ipc/accounts.ts — 入口层：账户管理 IPC handlers
//
// 允许依赖：agent/accounts
// 禁止依赖：业务决策

import { ipcMain } from 'electron'
import type { AccountStore } from '../agent/accounts'
import type { Account } from '@shared/types/agent'

export function registerAccountHandlers(accountStore: AccountStore): void {
  ipcMain.handle('accounts:list', () => {
    return accountStore.list()
  })

  ipcMain.handle('accounts:save', (_event, account: Account) => {
    accountStore.save(account)
  })

  ipcMain.handle('accounts:delete', (_event, service: string) => {
    accountStore.delete(service)
  })

  ipcMain.handle('accounts:get-value', (_event, key: string) => {
    return accountStore.getValue(key) ?? null
  })
}
