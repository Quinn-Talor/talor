import { spawn, ChildProcess } from 'child_process'
import log from 'electron-log'
import {
  MCPServerConfig,
  MCPTool,
  MCPInitializeResult,
  MCPToolCallResult,
  MCPError,
} from '../types'

const TIMEOUT_MS = 30000

export class StdioTransport {
  private process: ChildProcess | null = null
  private serverConfig: MCPServerConfig
  private initialized = false
  private requestId = 0
  private buffer = ''
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
  }>()

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig
  }

  async connect(): Promise<void> {
    if (!this.serverConfig.command) {
      throw new MCPError('STDIO transport requires command', -32602)
    }

    const args = this.serverConfig.args || []
    const env = { ...process.env, ...this.serverConfig.env }

    log.info('[StdioTransport] Starting process:', this.serverConfig.command, args)

    return new Promise((resolve, reject) => {
      this.process = spawn(this.serverConfig.command!, args, {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.process.stdout?.on('data', (data) => {
        this.handleMessage(data.toString())
      })

      this.process.stderr?.on('data', (data) => {
        log.warn('[StdioTransport] stderr:', data.toString())
      })

      this.process.on('error', (err) => {
        log.error('[StdioTransport] Process error:', err)
        reject(err)
      })

      this.process.on('exit', (code) => {
        log.info('[StdioTransport] Process exited:', code)
        this.initialized = false
      })

      this.initialize().then(resolve).catch(reject)
    })
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
      const id = String(++this.requestId)
      const request = { jsonrpc: '2.0', id, method, params }
      
      log.info('[StdioTransport] sendRequest sending, id:', id, 'method:', method)

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      })

      this.process?.stdin?.write(JSON.stringify(request) + '\n')

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new MCPError(`Request ${method} timed out`, -32603))
        }
      }, TIMEOUT_MS)
    })
  }

  private handleMessage(data: string): void {
    // Accumulate data until we have a complete JSON message
    this.buffer += data
    
    // Try to parse complete JSON messages (handle multi-line JSON from string values)
    while (this.buffer.length > 0) {
      // Try to find a complete JSON object
      const firstBrace = this.buffer.indexOf('{')
      if (firstBrace === -1) {
        // No JSON found, clear buffer
        this.buffer = ''
        break
      }
      
      // Try to parse from the first '{'
      const tryParse = this.buffer.substring(firstBrace)
      try {
        const message = JSON.parse(tryParse)
        // Got a complete message, remove it from buffer
        this.buffer = this.buffer.substring(firstBrace + tryParse.length).trimStart()
        
        // Now handle the message
        log.info('[StdioTransport] Parsed complete message, has id:', !!message.id, 'keys:', Object.keys(message))
        
        if (message.id && this.pendingRequests.has(message.id)) {
          const pending = this.pendingRequests.get(message.id)!
          this.pendingRequests.delete(message.id)

          if (message.error) {
            log.error('[StdioTransport] Error response:', message.error)
            pending.reject(new MCPError(message.error.message, message.error.code))
          } else {
            log.info('[StdioTransport] Resolving request:', message.id, 'with result keys:', Object.keys(message.result || {}))
            pending.resolve(message.result)
          }
        }
      } catch {
        // Incomplete JSON, wait for more data
        break
      }
    }
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
      this.initialized = false
    }
  }

  isConnected(): boolean {
    return this.initialized && this.process !== null
  }
}