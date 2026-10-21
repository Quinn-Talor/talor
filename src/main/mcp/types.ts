export type MCPServerType = 'stdio' | 'http'

export interface MCPAuthConfig {
  type: 'none' | 'bearer' | 'apiKey'
  token?: string
  apiKey?: string
}

export interface MCPServerConfig {
  id: string
  name: string
  type: MCPServerType
  command?: string
  args?: string[]
  /** 字面环境变量(非凭据)。例: { LOG_LEVEL: 'debug' } */
  env?: Record<string, string>
  /**
   * 凭据引用。key=子进程的环境变量名,value=Account store 里的 envVar 名。
   * stdio transport 在 spawn 子进程前调用 AccountStore.resolveAccountVars 注入。
   */
  envFromAccount?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface MCPInitializeResult {
  protocolVersion: string
  serverInfo: {
    name: string
    version: string
  }
  capabilities: {
    tools?: boolean
  }
}

export interface MCPToolCallParams {
  name: string
  arguments: Record<string, unknown>
}

/**
 * tools/call 结果的内容块。type 为 text / image / audio / resource / resource_link 等,
 * 字段按 type 取用;来自外部服务端,渲染前不假设字段必然存在。
 */
export interface MCPContentBlock {
  type: string
  text?: string
  mimeType?: string
  uri?: string
  name?: string
  resource?: {
    uri?: string
    mimeType?: string
    text?: string
  }
}

export interface MCPToolCallResult {
  content: MCPContentBlock[]
  structuredContent?: unknown
  isError?: boolean
}

export interface MCPError {
  code: number
  message: string
  data?: unknown
}

export class MCPError extends Error {
  constructor(
    message: string,
    public code: number = -32603,
  ) {
    super(message)
    this.name = 'MCPError'
  }
}

/** 请求或工具执行超时。与其他 MCPError 区分,供调用方按类型分支而非匹配消息文本。 */
export class MCPTimeoutError extends MCPError {
  constructor(message: string) {
    super(message, -32603)
    this.name = 'MCPTimeoutError'
  }
}
