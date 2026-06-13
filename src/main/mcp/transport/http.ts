import log from 'electron-log'
import {
  MCPServerConfig,
  MCPTool,
  MCPInitializeResult,
  MCPToolCallResult,
  MCPError,
} from '../types'

// MCP 请求超时默认 5 分钟(与 stdio 一致)。可经构造器 timeoutMs 覆盖(测试注入短值)。
const DEFAULT_TIMEOUT_MS = 300000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = [500, 1000, 2000]

export class HttpTransport {
  private serverConfig: MCPServerConfig
  private initialized = false
  private serverInfo: { name: string; version: string } | null = null
  private headers: Record<string, string> = {}

  constructor(
    serverConfig: MCPServerConfig,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.serverConfig = serverConfig
    this.buildHeaders()
  }

  private buildHeaders(): void {
    if (this.serverConfig.auth) {
      if (this.serverConfig.auth.type === 'bearer' && this.serverConfig.auth.token) {
        this.headers['Authorization'] = `Bearer ${this.serverConfig.auth.token}`
      } else if (this.serverConfig.auth.type === 'apiKey' && this.serverConfig.auth.apiKey) {
        this.headers['X-API-Key'] = this.serverConfig.auth.apiKey
      }
    }
  }

  async connect(): Promise<void> {
    if (!this.serverConfig.url) {
      throw new MCPError('HTTP transport requires URL', -32602)
    }

    log.info('[HttpTransport] Connecting to:', this.serverConfig.url)

    const result = await this.sendRequest<MCPInitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: true },
      clientInfo: {
        name: 'talor-desktop',
        version: '0.1.0',
      },
    })

    log.info('[HttpTransport] Initialized:', result.serverInfo)
    this.serverInfo = result.serverInfo
    this.initialized = true
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest<{ tools: MCPTool[] }>('tools/list')
    return result.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const result = await this.sendRequest<MCPToolCallResult>('tools/call', {
      name,
      arguments: args,
    })
    return result
  }

  private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.serverConfig.url) {
      throw new MCPError('HTTP transport not connected', -32602)
    }

    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAY_MS[attempt - 1] ?? 2000
        log.warn(`[HttpTransport] Retry ${attempt}/${MAX_RETRIES - 1} for ${method} in ${delay}ms`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)

      try {
        const response = await fetch(this.serverConfig.url!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.headers,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Math.random().toString(36).substring(7),
            method,
            params,
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          // Only retry on 5xx server errors; 4xx are client errors, don't retry
          if (response.status >= 500 && attempt < MAX_RETRIES - 1) {
            lastErr = new MCPError(`HTTP ${response.status}: ${response.statusText}`, -32603)
            continue
          }
          throw new MCPError(`HTTP ${response.status}: ${response.statusText}`, -32603)
        }

        const data = (await response.json()) as {
          error?: { message: string; code: number }
          result?: T
        }

        if (data.error) {
          throw new MCPError(data.error.message, data.error.code)
        }

        return data.result as T
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new MCPError(`Request ${method} timed out`, -32603)
        }
        if (err instanceof MCPError) throw err
        lastErr = err
      }
    }

    throw lastErr
  }

  disconnect(): void {
    this.initialized = false
    this.serverInfo = null
  }

  isConnected(): boolean {
    return this.initialized
  }

  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo
  }
}
