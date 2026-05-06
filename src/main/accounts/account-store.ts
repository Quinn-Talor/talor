// src/main/accounts/account-store.ts — 业务层:账户凭据管理
//
// 凭据存 DB(account_keys 表,见 src/main/repos/account-repo.ts)。
// secret 字段使用 SafeStorageService 加密后以 base64 存入 value 列,
// 由 is_encrypted=1 标记;非 secret 明文存 value 列。
//
// 允许依赖: services/safe-storage、repos/account-repo、shared/*
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Account } from '@shared/types/agent'
import { accountRepo, type AccountKeyRecord } from '../repos/account-repo'

const SECRET_MASK = '••••••'
const KEY_NAME_REGEX = /^[a-zA-Z0-9_]+$/

export interface SafeStorageProvider {
  isAvailable(): boolean
  encrypt(value: string): string
  decrypt(encrypted: string): string
}

export class AccountStore {
  constructor(private readonly safeStorage?: SafeStorageProvider) {}

  /** 按 service 聚合展示列表。secret 字段以 SECRET_MASK 替代,永不返回明文。 */
  list(): Account[] {
    const services = accountRepo.listServices()
    return services.map((service) => ({
      service,
      keys: accountRepo.getKeysByService(service).map((k) => ({
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

    // secret 走 safeStorage 加密(不可用时降级明文存 + 打警告);
    // 非 secret 直接明文存。一列 value 分工,is_encrypted 区分读取路径,
    // 避免宽表 + 空字段。
    const records: Array<Omit<AccountKeyRecord, 'service'>> = account.keys.map((k) => {
      if (k.secret && this.safeStorage?.isAvailable()) {
        return {
          name: k.name,
          value: this.safeStorage.encrypt(k.value),
          secret: true,
          encrypted: true,
        }
      }
      if (k.secret) {
        log.warn('[AccountStore] safeStorage unavailable, storing secret in plaintext:', k.name)
      }
      return { name: k.name, value: k.value, secret: k.secret, encrypted: false }
    })

    accountRepo.upsertService(account.service, records)
    log.info('[AccountStore] Saved account:', account.service)
  }

  delete(service: string): void {
    accountRepo.deleteService(service)
  }

  /**
   * 按 key name 查找真实 value(自动解密 secret)。
   *
   * 注意:多个 service 含同名 key 时取首个匹配(与旧 JSON 实现一致)。
   * 建议业务约定 key name 全局唯一(例如 service 前缀)。
   */
  getValue(keyName: string): string | undefined {
    const rec = accountRepo.findByKeyName(keyName)
    if (!rec) return undefined

    if (rec.encrypted) {
      if (!this.safeStorage?.isAvailable()) {
        log.error('[AccountStore] Key is encrypted but safeStorage unavailable:', keyName)
        return undefined
      }
      try {
        return this.safeStorage.decrypt(rec.value)
      } catch (err) {
        log.error('[AccountStore] Failed to decrypt key:', keyName, err)
        return undefined
      }
    }
    return rec.value
  }

  /** 把所有 keys 铺平成 name→value Map,供工具注入(secret 自动解密)。 */
  getAllValues(): Map<string, string> {
    const map = new Map<string, string>()
    for (const rec of accountRepo.listAll()) {
      if (rec.encrypted) {
        if (!this.safeStorage?.isAvailable()) continue
        try {
          map.set(rec.name, this.safeStorage.decrypt(rec.value))
        } catch (err) {
          log.error('[AccountStore] Failed to decrypt in getAllValues:', rec.name, err)
        }
      } else {
        map.set(rec.name, rec.value)
      }
    }
    return map
  }
}
