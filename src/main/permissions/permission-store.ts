// src/main/permissions/permission-store.ts — 业务层：权限规则存储
//
// 两层存储：
//   1. Session 层：内存 Map<workspacePath, PermissionRule[]>，进程退出即失
//   2. Persisted 层：per-workspace JSON 文件（~/.talor/workspaces/<sha1>/permissions.json）
//
// Workspace 切换不做自动迁移——sha1(新路径) 不同，旧规则自然不匹配；
// 老 workspace 的 json 保留在磁盘上，视为历史授权记录，不主动清理。
//
// 允许依赖：shared/*
// 禁止依赖：ipc/*

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import log from 'electron-log'
import type {
  PermissionRule,
  WorkspacePermissions,
  PermissionRuleView,
} from '@shared/types/permissions'

/**
 * 规则创建的原始输入——id + createdAt 由 store 填充。
 * scope 已纳入 PermissionRule 本体，但此接口刻意省略，交给 store.addXxx 方法二选一。
 */
export type RuleInput = Omit<PermissionRule, 'id' | 'createdAt' | 'scope'>

const SCHEMA_VERSION = 1

export class PermissionStore {
  /** workspacePath → session rules */
  private sessionRules = new Map<string, PermissionRule[]>()
  /** workspacePath → persisted rules（lazy-loaded from disk） */
  private persistedCache = new Map<string, PermissionRule[]>()

  private workspaceDir(workspacePath: string): string {
    const hash = createHash('sha1').update(workspacePath).digest('hex').slice(0, 16)
    return join(app.getPath('home'), '.talor', 'workspaces', hash)
  }

  private workspaceFile(workspacePath: string): string {
    return join(this.workspaceDir(workspacePath), 'permissions.json')
  }

  /**
   * 读取 persisted 规则。首次读时从磁盘加载进 cache，后续直接走 cache。
   * 文件不存在或损坏都视为空列表，不抛错——权限缺失不应阻塞业务。
   */
  loadPersisted(workspacePath: string): PermissionRule[] {
    const cached = this.persistedCache.get(workspacePath)
    if (cached !== undefined) return cached

    const file = this.workspaceFile(workspacePath)
    if (!existsSync(file)) {
      this.persistedCache.set(workspacePath, [])
      return []
    }

    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as WorkspacePermissions
      if (raw.schemaVersion !== SCHEMA_VERSION) {
        log.warn(`[PermissionStore] schemaVersion mismatch (expected ${SCHEMA_VERSION}, got ${raw.schemaVersion}) in ${file}, ignoring`)
        this.persistedCache.set(workspacePath, [])
        return []
      }
      const rules = Array.isArray(raw.rules) ? raw.rules : []
      this.persistedCache.set(workspacePath, rules)
      return rules
    } catch (err) {
      log.warn(`[PermissionStore] failed to load ${file}:`, err)
      this.persistedCache.set(workspacePath, [])
      return []
    }
  }

  /** 原子写盘：先写 .tmp 再 rename，避免半写损坏。 */
  private savePersisted(workspacePath: string, rules: PermissionRule[]): void {
    const dir = this.workspaceDir(workspacePath)
    mkdirSync(dir, { recursive: true })
    const file = this.workspaceFile(workspacePath)
    const tmp = file + '.tmp'
    const payload: WorkspacePermissions = {
      workspacePath,
      rules,
      schemaVersion: SCHEMA_VERSION,
    }
    writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8')
    renameSync(tmp, file)
    this.persistedCache.set(workspacePath, rules)
  }

  /** 在 session 层追加一条规则，返回完整 rule（含填充的 id/createdAt）。 */
  addSessionRule(workspacePath: string, input: RuleInput): PermissionRule {
    const rule: PermissionRule = {
      ...input,
      id: uuidv4(),
      scope: 'session',
      createdAt: new Date().toISOString(),
    }
    const list = this.sessionRules.get(workspacePath) ?? []
    list.push(rule)
    this.sessionRules.set(workspacePath, list)
    return rule
  }

  /** 在 persisted 层追加一条规则并立即落盘。 */
  addPersistedRule(workspacePath: string, input: RuleInput): PermissionRule {
    const rule: PermissionRule = {
      ...input,
      id: uuidv4(),
      scope: 'persisted',
      createdAt: new Date().toISOString(),
    }
    const existing = this.loadPersisted(workspacePath)
    this.savePersisted(workspacePath, [...existing, rule])
    return rule
  }

  /**
   * 删除规则（按 id）。自动在 session + persisted 两层查找。
   * 返回是否真的删掉了。
   */
  removeRule(workspacePath: string, ruleId: string): boolean {
    const session = this.sessionRules.get(workspacePath) ?? []
    const sessionNext = session.filter(r => r.id !== ruleId)
    if (sessionNext.length !== session.length) {
      this.sessionRules.set(workspacePath, sessionNext)
      return true
    }

    const persisted = this.loadPersisted(workspacePath)
    const persistedNext = persisted.filter(r => r.id !== ruleId)
    if (persistedNext.length !== persisted.length) {
      this.savePersisted(workspacePath, persistedNext)
      return true
    }

    return false
  }

  /** 清空指定 workspace 的所有 session 规则（不影响 persisted）。 */
  clearSession(workspacePath: string): void {
    this.sessionRules.delete(workspacePath)
  }

  /** 清空本进程所有 workspace 的 session 规则。 */
  clearAllSessions(): void {
    this.sessionRules.clear()
  }

  /**
   * 测试 hook：清空 session + 持久化缓存，强制下次 loadPersisted 重新读盘。
   * 生产代码**不要**调用——workspacePath → sha1(hash) 已隔离不同 workspace，
   * 缓存在正常使用里不会出现陈旧。仅在单测切换 fakeHome 时需要。
   */
  _resetForTests(): void {
    this.sessionRules.clear()
    this.persistedCache.clear()
  }

  /**
   * 列出当前 workspace 的所有规则，分为 session 和 persisted 两组。
   * 给 Settings UI 展示用。
   */
  listAll(workspacePath: string): PermissionRuleView {
    return {
      session: [...(this.sessionRules.get(workspacePath) ?? [])],
      persisted: [...this.loadPersisted(workspacePath)],
    }
  }

  /**
   * 匹配器使用：返回 session + persisted 合并后的规则列表（session 在前）。
   * Matcher 按 deny-first 策略遍历。
   */
  allRulesFor(workspacePath: string): PermissionRule[] {
    const session = this.sessionRules.get(workspacePath) ?? []
    const persisted = this.loadPersisted(workspacePath)
    return [...session, ...persisted]
  }
}

/** 进程级单例。业务代码统一用此实例，避免多处状态不同步。 */
export const permissionStore = new PermissionStore()
