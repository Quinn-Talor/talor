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
  env?: Record<string, string>
  url?: string
  auth?: MCPAuthConfig
  enabled: boolean
  /**
   * 显式标为低风险的工具名列表（不弹确认框）。
   * 未在此列表且名称不像只读操作（见 READ_ONLY_PATTERNS）的工具，都按 HIGH 处理。
   */
  lowRiskTools?: string[]
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

export interface MCPToolCallResult {
  content: Array<{
    type: 'text'
    text: string
  }>
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
    public code: number = -32603
  ) {
    super(message)
    this.name = 'MCPError'
  }
}