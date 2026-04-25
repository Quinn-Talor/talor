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
  })
}
