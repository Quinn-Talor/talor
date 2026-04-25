import log from 'electron-log'

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'google'

export interface TestConfig {
  type: ProviderType
  base_url: string
  api_key?: string
}

export interface ConnectionTestResult {
  status: 'success' | 'failure'
  latency_ms?: number
  models_count?: number
  error_code?: 'CONNECTION_REFUSED' | 'TIMEOUT' | 'AUTH_FAILED' | 'QUOTA_EXCEEDED' | 'UNKNOWN'
  message?: string
}

let activeController: AbortController | null = null

export async function testConnection(config: TestConfig): Promise<ConnectionTestResult> {
  if (activeController) {
    activeController.abort()
  }
  activeController = new AbortController()

  const controller = activeController
  const timeout = setTimeout(() => {
    controller.abort()
  }, 5000)

  const start = Date.now()

  try {
    const endpoint = buildEndpoint(config)
    const headers: Record<string, string> = {}

    if (config.api_key) {
      headers['Authorization'] = `Bearer ${config.api_key}`
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal
    })

    clearTimeout(timeout)

    if (response.status === 401 || response.status === 403) {
      return {
        status: 'failure',
        error_code: 'AUTH_FAILED',
        message: '认证失败：Invalid API Key'
      }
    }

    if (response.status === 429) {
      return {
        status: 'failure',
        error_code: 'QUOTA_EXCEEDED',
        message: 'API Key 有效但配额不足，请检查账户余额'
      }
    }

    if (!response.ok) {
      return {
        status: 'failure',
        error_code: 'UNKNOWN',
        message: `连接失败：服务器返回错误 ${response.status}`
      }
    }

    const data = await response.json()
    const modelsCount = extractModelsCount(config.type, data)

    return {
      status: 'success',
      latency_ms: Date.now() - start,
      models_count: modelsCount
    }
  } catch (error) {
    clearTimeout(timeout)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 'failure',
        error_code: 'TIMEOUT',
        message: '连接超时，请检查网络或 base_url'
      }
    }

    log.warn('[ProviderTester] Connection test failed:', error)

    const errMsg = error instanceof Error ? error.message : String(error)

    if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
      return {
        status: 'failure',
        error_code: 'CONNECTION_REFUSED',
        message: `连接失败：无法连接到 ${config.base_url}，请确认服务已启动`
      }
    }

    return {
      status: 'failure',
      error_code: 'UNKNOWN',
      message: `连接失败：${errMsg}`
    }
  }
}

function buildEndpoint(config: TestConfig): string {
  const base = config.base_url.replace(/\/$/, '')

  switch (config.type) {
    case 'ollama':
      return `${base}/api/tags`
    case 'openai':
    case 'anthropic':
    case 'google':
      return `${base}/v1/models`
  }
}

function extractModelsCount(type: ProviderType, data: unknown): number {
  if (!data || typeof data !== 'object') return 0

  switch (type) {
    case 'ollama': {
      const d = data as { models?: unknown[] }
      return Array.isArray(d.models) ? d.models.length : 0
    }
    case 'openai': {
      const d = data as { data?: unknown[] }
      return Array.isArray(d.data) ? d.data.length : 0
    }
    case 'anthropic': {
      const d = data as { models?: unknown[] }
      return Array.isArray(d.models) ? d.models.length : 0
    }
    case 'google': {
      const d = data as { models?: unknown[] }
      return Array.isArray(d.models) ? d.models.length : 0
    }
  }
}
