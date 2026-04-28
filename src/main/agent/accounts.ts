// src/main/agent/accounts.ts — 业务层：账户凭证管理
//
// secret 字段使用 SafeStorageService 加密存储（ADR, G1）。
// 非 secret 字段明文存储。
//
// 允许依赖：services/safe-storage、shared/*
// 禁止依赖：ipc/*

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import log from 'electron-log'
import type { Account, AccountsData } from '@shared/types/agent'

const SECRET_MASK = '••••••'
const KEY_NAME_REGEX = /^[a-zA-Z0-9_]+$/

interface StoredAccountKey {
  name: string
  value: string
  encrypted?: string
  secret: boolean
}

interface StoredAccount {
  service: string
  keys: StoredAccountKey[]
}

export interface SafeStorageProvider {
  isAvailable(): boolean
  encrypt(value: string): string
  decrypt(encrypted: string): string
}

export class AccountStore {
  private accounts: StoredAccount[] = []

  constructor(
    private readonly filePath: string,
    private readonly safeStorage?: SafeStorageProvider,
  ) {
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8')
        const data = JSON.parse(raw) as { accounts: StoredAccount[] }
        this.accounts = data.accounts ?? []
      }
    } catch (err) {
      log.warn('[AccountStore] Failed to load accounts:', err)
      this.accounts = []
    }
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data = { accounts: this.accounts }
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      log.error('[AccountStore] Failed to persist accounts:', err)
    }
  }

  list(): Account[] {
    return this.accounts.map(acc => ({
      service: acc.service,
      keys: acc.keys.map(k => ({
        name: k.name,
        value: k.secret ? SECRET_MASK : k.value,
        secret: k.secret,
      })),
    }))
  }

  save(account: Account): void {
    for (const key of account.keys) {
      if (!KEY_NAME_REGEX.test(key.name)) {
        throw new Error(`Invalid key name: "${key.name}" — must match ${KEY_NAME_REGEX}`)
      }
    }

    const storedKeys: StoredAccountKey[] = account.keys.map(k => {
      if (k.secret && this.safeStorage?.isAvailable()) {
        return {
          name: k.name,
          value: '',
          encrypted: this.safeStorage.encrypt(k.value),
          secret: true,
        }
      }
      return { name: k.name, value: k.value, secret: k.secret }
    })

    const storedAccount: StoredAccount = { service: account.service, keys: storedKeys }

    const idx = this.accounts.findIndex(a => a.service === account.service)
    if (idx >= 0) {
      this.accounts[idx] = storedAccount
    } else {
      this.accounts.push(storedAccount)
    }
    this.persist()
    log.info('[AccountStore] Saved account:', account.service)
  }

  delete(service: string): void {
    this.accounts = this.accounts.filter(a => a.service !== service)
    this.persist()
    log.info('[AccountStore] Deleted account:', service)
  }

  getValue(keyName: string): string | undefined {
    for (const acc of this.accounts) {
      const key = acc.keys.find(k => k.name === keyName)
      if (!key) continue

      if (key.secret && key.encrypted && this.safeStorage?.isAvailable()) {
        try {
          return this.safeStorage.decrypt(key.encrypted)
        } catch (err) {
          log.error('[AccountStore] Failed to decrypt key:', keyName, err)
          return undefined
        }
      }
      return key.value
    }
    return undefined
  }

  getAllValues(): Map<string, string> {
    const map = new Map<string, string>()
    for (const acc of this.accounts) {
      for (const key of acc.keys) {
        const value = this.getValue(key.name)
        if (value !== undefined) map.set(key.name, value)
      }
    }
    return map
  }
}
