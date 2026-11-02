// src/main/ipc/plugins.ts —— 入口层：插件 IPC（列出、启用停用、重载）
// 允许依赖：runtime/plugins、store/config-store、shared/*

import { ipcMain } from 'electron'
import type { PluginInfo } from '@shared/types/ipc'
import { pluginInfos, reloadPlugins } from '../runtime/plugins'
import { ConfigStore } from '../store/config-store'

export function registerPluginHandlers(): void {
  ipcMain.handle('plugins:list', (): PluginInfo[] => pluginInfos())

  ipcMain.handle(
    'plugins:set-enabled',
    async (_event, name: string, enabled: boolean): Promise<PluginInfo[]> => {
      const config = ConfigStore.getInstance()
      const list = [
        ...((config.get('plugins') as { enabled?: string[] } | undefined)?.enabled ?? []),
      ]
      const next = enabled
        ? list.includes(name)
          ? list
          : [...list, name]
        : list.filter((n) => n !== name)
      config.set('plugins', { enabled: next })
      await reloadPlugins()
      return pluginInfos()
    },
  )

  ipcMain.handle('plugins:reload', async (): Promise<PluginInfo[]> => {
    await reloadPlugins()
    return pluginInfos()
  })
}
