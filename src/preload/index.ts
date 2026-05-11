import { contextBridge, ipcRenderer } from 'electron'
import type { ToolConfirmRequest, ToolConfirmResponse } from '@shared/types/message'
import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRuleView,
} from '@shared/types/permissions'

// IPC 边界类型:单一事实源在 @shared/types/ipc,
// 这里 re-export 仅为兼容历史 import 路径(renderer 侧部分文件写的是
// `import('../../preload/index').MCPServer` 等)。新代码请直接从 @shared/types/ipc 导入。
export type {
  ProviderType,
  ModelInfo,
  ModelCapability,
  Provider,
  ProviderInput,
  ProviderModelResponse,
  ConnectionTestResult,
  AppConfig,
  MCPServerType,
  MCPAuthConfig,
  MCPServer,
  MCPServerInput,
  MCPConnectionTestResult,
  MessageRole,
  ChatSession,
  ChatToolCallEvent,
  ChatToolResultEvent,
  SessionUpdateWorkspaceParams,
  ChatMessage,
  Attachment,
  ChatErrorCode,
  ChatSendParams,
  ChatSendResult,
  ChatStreamEvent,
  SessionRenameParams,
  SessionUpdateModelParams,
  SessionCheckModelAvailabilityResult,
} from '@shared/types/ipc'

import type {
  Provider,
  ProviderInput,
  ProviderType,
  ProviderModelResponse,
  ConnectionTestResult,
  ModelInfo,
  ModelCapability,
  AppConfig,
  MCPServer,
  MCPServerInput,
  MCPConnectionTestResult,
  ChatSession,
  ChatMessage,
  ChatToolCallEvent,
  ChatToolResultEvent,
  ChatSendParams,
  ChatSendResult,
  ChatStreamEvent,
  SessionRenameParams,
  SessionUpdateModelParams,
  SessionUpdateWorkspaceParams,
  SessionCheckModelAvailabilityResult,
} from '@shared/types/ipc'

// 顶部 debug 日志仅在 dev 下输出,避免生产 DevTools 泄漏启动信息。
if (process.env.NODE_ENV !== 'production') {
  console.log('[Preload] Script loading...')
}

const talorAPI = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke('config:get'),
    save: (config: Partial<AppConfig>): Promise<void> => ipcRenderer.invoke('config:save', config),
  },

  providers: {
    list: (): Promise<Provider[]> => ipcRenderer.invoke('providers:list'),
    create: (provider: ProviderInput): Promise<Provider> =>
      ipcRenderer.invoke('providers:create', provider),
    update: (id: string, updates: ProviderInput): Promise<Provider> =>
      ipcRenderer.invoke('providers:update', id, updates),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('providers:delete', id),
    setDefault: (id: string): Promise<void> => ipcRenderer.invoke('providers:setDefault', id),
    testConnection: (config: {
      type: ProviderType
      base_url: string
      api_key?: string
    }): Promise<ConnectionTestResult> => ipcRenderer.invoke('providers:testConnection', config),
    getModels: (providerId: string, forceRefresh = false): Promise<ProviderModelResponse> =>
      ipcRenderer.invoke('providers:getModels', providerId, forceRefresh),
    refreshModels: (providerId: string): Promise<ProviderModelResponse> =>
      ipcRenderer.invoke('providers:refreshModels', providerId),
    detectCapabilities: (params: { providerId: string; modelId: string }): Promise<ModelInfo> =>
      ipcRenderer.invoke('providers:detectCapabilities', params),
    updateModelCapabilities: (params: {
      providerId: string
      modelId: string
      capabilities: ModelCapability[]
    }): Promise<ModelInfo> => ipcRenderer.invoke('providers:updateModelCapabilities', params),
  },

  mcp: {
    list: (): Promise<MCPServer[]> => ipcRenderer.invoke('mcp:servers:list'),
    create: (server: MCPServerInput): Promise<MCPServer> =>
      ipcRenderer.invoke('mcp:servers:create', server),
    get: (id: string): Promise<MCPServer> => ipcRenderer.invoke('mcp:servers:get', id),
    update: (id: string, updates: MCPServerInput): Promise<MCPServer> =>
      ipcRenderer.invoke('mcp:servers:update', id, updates),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('mcp:servers:delete', id),
    setEnabled: (id: string, enabled: boolean): Promise<MCPServer> =>
      ipcRenderer.invoke('mcp:servers:setEnabled', id, enabled),
    importConfig: (
      configJson: string,
    ): Promise<Array<{ name: string; status: 'created' | 'updated' }>> =>
      ipcRenderer.invoke('mcp:servers:importConfig', configJson),
    exportConfig: (): Promise<string> => ipcRenderer.invoke('mcp:servers:exportConfig'),
    testConnection: (server: MCPServerInput): Promise<MCPConnectionTestResult> =>
      ipcRenderer.invoke('mcp:servers:testConnection', server),
    connect: (
      serverId: string,
    ): Promise<{ status: string; message?: string; error_code?: string }> =>
      ipcRenderer.invoke('mcp:connect', serverId),
    disconnect: (
      serverId: string,
    ): Promise<{ status: string; message?: string; error_code?: string }> =>
      ipcRenderer.invoke('mcp:disconnect', serverId),
    listTools: (): Promise<
      Array<{
        name: string
        description: string
        parameters: Record<string, unknown>
        schema?: Record<string, unknown>
        provider?: string
      }>
    > => ipcRenderer.invoke('mcp:tools:list'),
    connectedServers: (): Promise<string[]> => ipcRenderer.invoke('mcp:servers:connected'),
    getServerStatus: (): Promise<
      Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>
    > => ipcRenderer.invoke('mcp:servers:status'),
  },

  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  },

  session: {
    list: (): Promise<ChatSession[]> => ipcRenderer.invoke('session:list'),
    create: (params: { provider_id: string; model_id?: string }): Promise<ChatSession> =>
      ipcRenderer.invoke('session:create', params),
    get: (id: string): Promise<ChatSession | null> => ipcRenderer.invoke('session:get', id),
    rename: (params: SessionRenameParams): Promise<ChatSession | null> =>
      ipcRenderer.invoke('session:rename', params),
    updateModel: (params: SessionUpdateModelParams): Promise<ChatSession | null> =>
      ipcRenderer.invoke('session:updateModel', params),
    checkModelAvailability: (params: {
      session_id: string
    }): Promise<SessionCheckModelAvailabilityResult> =>
      ipcRenderer.invoke('session:checkModelAvailability', params),
    delete: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:delete', sessionId),
    getMessages: (sessionId: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('session:getMessages', sessionId),
    touch: (sessionId: string): Promise<void> => ipcRenderer.invoke('session:touch', sessionId),
    updateWorkspace: (params: SessionUpdateWorkspaceParams): Promise<ChatSession | null> =>
      ipcRenderer.invoke('session:updateWorkspace', params),
  },

  chat: {
    send: (params: ChatSendParams): Promise<ChatSendResult> =>
      ipcRenderer.invoke('chat:send', params),
    abort: (sessionId: string): Promise<void> => ipcRenderer.invoke('chat:abort', sessionId),
    onStream: (callback: (event: ChatStreamEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: ChatStreamEvent) => callback(data)
      ipcRenderer.on('chat:stream', handler)
      return () => ipcRenderer.removeListener('chat:stream', handler)
    },
    onToolCall: (callback: (event: ChatToolCallEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: ChatToolCallEvent) => callback(data)
      ipcRenderer.on('chat:tool-call', handler)
      return () => ipcRenderer.removeListener('chat:tool-call', handler)
    },
    onToolResult: (callback: (event: ChatToolResultEvent) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: ChatToolResultEvent) => {
        try {
          callback(data)
        } catch (err) {
          console.error('[preload] onToolResult callback error:', err)
        }
      }
      ipcRenderer.on('chat:tool-result', handler)
      return () => ipcRenderer.removeListener('chat:tool-result', handler)
    },
    onToolConfirm: (callback: (event: ToolConfirmRequest) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: ToolConfirmRequest) => callback(data)
      ipcRenderer.on('chat:tool-confirm', handler)
      return () => ipcRenderer.removeListener('chat:tool-confirm', handler)
    },
    sendToolConfirmResponse: (response: ToolConfirmResponse): void => {
      ipcRenderer.send('chat:tool-confirm-response', response)
    },
    onPermissionRequest: (callback: (event: PermissionRequest) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: PermissionRequest) => callback(data)
      ipcRenderer.on('chat:permission-request', handler)
      return () => ipcRenderer.removeListener('chat:permission-request', handler)
    },
    sendPermissionResponse: (response: PermissionResponse): void => {
      ipcRenderer.send('chat:permission-response', response)
    },
  },

  permissions: {
    list: (workspacePath: string): Promise<PermissionRuleView> =>
      ipcRenderer.invoke('permissions:list', workspacePath),
    remove: (workspacePath: string, ruleId: string): Promise<boolean> =>
      ipcRenderer.invoke('permissions:remove', { workspacePath, ruleId }),
    clearSession: (workspacePath: string): Promise<void> =>
      ipcRenderer.invoke('permissions:clearSession', workspacePath),
    listWorkspaces: (): Promise<Array<{ workspacePath: string; ruleCount: number }>> =>
      ipcRenderer.invoke('permissions:listWorkspaces'),
  },

  agents: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('agents:list'),
    get: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:get', id),
    createSession: (agentId: string): Promise<{ session_id: string }> =>
      ipcRenderer.invoke('agents:create-session', { agent_id: agentId }),
    enable: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:enable', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('agents:delete', id),
    reload: (): Promise<unknown[]> => ipcRenderer.invoke('agents:reload'),
    checkDeps: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:check-deps', id),
    export: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:export', id),
    import: (): Promise<unknown> => ipcRenderer.invoke('agents:import'),
    installDeps: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:install-deps', id),
    update: (id: string, profile: unknown): Promise<void> =>
      ipcRenderer.invoke('agents:update', { id, profile }),
    startCrystallize: (
      sessionId: string,
    ): Promise<{
      success: boolean
      error?: string
      workbench_session_id?: string
      reused?: boolean
      initial_prompt?: string
    }> => ipcRenderer.invoke('agents:start-crystallize', { session_id: sessionId }),
    finishCrystallize: (workbenchSessionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:finish-crystallize', {
        workbench_session_id: workbenchSessionId,
      }),
    createFromDraft: (
      profile: unknown,
      workbenchSessionId: string,
    ): Promise<{ success: boolean; error?: string; id?: string; created_at?: string }> =>
      ipcRenderer.invoke('agents:create-from-draft', {
        profile,
        workbench_session_id: workbenchSessionId,
      }),
    listFromWorkbench: (
      workbenchSessionId: string,
    ): Promise<Array<{ id: string; name: string; created_at: string }>> =>
      ipcRenderer.invoke('agents:list-from-workbench', {
        workbench_session_id: workbenchSessionId,
      }),
    removeFromWorkbench: (
      workbenchSessionId: string,
      agentId: string,
    ): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:remove-from-workbench', {
        workbench_session_id: workbenchSessionId,
        agent_id: agentId,
      }),
    switchAgent: (sessionId: string, agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('session:switch-agent', { session_id: sessionId, agent_id: agentId }),
    listTools: (
      agentId: string,
    ): Promise<
      Array<{
        name: string
        description: string
        parameters: Record<string, unknown>
        provider?: string
        riskLevel?: string
      }>
    > => ipcRenderer.invoke('agents:list-tools', agentId),

    // 编辑 / 预览 / 模板 / 复制 / 沙箱试跑
    validate: (
      profile: unknown,
    ): Promise<{
      valid: boolean
      errors: Array<{ severity: 'error' | 'warn'; rule: number; path: string; message: string }>
      warnings: Array<{ severity: 'error' | 'warn'; rule: number; path: string; message: string }>
    }> => ipcRenderer.invoke('agents:validate', profile),

    preview: (profile: unknown): Promise<unknown> => ipcRenderer.invoke('agents:preview', profile),

    listTemplates: (): Promise<
      Array<{ id: string; name: string; description: string; profile: unknown }>
    > => ipcRenderer.invoke('agents:list-templates'),

    duplicate: (id: string): Promise<unknown> => ipcRenderer.invoke('agents:duplicate', id),

    dryRun: (args: { profile: unknown; userMessage: string }): Promise<unknown> =>
      ipcRenderer.invoke('agents:dry-run', args),
  },

  accounts: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('accounts:list'),
    save: (account: unknown): Promise<void> => ipcRenderer.invoke('accounts:save', account),
    delete: (service: string): Promise<void> => ipcRenderer.invoke('accounts:delete', service),
    getValue: (key: string): Promise<string | null> =>
      ipcRenderer.invoke('accounts:get-value', key),
  },

  file: {
    openDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: Array<
        | 'openFile'
        | 'openDirectory'
        | 'multiSelections'
        | 'showHiddenFiles'
        | 'createDirectory'
        | 'promptToCreate'
        | 'noResolveAliases'
        | 'treatPackageAsDirectory'
        | 'dontAddToRecent'
      >
    }): Promise<string[] | null> => ipcRenderer.invoke('file:openDialog', options),
  },
}

contextBridge.exposeInMainWorld('talorAPI', talorAPI)
if (process.env.NODE_ENV !== 'production') {
  console.log('[Preload] talorAPI exposed to window.talorAPI')
}

export type TalorAPI = typeof talorAPI
