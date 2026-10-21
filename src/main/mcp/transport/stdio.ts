import { spawn, ChildProcess } from 'child_process'
import log from 'electron-log'
import {
  MCPServerConfig,
  MCPTool,
  MCPInitializeResult,
  MCPToolCallResult,
  MCPError,
  MCPTimeoutError,
} from '../types'

// MCP 请求超时默认 5 分钟。akshare 类慢数据源单次取数常 >30s,30s 会大面积超时。
// 可经构造器 timeoutMs 覆盖(测试注入短值,避免真实等待)。
const DEFAULT_TIMEOUT_MS = 300000

// stderr 尾部保留长度:进程退出时拼进错误信息,便于定位启动失败原因。
const STDERR_TAIL_CHARS = 2000
const STDERR_IN_ERROR_CHARS = 500

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

interface JsonRpcMessage {
  id?: string | number | null
  method?: string
  result?: unknown
  error?: { message?: string; code?: number }
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * MCP stdio 传输:换行分隔的 JSON-RPC(规范要求消息内不含裸换行)。
 *
 * 不变量:子进程退出 / 启动失败 / disconnect 时,所有在途请求立即 reject,
 * 不等待各自超时;connect 失败时子进程一并清理。
 */
export class StdioTransport {
  private process: ChildProcess | null = null
  readonly serverConfig: MCPServerConfig
  private initialized = false
  private requestId = 0
  private buffer = ''
  private stderrTail = ''
  private pendingRequests = new Map<string, PendingRequest>()

  constructor(
    serverConfig: MCPServerConfig,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {
    this.serverConfig = serverConfig
  }

  async connect(): Promise<void> {
    if (!this.serverConfig.command) {
      throw new MCPError('STDIO transport requires command', -32602)
    }

    const args = this.serverConfig.args || []
    const accountEnv = await this.resolveAccountEnv()
    // envFromAccount 优先级最高,覆盖 process.env 与字面 env(防止字面值意外暴露)
    const env = {
      ...process.env,
      ...this.serverConfig.env,
      ...accountEnv,
    }

    log.info('[StdioTransport] Starting process:', this.serverConfig.command, args)

    this.buffer = ''
    this.stderrTail = ''
    const proc = spawn(this.serverConfig.command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.process = proc

    proc.stdout?.on('data', (data) => {
      if (this.process !== proc) return
      this.handleMessage(data.toString())
    })

    proc.stderr?.on('data', (data) => {
      const text = data.toString()
      log.warn('[StdioTransport] stderr:', text)
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS)
    })

    // 进程已退出时写 stdin 会触发 EPIPE;未监听会变成未捕获异常。
    proc.stdin?.on?.('error', (err) => {
      log.warn('[StdioTransport] stdin error:', err)
    })

    proc.on('error', (err) => {
      log.error('[StdioTransport] Process error:', err)
      this.handleProcessGone(proc, `failed: ${err.message}`)
    })

    proc.on('exit', (code, signal) => {
      log.info('[StdioTransport] Process exited:', code, signal)
      this.handleProcessGone(
        proc,
        code !== null ? `exited with code ${code}` : `killed by signal ${signal}`,
      )
    })

    try {
      await this.initialize()
    } catch (err) {
      this.disconnect()
      throw err
    }
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest<MCPInitializeResult>('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: true },
      clientInfo: {
        name: 'talor-desktop',
        version: '0.1.0',
      },
    })

    log.info('[StdioTransport] Initialized:', result.serverInfo)
    this.initialized = true
  }

  /** 子进程消失(退出或启动失败):标记断开并 reject 全部在途请求。只处理当前进程,忽略已被替换的旧进程。 */
  private handleProcessGone(proc: ChildProcess, reason: string): void {
    if (this.process !== proc) return
    this.process = null
    this.initialized = false
    const stderr = this.stderrTail.trim().slice(-STDERR_IN_ERROR_CHARS)
    const message = `MCP server "${this.serverConfig.name}" process ${reason}${
      stderr ? `; stderr: ${stderr}` : ''
    }`
    this.rejectAllPending(new MCPError(message, -32603))
  }

  private rejectAllPending(error: MCPError): void {
    const pending = [...this.pendingRequests.values()]
    this.pendingRequests.clear()
    for (const p of pending) {
      clearTimeout(p.timer)
      p.reject(error)
    }
  }

  /**
   * 把 envFromAccount 引用解析为可注入子进程的实际 env Map。
   * 用 dynamic import 避免在 mcp 层硬依赖 accounts 层。
   * 缺值仅 log warn,不阻断启动 — server 自行决定缺值是否致命。
   */
  private async resolveAccountEnv(): Promise<Record<string, string>> {
    if (!this.serverConfig.envFromAccount) return {}
    const { AccountStore } = await import('../../accounts/account-store')
    const store = AccountStore.getInstance()
    if (!store) {
      log.warn(
        '[StdioTransport]',
        this.serverConfig.name,
        'envFromAccount declared but AccountStore not initialized',
      )
      return {}
    }
    const { resolved, missing } = store.resolveAccountVars(this.serverConfig.envFromAccount)
    if (missing.length > 0) {
      log.warn(
        '[StdioTransport]',
        this.serverConfig.name,
        'missing Account envVars:',
        missing.join(', '),
      )
    }
    return resolved
  }

  async listTools(): Promise<MCPTool[]> {
    log.info('[StdioTransport] listTools called, sending tools/list request')
    const result = await this.sendRequest<{ tools: MCPTool[] }>('tools/list')
    log.info('[StdioTransport] listTools got result, tools count:', result.tools?.length || 0)
    return result.tools || []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const result = await this.sendRequest<MCPToolCallResult>('tools/call', {
      name,
      arguments: args,
    })
    return result
  }

  private sendRequest<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const stdin = this.process?.stdin
      if (!stdin) {
        reject(new MCPError(`MCP server "${this.serverConfig.name}" is not running`, -32603))
        return
      }

      const id = String(++this.requestId)
      const request = { jsonrpc: '2.0', id, method, params }

      log.info('[StdioTransport] sendRequest sending, id:', id, 'method:', method)

      const timer = setTimeout(() => {
        if (this.pendingRequests.delete(id)) {
          reject(new MCPTimeoutError(`Request ${method} timed out`))
        }
      }, this.timeoutMs)
      timer.unref?.()

      this.pendingRequests.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })

      stdin.write(JSON.stringify(request) + '\n')
    })
  }

  /**
   * 按换行切分 stdout:每个完整行独立解析,末尾不完整的片段留在 buffer 等下一块数据。
   * 非 JSON 行(服务端误写到 stdout 的日志)记录后丢弃,不阻塞后续消息。
   */
  private handleMessage(data: string): void {
    this.buffer += data

    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      newlineIndex = this.buffer.indexOf('\n')
      if (!line) continue

      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        log.warn('[StdioTransport] Dropping non-JSON stdout line:', line.slice(0, 200))
        continue
      }
      this.dispatch(message)
    }
  }

  private dispatch(message: unknown): void {
    if (!isJsonRpcMessage(message)) {
      log.warn('[StdioTransport] Dropping non-object JSON-RPC message')
      return
    }
    // 带 method 的是服务端发起的请求或通知,不对应本端在途请求。
    if (message.method !== undefined) {
      log.info('[StdioTransport] Ignoring server-initiated message:', message.method)
      return
    }
    if (message.id === undefined || message.id === null) return

    const id = String(message.id)
    const pending = this.pendingRequests.get(id)
    if (!pending) return
    this.pendingRequests.delete(id)
    clearTimeout(pending.timer)

    if (message.error) {
      log.error('[StdioTransport] Error response:', message.error)
      pending.reject(
        new MCPError(message.error.message ?? 'Unknown MCP error', message.error.code ?? -32603),
      )
    } else {
      log.info('[StdioTransport] Resolving request:', id, 'method:', pending.method)
      pending.resolve(message.result)
    }
  }

  disconnect(): void {
    const proc = this.process
    this.process = null
    this.initialized = false
    this.buffer = ''
    if (proc) proc.kill()
    this.rejectAllPending(
      new MCPError(`MCP server "${this.serverConfig.name}" disconnected`, -32603),
    )
  }

  isConnected(): boolean {
    return this.initialized && this.process !== null
  }
}
