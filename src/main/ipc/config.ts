// src/main/ipc/config.ts —— 入口层：config IPC handlers
// 允许依赖：store/*、shared/*    禁止依赖：业务层运行时代码

import { ipcMain } from 'electron'
import { ConfigStore } from '../store/config-store'

export function registerConfigHandlers(): void {
  ipcMain.handle('config:get', () => {
    return ConfigStore.getInstance().getAll()
  })

  ipcMain.handle('config:save', (_event, config) => {
    const store = ConfigStore.getInstance()
    if (config.config_dir !== undefined) {
      store.set('config_dir', config.config_dir)
    }
    if (config.providers !== undefined) {
      store.set('providers', config.providers)
    }
    if (config.window_bounds !== undefined) {
      store.set('window_bounds', config.window_bounds)
    }
    if (config.default_context_limit !== undefined) {
      store.set('default_context_limit', config.default_context_limit)
    }
    if (config.default_recent_ratio !== undefined) {
      store.set('default_recent_ratio', config.default_recent_ratio)
    }
    if (config.default_summary_ratio !== undefined) {
      store.set('default_summary_ratio', config.default_summary_ratio)
    }
  })
}
