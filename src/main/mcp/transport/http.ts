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

// 客户端发起的 MCP 协议版本(Streamable HTTP 在 2025-03-26 定义)。服务端会在
// initialize 响应里回它支持的版本,之后请求用协商版本回填到 MCP-Protocol-Version 头。
const CLIENT_PROTOCOL_VERSION = '2025-03-26'

/**
 * 从 SSE 文本里抽出第一条 JSON-RPC 响应(含 result 或 error)。
 * SSE 事件以空行分隔,每个事件的 `data:` 行(可多行)拼成 payload。
 */
function parseSseJsonRpc(
  text: string,
): { error?: { message: string; code: number }; result?: unknown } | null {
  for (const event of text.split(/\r?\n\r?\n/)) {
    const dataLines = event
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
    if (dataLines.length === 0) continue
    try {
      const obj = JSON.parse(dataLines.join('\n'))
      if (obj && (obj.result !== undefined || obj.error !== undefined)) return obj
    } catch {
      // 非 JSON 的 data(如心跳注释)跳过
    }
  }
  return null
}

export class HttpTransport {
  private serverConfig: MCPServerConfig
  private initialized = false
  private serverInfo: { name: string; version: string } | null = null
  private headers: Record<string, string> = {}
  // Streamable HTTP 会话态:initialize 响应里的 Mcp-Session-Id 要在后续请求回传。
  private sessionId: string | null = null
  private negotiatedProtocol = CLIENT_PROTOCOL_VERSION

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

    const result = await this.sendRequest<MCPInitializeResult & { protocolVersion?: string }>(
      'initialize',
      {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'talor-desktop',
          version: '0.1.0',
        },
      },
    )

    if (result.protocolVersion) this.negotiatedProtocol = result.protocolVersion
    log.info(
      '[HttpTransport] Initialized:',
      result.serverInfo,
      '| session:',
      this.sessionId ?? '(none)',
    )
    this.serverInfo = result.serverInfo
    this.initialized = true

    // MCP 生命周期:握手后发 initialized 通知。best-effort —— 部分服务端不要求它,
    // 失败不应让整条连接作废(tools/list 仍可用)。
    try {
      await this.sendNotification('notifications/initialized')
    } catch (err) {
      log.warn('[HttpTransport] initialized notification failed (non-fatal):', err)
    }
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
          headers: this.buildRequestHeaders(),
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

        // Streamable HTTP:initialize 响应可能带 Mcp-Session-Id,后续请求必须回传。
        const sid = response.headers?.get?.('mcp-session-id')
        if (sid) this.sessionId = sid

        const data = await this.parseJsonRpc<T>(response)

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

  /** Streamable HTTP 必需的请求头。缺 `Accept: text/event-stream` 会让规范严格的服务端回 406。 */
  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...this.headers,
    }
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    // initialize 之前还没协商版本,不带该头(规范:仅 post-initialize 请求带)。
    if (this.initialized) headers['MCP-Protocol-Version'] = this.negotiatedProtocol
    return headers
  }

  /** 同时支持 application/json 与 text/event-stream(SSE)两种响应体。 */
  private async parseJsonRpc<T>(
    response: Response,
  ): Promise<{ error?: { message: string; code: number }; result?: T }> {
    const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase()
    if (contentType.includes('text/event-stream')) {
      const text = await response.text()
      const msg = parseSseJsonRpc(text)
      if (!msg) throw new MCPError('No JSON-RPC message in SSE response', -32603)
      return msg as { error?: { message: string; code: number }; result?: T }
    }
    return (await response.json()) as { error?: { message: string; code: number }; result?: T }
  }

  /** 发送 JSON-RPC 通知(无 id,服务端回 202 无体)。失败上抛由调用方决定是否致命。 */
  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.serverConfig.url) return
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      await fetch(this.serverConfig.url, {
        method: 'POST',
        headers: this.buildRequestHeaders(),
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  disconnect(): void {
    this.initialized = false
    this.serverInfo = null
    this.sessionId = null
    this.negotiatedProtocol = CLIENT_PROTOCOL_VERSION
  }

  isConnected(): boolean {
    return this.initialized
  }

  getServerInfo(): { name: string; version: string } | null {
    return this.serverInfo
  }
}
