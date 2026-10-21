import log from 'electron-log'
import {
  MCPServerConfig,
  MCPTool,
  MCPInitializeResult,
  MCPToolCallResult,
  MCPError,
  MCPTimeoutError,
} from '../types'

// MCP 请求超时默认 5 分钟(与 stdio 一致)。可经构造器 timeoutMs 覆盖(测试注入短值)。
const DEFAULT_TIMEOUT_MS = 300000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = [500, 1000, 2000]

// 客户端发起的 MCP 协议版本(Streamable HTTP 在 2025-03-26 定义)。服务端会在
// initialize 响应里回它支持的版本,之后请求用协商版本回填到 MCP-Protocol-Version 头。
const CLIENT_PROTOCOL_VERSION = '2025-03-26'

interface JsonRpcResponse<T = unknown> {
  id?: string | number | null
  error?: { message: string; code: number }
  result?: T
}

/** 服务端 session 失效(带 Mcp-Session-Id 收到 404):调用方应重新 initialize 后重试。 */
class McpSessionExpiredError extends MCPError {
  constructor(readonly staleSessionId: string) {
    super('MCP session expired (HTTP 404)', -32603)
    this.name = 'McpSessionExpiredError'
  }
}

/**
 * 解析单个 SSE 事件块,返回与 requestId 对应的 JSON-RPC 响应(含 result 或 error)。
 * 事件的 `data:` 行(可多行)拼成 payload;非 JSON 的 data(心跳等)及其他 id 的消息跳过。
 */
function parseSseEvent(event: string, requestId: string): JsonRpcResponse | null {
  const dataLines = event
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).replace(/^ /, ''))
  if (dataLines.length === 0) return null
  let obj: unknown
  try {
    obj = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null
  const msg = obj as JsonRpcResponse
  if (msg.result === undefined && msg.error === undefined) return null
  if (msg.id !== undefined && msg.id !== null && String(msg.id) !== requestId) return null
  return msg
}

/** SSE 事件以空行分隔。返回已完整的事件与剩余未完结片段。 */
function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  return { events: parts, rest }
}

export class HttpTransport {
  readonly serverConfig: MCPServerConfig
  private initialized = false
  private serverInfo: { name: string; version: string } | null = null
  private headers: Record<string, string> = {}
  // Streamable HTTP 会话态:initialize 响应里的 Mcp-Session-Id 要在后续请求回传。
  private sessionId: string | null = null
  private negotiatedProtocol = CLIENT_PROTOCOL_VERSION
  private reinitializing: Promise<void> | null = null

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

    const result = await this.sendRequestOnce<MCPInitializeResult & { protocolVersion?: string }>(
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

  /**
   * 带 session 的请求收到 404 表示服务端 session 已失效(重启 / 过期):
   * 清掉 session 重新 initialize,再重试一次原请求。
   */
  private async sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    try {
      return await this.sendRequestOnce<T>(method, params)
    } catch (err) {
      if (!(err instanceof McpSessionExpiredError)) throw err
      log.warn('[HttpTransport] Session expired, re-initializing before retrying', method)
      await this.reinitialize(err.staleSessionId)
      return await this.sendRequestOnce<T>(method, params)
    }
  }

  /**
   * 并发请求同时遇到 session 失效时只做一次 initialize;
   * 若当前 session 已不是失效的那个(别的请求已完成重建),直接复用。
   */
  private reinitialize(staleSessionId: string): Promise<void> {
    if (!this.reinitializing) {
      if (this.sessionId !== staleSessionId) return Promise.resolve()
      this.initialized = false
      this.sessionId = null
      this.negotiatedProtocol = CLIENT_PROTOCOL_VERSION
      this.reinitializing = this.connect().finally(() => {
        this.reinitializing = null
      })
    }
    return this.reinitializing
  }

  private async sendRequestOnce<T>(method: string, params?: Record<string, unknown>): Promise<T> {
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

      // 超时覆盖 headers + body 全程;结束时 abort 释放底层连接(SSE 流可能不主动关闭)。
      const controller = new AbortController()
      let timedOut = false
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, this.timeoutMs)
      const requestId = Math.random().toString(36).substring(7)
      const sentSessionId = this.sessionId

      try {
        const response = await fetch(this.serverConfig.url, {
          method: 'POST',
          headers: this.buildRequestHeaders(),
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: requestId,
            method,
            params,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          if (response.status === 404 && sentSessionId && method !== 'initialize') {
            throw new McpSessionExpiredError(sentSessionId)
          }
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

        const data = await this.parseJsonRpc<T>(response, requestId)

        if (data.error) {
          throw new MCPError(data.error.message, data.error.code)
        }

        return data.result as T
      } catch (err) {
        if (timedOut) {
          throw new MCPTimeoutError(`Request ${method} timed out`)
        }
        if (err instanceof MCPError) throw err
        lastErr = err
      } finally {
        clearTimeout(timeoutId)
        controller.abort()
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

  /**
   * 同时支持 application/json 与 text/event-stream(SSE)两种响应体。
   * SSE 流式读取,拿到 requestId 对应的响应即返回,不等待服务端关流。
   */
  private async parseJsonRpc<T>(
    response: Response,
    requestId: string,
  ): Promise<JsonRpcResponse<T>> {
    const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase()
    if (!contentType.includes('text/event-stream')) {
      return (await response.json()) as JsonRpcResponse<T>
    }

    const reader = response.body?.getReader?.()
    if (!reader) {
      const { events, rest } = splitSseEvents(await response.text())
      for (const event of [...events, rest]) {
        const msg = parseSseEvent(event, requestId)
        if (msg) return msg as JsonRpcResponse<T>
      }
      throw new MCPError('No JSON-RPC message in SSE response', -32603)
    }

    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          const msg = parseSseEvent(buffer, requestId)
          if (msg) return msg as JsonRpcResponse<T>
          throw new MCPError('No JSON-RPC message in SSE response', -32603)
        }
        buffer += decoder.decode(value, { stream: true })
        const { events, rest } = splitSseEvents(buffer)
        buffer = rest
        for (const event of events) {
          const msg = parseSseEvent(event, requestId)
          if (msg) return msg as JsonRpcResponse<T>
        }
      }
    } finally {
      reader.cancel().catch((err: unknown) => log.warn('[HttpTransport] SSE cancel failed:', err))
    }
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
      controller.abort()
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
