// src/main/repos/account-repo.ts — 基础设施层:account_keys CRUD
//
// 纯 SQL 访问,不做加密 / 不做业务校验。
// 业务层(AccountStore)负责:
//   - key name 合法性校验
//   - secret 字段加密 / 解密(走 safeStorage)
//   - list 时把 secret 打码(SECRET_MASK)
//
// 允许依赖: db/index、shared/*
// 禁止依赖: ipc/*、services/safe-storage(加密属业务层)

import { getDb } from '../db/index'
import log from 'electron-log'

/** account_keys 表单行(DB 原始形态)。 */
export interface AccountKeyRow {
  service: string
  key_name: string
  value: string
  is_secret: number // SQLite 无 bool,用 0/1
  is_encrypted: number
  updated_at: string
}

/** 业务层用的扁平记录(bool 形态)。 */
export interface AccountKeyRecord {
  service: string
  name: string
  value: string // secret 时为加密后 base64,非 secret 为明文
  secret: boolean
  encrypted: boolean
}

function rowToRecord(row: AccountKeyRow): AccountKeyRecord {
  return {
    service: row.service,
    name: row.key_name,
    value: row.value,
    secret: row.is_secret === 1,
    encrypted: row.is_encrypted === 1,
  }
}

export const accountRepo = {
  /** 列出所有 service 名(去重)。按首次出现的 updated_at 降序。 */
  listServices(): string[] {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT service FROM account_keys
         GROUP BY service
         ORDER BY MAX(updated_at) DESC`,
      )
      .all() as Array<{ service: string }>
    return rows.map((r) => r.service)
  },

  /** 拉取某个 service 下所有 key。无匹配返回 []。 */
  getKeysByService(service: string): AccountKeyRecord[] {
    const db = getDb()
    const rows = db
      .prepare(`SELECT * FROM account_keys WHERE service = ? ORDER BY key_name ASC`)
      .all(service) as AccountKeyRow[]
    return rows.map(rowToRecord)
  },

  /** 查单个 key(跨 service 按 key_name 查;用于 getValue)。无匹配返回 null。 */
  findByKeyName(keyName: string): AccountKeyRecord | null {
    const db = getDb()
    const row = db.prepare(`SELECT * FROM account_keys WHERE key_name = ? LIMIT 1`).get(keyName) as
      | AccountKeyRow
      | undefined
    return row ? rowToRecord(row) : null
  },

  /**
   * 用当前 keys 覆盖 service 下原有 keys(事务原子操作)。
   * 模拟旧 AccountStore 的 upsert 语义:一次调用后 service 的 key 集合 = 传入集合。
   */
  upsertService(service: string, keys: Array<Omit<AccountKeyRecord, 'service'>>): void {
    const db = getDb()
    const now = new Date().toISOString()
    const tx = db.transaction((records: typeof keys) => {
      db.prepare(`DELETE FROM account_keys WHERE service = ?`).run(service)
      const stmt = db.prepare(
        `INSERT INTO account_keys (service, key_name, value, is_secret, is_encrypted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const k of records) {
        stmt.run(service, k.name, k.value, k.secret ? 1 : 0, k.encrypted ? 1 : 0, now)
      }
    })
    tx(keys)
    log.info('[AccountRepo] Upserted service:', service, 'keys:', keys.length)
  },

  /** 删除整个 service 的所有 keys。不存在时 no-op。 */
  deleteService(service: string): void {
    const db = getDb()
    db.prepare(`DELETE FROM account_keys WHERE service = ?`).run(service)
    log.info('[AccountRepo] Deleted service:', service)
  },

  /** 列出所有 (service, name, value) 三元组,供 getAllValues 使用。 */
  listAll(): AccountKeyRecord[] {
    const db = getDb()
    const rows = db.prepare(`SELECT * FROM account_keys`).all() as AccountKeyRow[]
    return rows.map(rowToRecord)
  },
}
