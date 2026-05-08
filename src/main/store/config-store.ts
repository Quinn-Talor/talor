import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import log from 'electron-log'
import type { ModelInfo } from '@shared/types/models'

interface WindowBounds {
  width: number
  height: number
  x: number
  y: number
  is_maximized: boolean
}

/**
 * Subagent delegation 配置（系统级，所有 session 共享）。
 * 不开放 profile 级覆盖（KISS：MVP 阶段）。
 *
 * 字段命名用 camelCase 与 delegate-agent.ts 的 DelegationConfig 类型对齐
 * （运行时透传，无需翻译层）。
 */
export interface DelegationConfig {
  /** 同 session 同时执行的 delegation 数上限。默认 10。 */
  maxConcurrencyPerSession: number
  /** delegation 在 p-limit 队列里等待的最长时间（ms）。默认 300_000 (5min)。 */
  queueTimeoutMs: number
  /** 单次 delegation 实际执行的最长时间（ms）。默认 1_800_000 (30min)。 */
  executionTimeoutMs: number
}

interface AppConfig {
  config_dir: string
  providers: Record<string, Provider>
  window_bounds: WindowBounds
  default_context_limit?: number
  default_recent_ratio?: number
  default_summary_ratio?: number
  max_react_steps?: number
  delegation?: DelegationConfig
}

export interface Provider {
  id: string
  type: 'ollama' | 'openai' | 'anthropic' | 'google'
  name: string
  base_url: string
  models: ModelInfo[] // Updated: ModelInfo objects instead of string array
  enabled: boolean
  is_default: boolean
  supports_vision: boolean
  created_at: string
  updated_at: string
  // New fields for model caching
  models_last_updated?: string // ISO timestamp of last model list update
  models_cache_ttl?: number // Cache TTL in seconds (default: 300)
  context_limit?: number
  recent_ratio?: number
  summary_ratio?: number
}

export interface ProviderInput {
  type: 'ollama' | 'openai' | 'anthropic' | 'google'
  name: string
  base_url: string
  api_key?: string
  enabled: boolean
  is_default: boolean
  supports_vision?: boolean
  models?: ModelInfo[] // Updated: ModelInfo objects instead of string array
}

interface StoreSchema {
  config: AppConfig
}

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  maxConcurrencyPerSession: 10,
  queueTimeoutMs: 300_000, // 5 min
  executionTimeoutMs: 1_800_000, // 30 min
}

const DEFAULT_CONFIG: AppConfig = {
  config_dir: '.talor',
  providers: {},
  window_bounds: {
    width: 1200,
    height: 800,
    x: 0,
    y: 0,
    is_maximized: false,
  },
  default_context_limit: 1_000_000,
  default_recent_ratio: 0.05,
  default_summary_ratio: 0.05,
  delegation: DEFAULT_DELEGATION_CONFIG,
}

export class ConfigStore {
  private static instance: ConfigStore | null = null
  private store: Store<StoreSchema>
  private configPath: string

  private constructor() {
    this.configPath = join(app.getPath('home'), '.talor', 'config.json')
    this.store = new Store<StoreSchema>({
      name: 'config',
      cwd: join(app.getPath('home'), '.talor'),
      defaults: { config: DEFAULT_CONFIG },
    })
  }

  static getInstance(): ConfigStore {
    if (!ConfigStore.instance) {
      ConfigStore.instance = new ConfigStore()
    }
    return ConfigStore.instance
  }

  ensureInitialized(): void {
    const dir = join(app.getPath('home'), '.talor')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      log.info('[ConfigStore] Created config directory:', dir)
    }

    if (!existsSync(this.configPath)) {
      this.saveConfig(DEFAULT_CONFIG)
      log.info('[ConfigStore] Created default config at:', this.configPath)
      return
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8')
      JSON.parse(content)
    } catch {
      log.warn('[ConfigStore] Config file corrupted, backing up and recreating')
      const backupPath = this.configPath + '.bak'
      try {
        renameSync(this.configPath, backupPath)
      } catch {
        unlinkSync(this.configPath)
      }
      this.saveConfig(DEFAULT_CONFIG)
      log.info('[ConfigStore] Backed up corrupted config to:', backupPath)
    }
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K]
  get(key: string): unknown
  get(key: string): unknown {
    const config = this.store.get('config') ?? DEFAULT_CONFIG
    const value = (config as unknown as Record<string, unknown>)[key]
    if (value === undefined) return (DEFAULT_CONFIG as unknown as Record<string, unknown>)[key]
    return value
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    const config = this.store.get('config') ?? DEFAULT_CONFIG
    ;(config as unknown as Record<string, unknown>)[key] = value
    this.saveConfig(config)
  }

  getAll(): AppConfig {
    return this.store.get('config') ?? DEFAULT_CONFIG
  }

  /**
   * 读 delegation 命名空间。缺失字段用默认值兜底（不 throw），保证旧安装包升级
   * 后立即可用。
   */
  getDelegation(): DelegationConfig {
    const stored = this.get('delegation') as Partial<DelegationConfig> | undefined
    return { ...DEFAULT_DELEGATION_CONFIG, ...(stored ?? {}) }
  }

  /** 写 delegation 命名空间，merge 风格（保留未指定字段）。 */
  setDelegation(partial: Partial<DelegationConfig>): void {
    const current = this.getDelegation()
    this.set('delegation', { ...current, ...partial })
  }

  private saveConfig(config: AppConfig): void {
    const tmpPath = this.configPath + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    renameSync(tmpPath, this.configPath)
    this.store.set('config', config)
    log.info('[ConfigStore] Config saved')
  }
}
