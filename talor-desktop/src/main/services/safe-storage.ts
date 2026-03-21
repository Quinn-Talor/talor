import { safeStorage } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import log from 'electron-log'

interface EncryptedKeys {
  [providerId: string]: string
}

export class SafeStorageService {
  private static instance: SafeStorageService | null = null
  private keysPath: string
  private keys: EncryptedKeys = {}

  private constructor() {
    const dir = join(app.getPath('home'), '.talor')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.keysPath = join(dir, 'api-keys.enc')
    this.load()
  }

  static getInstance(): SafeStorageService {
    if (!SafeStorageService.instance) {
      SafeStorageService.instance = new SafeStorageService()
    }
    return SafeStorageService.instance
  }

  private load(): void {
    if (!existsSync(this.keysPath)) {
      this.keys = {}
      return
    }
    try {
      const raw = readFileSync(this.keysPath)
      this.keys = JSON.parse(raw.toString('utf-8'))
    } catch {
      log.warn('[SafeStorage] Failed to load api-keys.enc, starting fresh')
      this.keys = {}
    }
  }

  private save(): void {
    writeFileSync(this.keysPath, JSON.stringify(this.keys, null, 2), 'utf-8')
  }

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  setApiKey(providerId: string, apiKey: string): void {
    if (!this.isAvailable()) {
      log.warn('[SafeStorage] Encryption not available, skipping encryption')
      return
    }
    const encrypted = safeStorage.encryptString(apiKey)
    this.keys[providerId] = encrypted.toString('base64')
    this.save()
    log.info('[SafeStorage] API key saved for provider:', providerId)
  }

  getApiKey(providerId: string): string | null {
    if (!this.isAvailable()) {
      log.warn('[SafeStorage] Encryption not available, cannot retrieve keys')
      return null
    }
    const encrypted = this.keys[providerId]
    if (!encrypted) return null
    try {
      const buffer = Buffer.from(encrypted, 'base64')
      return safeStorage.decryptString(buffer)
    } catch {
      log.error('[SafeStorage] Failed to decrypt API key for provider:', providerId)
      return null
    }
  }

  removeApiKey(providerId: string): void {
    delete this.keys[providerId]
    this.save()
    log.info('[SafeStorage] API key removed for provider:', providerId)
  }
}
