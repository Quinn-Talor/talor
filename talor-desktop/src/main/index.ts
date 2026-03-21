import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import { ConfigStore } from './store/config-store'
import { registerConfigHandlers } from './ipc/config'
import { registerWindowHandlers } from './ipc/window'
import { registerProviderHandlers } from './ipc/providers'

log.initialize()
log.info('[Main] Talor Desktop starting...')

registerConfigHandlers()
registerWindowHandlers()
registerProviderHandlers()

let mainWindow: BrowserWindow | null = null

const configStore = ConfigStore.getInstance()

function createWindow(): void {
  const bounds = configStore.get('window_bounds') ?? {
    width: 1200,
    height: 800,
    is_maximized: false
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    show: false,
    autoHideMenuBar: false,
    title: 'Talor',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (bounds.is_maximized) {
      mainWindow?.maximize()
    }
    mainWindow?.show()
    log.info('[Main] Window ready to show')
  })

  mainWindow.on('close', () => {
    if (mainWindow) {
      const [width, height] = mainWindow.getSize()
      const [x, y] = mainWindow.getPosition()
      configStore.set('window_bounds', {
        width,
        height,
        x,
        y,
        is_maximized: mainWindow.isMaximized()
      })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  log.info('[Main] Window created and loading content')
}

app.whenReady().then(() => {
  configStore.ensureInitialized()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
  }
})

process.on('uncaughtException', (error) => {
  log.error('[Main] Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  log.error('[Main] Unhandled rejection:', reason)
})

export { mainWindow, configStore }
