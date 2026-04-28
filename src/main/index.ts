import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

app.commandLine.appendSwitch('remote-debugging-port', '9222')
app.commandLine.appendSwitch('enable-logging')
import log from 'electron-log'
import { ConfigStore } from './store/config-store'
import { registerConfigHandlers } from './ipc/config'
import { registerWindowHandlers, setMainWindow } from './ipc/window'
import { registerProviderHandlers } from './ipc/providers'
import { registerSessionHandlers } from './ipc/session'
import { registerChatHandlers } from './ipc/chat'
import { registerFileHandlers } from './ipc/fileHandlers'
import { registerMCPHandlers } from './ipc/mcp'
import { registerAgentHandlers } from './ipc/agents'
import { registerAccountHandlers } from './ipc/accounts'
import { mcpRegistry } from './mcp/client'
import { initChatDb, closeChatDb } from './db/index'
import { AgentManager } from './agent/agent-manager'
import { BuiltinToolRegistry } from './agent/builtin-registry'
import { AccountStore } from './agent/accounts'
import { createDelegateAgentTool } from './agent/delegate-agent'
import { toolRegistry } from './tools/registry'
import { SkillRegistry } from './skills/registry'
import { SafeStorageService } from './services/safe-storage'
import { safeStorage } from 'electron'

log.initialize()
log.info('[Main] Talor Desktop starting...')

const agentManager = new AgentManager()

registerConfigHandlers()
registerWindowHandlers()
registerProviderHandlers()
registerSessionHandlers()
registerChatHandlers(agentManager)
registerFileHandlers()
registerMCPHandlers()
registerAgentHandlers(agentManager)

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
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setMainWindow(mainWindow)

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
  initChatDb()

  // Initialize Agent system — collect builtin tool definitions (7 + delegate_agent)
  // skill tool 不在全局 BuiltinToolRegistry，由 Agent 构造时按需注入
  const builtinToolDefs = [...toolRegistry.listAll(), createDelegateAgentTool(agentManager)]
  const builtinRegistry = new BuiltinToolRegistry(builtinToolDefs)
  const agentsDir = join(app.getPath('home'), '.talor', 'agents')
  const skillsDir = join(app.getPath('home'), '.talor', 'skills')
  const platformSkillRegistry = SkillRegistry.fromDir(skillsDir)
  const safeStorageInstance = SafeStorageService.getInstance()
  const accountStore = new AccountStore(
    join(app.getPath('home'), '.talor', 'accounts.json'),
    {
      isAvailable: () => safeStorageInstance.isAvailable(),
      encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
      decrypt: (encrypted: string) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
    },
  )

  registerAccountHandlers(accountStore)

  agentManager.init({
    builtinRegistry,
    mcpRegistry,
    skillRegistry: platformSkillRegistry,
    agentsDir,
  })
  log.info('[Main] Agent system initialized')

  createWindow()
  mcpRegistry.connectAllEnabled().catch((err) => {
    log.warn('[Main] Failed to connect MCP servers:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeChatDb()
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
