import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

// ESM main bundle 下没有 CJS 的 __dirname 全局。TS 编译时使用
// import.meta.dirname(Node 20.11+ / TS 5.8+)获取当前模块目录。
// electron-vite 5 在 ESM 输出里还会自动注入同名 shim,两者都指向 out/main/。
const MAIN_DIR = import.meta.dirname

// remote-debugging-port / enable-logging 仅限 dev(未打包)。
// 打包后开启 remote-debugging-port 意味着任意本机进程都能通过 DevTools Protocol
// 注入脚本,进而读取聊天内容 / API key,属严重信息泄漏。
if (!app.isPackaged) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222')
  app.commandLine.appendSwitch('enable-logging')
}
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
import { registerPermissionHandlers } from './ipc/permission'
import { mcpRegistry } from './mcp/client'
import { initChatDb, closeChatDb } from './db/index'
import { AgentManager } from './agent/agent-manager'
import { BuiltinToolRegistry } from './agent/builtin-registry'
import { AccountStore } from './accounts/account-store'
import type { DelegationRuntime } from './agent/delegate-agent'
import { toolRegistry } from './tools/registry'
import { sessionRepo } from './repos/session-repo'
import { sharedPromptPipeline } from './chat/orchestrator'
import { runReactLoop } from './loop/react-loop'
import { getAdapter } from './providers/model-adapter'
import { getDefaultProvider, getProviderById } from './chat/provider-selector'
import { resolveProviderConfig } from './prompt/PromptPipeline'
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
registerPermissionHandlers()

let mainWindow: BrowserWindow | null = null

const configStore = ConfigStore.getInstance()

function createWindow(): void {
  const bounds = configStore.get('window_bounds') ?? {
    width: 1200,
    height: 800,
    is_maximized: false,
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
      // preload 打成 CJS (.cjs) 以兼容 sandbox:true —— sandboxed preload 不支持
      // ESM。参见 electron.vite.config.ts preload.rollupOptions.output。
      preload: join(MAIN_DIR, '../preload/index.cjs'),
      // Electron 安全三件套:
      //   - contextIsolation: true  → preload 与页面 JS 世界隔离
      //   - nodeIntegration: false  → 页面禁访问 Node API
      //   - sandbox: true           → OS 级沙箱,renderer 进程最小权限
      // Talor 的 preload 只使用 contextBridge + ipcRenderer,完全兼容 sandbox。
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
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
        is_maximized: mainWindow.isMaximized(),
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
    mainWindow.loadFile(join(MAIN_DIR, '../renderer/index.html'))
  }

  log.info('[Main] Window created and loading content')
}

/**
 * 全局 web-contents-created 监听 — Electron 导航安全基线。
 *
 *   will-navigate       阻止 renderer 通过 location = '...' 导航到非白名单来源
 *                       (防止 XSS 后跳转到外站,整个 renderer 被恶意站点接管)
 *   will-attach-webview 禁止动态注入 <webview> 标签
 *                       (防 untrusted code 通过 webview 逃逸)
 *   setWindowOpenHandler 已在 createWindow 内逐窗口设置
 *
 * 允许的 URL:
 *   dev:  process.env.ELECTRON_RENDERER_URL(Vite server,如 http://localhost:5173)
 *   prod: file:// 下的 renderer bundle
 * 其他一律 event.preventDefault()。
 */
function registerNavigationGuards(): void {
  const devOrigin = process.env.ELECTRON_RENDERER_URL
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (devOrigin && url.startsWith(devOrigin)) return
      if (url.startsWith('file://')) return
      log.warn('[Main] Blocked navigation to:', url)
      event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => {
      log.warn('[Main] Blocked <webview> attach')
      event.preventDefault()
    })
  })
}

app.whenReady().then(() => {
  registerNavigationGuards()
  configStore.ensureInitialized()
  initChatDb()

  // Initialize Agent system — builtin tool definitions (skill / delegate_agent
  // are NOT in BuiltinToolRegistry; they're agent-level instances created in
  // Agent constructor when relevant runtime is injected).
  const builtinToolDefs = toolRegistry.listAll()
  const builtinRegistry = new BuiltinToolRegistry(builtinToolDefs)
  const agentsDir = join(app.getPath('home'), '.talor', 'agents')
  // Skills 统一存平台目录 ~/.claude/skills/(与 Claude Code skills 共用约定);
  // business agent 不再持有私有 skill 副本,仅按 name 引用平台 registry。
  const skillsDir = join(app.getPath('home'), '.claude', 'skills')
  const platformSkillRegistry = SkillRegistry.fromPlatformDir(skillsDir)
  const safeStorageInstance = SafeStorageService.getInstance()
  // Account 凭据已迁至 DB(account_keys 表),不再需要 filePath 参数。
  // safeStorage 仍用于加密 secret 字段,与旧实现保持同样的 OS 级保护。
  const accountStore = new AccountStore({
    isAvailable: () => safeStorageInstance.isAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value).toString('base64'),
    decrypt: (encrypted: string) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
  })

  registerAccountHandlers(accountStore)

  // Compose DelegationRuntime: subagent execution dependencies bundle.
  // Only platform agents receive this; business agents get undefined (architecture
  // defense — they cannot delegate even if their profile forgot disabledTools).
  const delegationRuntime: DelegationRuntime = {
    agentManager,
    runReactLoop,
    sessionRepo,
    pipeline: sharedPromptPipeline,
    config: configStore.getDelegation(),
    providerContextProvider: (parentSessionId: string) => {
      // Mirror orchestrator's provider/model resolution path so subagent inherits
      // parent's provider config (provider, modelId, streamOptions).
      const session = sessionRepo.getById(parentSessionId)
      const provider =
        (session?.provider_id ? getProviderById(session.provider_id) : null) ?? getDefaultProvider()
      const adapter = getAdapter(provider.type)
      const model = adapter.createModel(provider, session?.model_id ?? 'default')
      return {
        model,
        provider,
        providerConfig: resolveProviderConfig(provider),
        streamOptions: adapter.buildStreamOptions(),
      }
    },
  }

  agentManager.init({
    builtinRegistry,
    mcpRegistry,
    skillRegistry: platformSkillRegistry,
    agentsDir,
    delegationRuntime,
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
