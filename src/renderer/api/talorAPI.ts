import type { ProviderType, ConnectionTestResult, Provider, ProviderInput } from '../types/config'
import type {
  ChatSession,
  ChatMessage,
  ChatStreamEvent,
  ChatToolCallEvent,
  ChatToolResultEvent,
  Attachment,
} from '../types/chat'
import type { ProviderModelResponse, ModelInfo } from '@shared/types/models'
import type { ToolConfirmRequest, ToolConfirmResponse } from '@shared/types/message'
import type {
  PermissionRequest,
  PermissionResponse,
  PermissionRuleView,
} from '@shared/types/permissions'

declare global {
  interface Window {
    talorAPI: {
      config: {
        get: () => Promise<{
          config_dir: string
          providers: Record<string, Provider>
          window_bounds: unknown
        }>
        save: (config: unknown) => Promise<void>
      }
      providers: {
        list: () => Promise<Provider[]>
        create: (input: ProviderInput) => Promise<Provider>
        update: (id: string, updates: ProviderInput) => Promise<Provider>
        delete: (id: string) => Promise<void>
        setDefault: (id: string) => Promise<void>
        testConnection: (config: {
          type: ProviderType
          base_url: string
          api_key?: string
        }) => Promise<ConnectionTestResult>
        getModels: (providerId: string, forceRefresh?: boolean) => Promise<ProviderModelResponse>
        refreshModels: (providerId: string) => Promise<ProviderModelResponse>
        detectCapabilities: (params: { providerId: string; modelId: string }) => Promise<ModelInfo>
        updateModelCapabilities: (params: {
          providerId: string
          modelId: string
          capabilities: import('@shared/types/models').ModelCapability[]
        }) => Promise<ModelInfo>
      }
      session: {
        list: () => Promise<ChatSession[]>
        create: (params: { provider_id: string; model_id?: string }) => Promise<ChatSession>
        get: (id: string) => Promise<ChatSession | null>
        rename: (params: { session_id: string; title: string }) => Promise<ChatSession | null>
        updateModel: (params: {
          session_id: string
          model_id: string
        }) => Promise<ChatSession | null>
        updateWorkspace: (params: {
          session_id: string
          workspace: string
        }) => Promise<ChatSession | null>
        checkModelAvailability: (params: {
          session_id: string
        }) => Promise<{ available: boolean; model_id?: string }>
        delete: (sessionId: string) => Promise<void>
        getMessages: (sessionId: string) => Promise<ChatMessage[]>
        touch: (sessionId: string) => Promise<void>
      }
      chat: {
        send: (params: {
          session_id: string
          content: string
          attachments?: Attachment[]
        }) => Promise<{ message_id: string }>
        abort: (sessionId: string) => Promise<void>
        onStream: (callback: (event: ChatStreamEvent) => void) => () => void
        onToolCall: (callback: (event: ChatToolCallEvent) => void) => () => void
        onToolResult: (callback: (event: ChatToolResultEvent) => void) => () => void
        onMessagePersisted: (
          callback: (event: { session_id: string; step_index: number }) => void,
        ) => () => void
        onToolConfirm: (callback: (event: ToolConfirmRequest) => void) => () => void
        sendToolConfirmResponse: (response: ToolConfirmResponse) => void
        onPermissionRequest: (callback: (event: PermissionRequest) => void) => () => void
        sendPermissionResponse: (response: PermissionResponse) => void
      }
      permissions: {
        list: (workspacePath: string) => Promise<PermissionRuleView>
        remove: (workspacePath: string, ruleId: string) => Promise<boolean>
        clearSession: (workspacePath: string) => Promise<void>
        listWorkspaces: () => Promise<Array<{ workspacePath: string; ruleCount: number }>>
      }
      mcp: {
        list: () => Promise<import('../../preload/index').MCPServer[]>
        create: (
          server: import('../../preload/index').MCPServerInput,
        ) => Promise<import('../../preload/index').MCPServer>
        get: (id: string) => Promise<import('../../preload/index').MCPServer>
        update: (
          id: string,
          updates: import('../../preload/index').MCPServerInput,
        ) => Promise<import('../../preload/index').MCPServer>
        delete: (id: string) => Promise<void>
        setEnabled: (
          id: string,
          enabled: boolean,
        ) => Promise<import('../../preload/index').MCPServer>
        testConnection: (
          server: import('../../preload/index').MCPServerInput,
        ) => Promise<import('../../preload/index').MCPConnectionTestResult>
        connect: (
          serverId: string,
        ) => Promise<{ status: string; message?: string; error_code?: string }>
        disconnect: (
          serverId: string,
        ) => Promise<{ status: string; message?: string; error_code?: string }>
        listTools: () => Promise<
          Array<{
            name: string
            description: string
            parameters: Record<string, unknown>
            schema?: Record<string, unknown>
            provider?: string
          }>
        >
        connectedServers: () => Promise<string[]>
        getServerStatus: () => Promise<
          Array<{ serverId: string; name: string; connected: boolean; toolCount: number }>
        >
      }
      window: {
        minimize: () => void
        maximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
      }
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
        }) => Promise<string[] | null>
      }
      agents: {
        list: () => Promise<unknown[]>
        get: (id: string) => Promise<unknown>
        createSession: (agentId: string) => Promise<{ session_id: string }>
        enable: (id: string) => Promise<unknown>
        delete: (id: string) => Promise<void>
        reload: () => Promise<unknown[]>
        checkDeps: (id: string) => Promise<unknown>
        export: (id: string) => Promise<unknown>
        import: () => Promise<unknown>
        installDeps: (id: string) => Promise<unknown>
        update: (id: string, profile: unknown) => Promise<void>
        startCrystallize: (sessionId: string) => Promise<{
          success: boolean
          error?: string
          workbench_session_id?: string
          reused?: boolean
          initial_prompt?: string
        }>
        finishCrystallize: (workbenchSessionId: string) => Promise<{ success: boolean }>
        createFromDraft: (
          profile: unknown,
          workbenchSessionId: string,
        ) => Promise<{
          success: boolean
          error?: string
          id?: string
          created_at?: string
          skill_install?: {
            installed: Array<{ name: string; from: string }>
            skipped: Array<{ name: string; reason: string }>
            failed: Array<{ name: string; error: string }>
          }
        }>
        listFromWorkbench: (
          workbenchSessionId: string,
        ) => Promise<Array<{ id: string; name: string; created_at: string }>>
        removeFromWorkbench: (
          workbenchSessionId: string,
          agentId: string,
        ) => Promise<{ success: boolean }>
        listTools?: (agentId: string) => Promise<
          Array<{
            name: string
            description: string
            parameters: Record<string, unknown>
            provider?: string
            riskLevel?: string
          }>
        >
        validate: (profile: unknown) => Promise<{
          valid: boolean
          errors: Array<{
            severity: 'error' | 'warn'
            rule: number
            path: string
            message: string
          }>
          warnings: Array<{
            severity: 'error' | 'warn'
            rule: number
            path: string
            message: string
          }>
        }>
        preview: (profile: unknown) => Promise<unknown>
        listTemplates: () => Promise<
          Array<{ id: string; name: string; description: string; profile: unknown }>
        >
        duplicate: (id: string) => Promise<unknown>
        dryRun: (args: { profile: unknown; userMessage: string }) => Promise<unknown>
      }
      accounts: {
        list: () => Promise<unknown[]>
        save: (account: unknown) => Promise<void>
        delete: (service: string) => Promise<void>
        getValue: (key: string) => Promise<string | null>
      }
    }
  }
}

const stubConfig = {
  get: () => Promise.resolve({ config_dir: '', providers: {}, window_bounds: {} }),
  save: () => Promise.resolve(),
}

const stubProviders = {
  list: () => Promise.resolve([] as Provider[]),
  create: () => Promise.resolve({} as Provider),
  update: () => Promise.resolve({} as Provider),
  delete: () => Promise.resolve(),
  setDefault: () => Promise.resolve(),
  testConnection: () =>
    Promise.resolve({
      status: 'failure',
      error_code: 'LLM_CONNECTION_FAILED',
    } as ConnectionTestResult),
  getModels: () =>
    Promise.resolve({
      models: [],
      refreshed_at: new Date().toISOString(),
      cache_ttl: 300,
      from_cache: false,
    } as ProviderModelResponse),
  refreshModels: () =>
    Promise.resolve({
      models: [],
      refreshed_at: new Date().toISOString(),
      cache_ttl: 300,
      from_cache: false,
    } as ProviderModelResponse),
  detectCapabilities: () => Promise.resolve({} as ModelInfo),
  updateModelCapabilities: () => Promise.resolve({} as ModelInfo),
}

const stubSession = {
  list: () => Promise.resolve([] as ChatSession[]),
  create: () =>
    Promise.resolve({
      id: '',
      title: '',
      provider_id: '',
      created_at: '',
      updated_at: '',
    } as ChatSession),
  get: () => Promise.resolve(null),
  rename: () => Promise.resolve(null),
  updateModel: () => Promise.resolve(null),
  updateWorkspace: () => Promise.resolve(null),
  checkModelAvailability: () => Promise.resolve({ available: true }),
  delete: () => Promise.resolve(),
  getMessages: () => Promise.resolve([] as ChatMessage[]),
  touch: () => Promise.resolve(),
}

const stubChat = {
  send: () => Promise.resolve({ message_id: '' }),
  abort: () => Promise.resolve(),
  onStream: () => () => {},
  onToolCall: () => () => {},
  onToolResult: () => () => {},
  onMessagePersisted: () => () => {},
  onToolConfirm: () => () => {},
  sendToolConfirmResponse: () => {},
  onPermissionRequest: () => () => {},
  sendPermissionResponse: () => {},
}

const stubPermissions = {
  list: () => Promise.resolve({ session: [], persisted: [] }),
  remove: () => Promise.resolve(false),
  clearSession: () => Promise.resolve(),
  listWorkspaces: () => Promise.resolve([]),
}

const stubMcp = {
  list: () => Promise.resolve([]),
  create: () => Promise.resolve({}),
  get: () => Promise.resolve({}),
  update: () => Promise.resolve({}),
  delete: () => Promise.resolve(),
  setEnabled: () => Promise.resolve({}),
  importConfig: () => Promise.resolve([]),
  exportConfig: () => Promise.resolve('{}'),
  testConnection: () => Promise.resolve({ status: 'failure' }),
  connect: () => Promise.resolve({ status: 'failure' }),
  disconnect: () => Promise.resolve({ status: 'failure' }),
  listTools: () => Promise.resolve([]),
  connectedServers: () => Promise.resolve([]),
  getServerStatus: () => Promise.resolve([]),
}

const stubWindow = {
  minimize: () => {},
  maximize: () => {},
  close: () => {},
  isMaximized: () => Promise.resolve(false),
}

const stubFile = {
  openDialog: () => Promise.resolve(null as string[] | null),
}

const stubAgents = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  createSession: () => Promise.resolve({ session_id: '' }),
  enable: () => Promise.resolve(null),
  delete: () => Promise.resolve(),
  reload: () => Promise.resolve([]),
  checkDeps: () => Promise.resolve(null),
  export: () => Promise.resolve(null),
  import: () => Promise.resolve(null),
  installDeps: () => Promise.resolve(null),
  update: () => Promise.resolve(),
  startCrystallize: () => Promise.resolve({ success: false, error: 'no preload' }),
  finishCrystallize: () => Promise.resolve({ success: false }),
  createFromDraft: () => Promise.resolve({ success: false, error: 'no preload' }),
  listFromWorkbench: () => Promise.resolve([]),
  removeFromWorkbench: () => Promise.resolve({ success: false }),
  listTools: () => Promise.resolve([]),
  validate: () => Promise.resolve({ valid: false, errors: [], warnings: [] }),
  preview: () => Promise.resolve(null),
  listTemplates: () => Promise.resolve([]),
  duplicate: () => Promise.resolve(null),
  dryRun: () => Promise.resolve(null),
}

const stubAccounts = {
  list: () => Promise.resolve([]),
  save: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  getValue: () => Promise.resolve(null as string | null),
}

export const talorAPI = new Proxy({} as Window['talorAPI'], {
  get(_target, prop) {
    const real = window.talorAPI
      ? (window.talorAPI as Record<string, unknown>)[prop as string]
      : undefined

    if (prop === 'config') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubConfig as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['config']
    }
    if (prop === 'providers') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubProviders as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['providers']
    }
    if (prop === 'session') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubSession as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['session']
    }
    if (prop === 'chat') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubChat as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['chat']
    }
    if (prop === 'permissions') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubPermissions as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['permissions']
    }

    if (prop === 'mcp') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubMcp as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['mcp']
    }
    if (prop === 'window') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubWindow as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['window']
    }
    if (prop === 'file') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubFile as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['file']
    }
    if (prop === 'agents') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubAgents as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['agents']
    }
    if (prop === 'accounts') {
      return new Proxy(
        {},
        {
          get: (_, p) =>
            real
              ? (real as Record<string, unknown>)?.[p as string]
              : (stubAccounts as Record<string, unknown>)?.[p as string],
        },
      ) as Window['talorAPI']['accounts']
    }
    return undefined
  },
})
