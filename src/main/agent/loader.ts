// src/main/agent/loader.ts — 业务层：Agent 加载器
//
// 启动时扫描 ~/.talor/agents/ 目录，校验每个 agent.json，构建内存索引。
//
// 允许依赖：agent/*、shared/*
// 禁止依赖：ipc/*

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { validateProfile } from './validator'
import type { AgentEntry, AgentStatus } from '@shared/types/agent'

export class AgentLoader {
  private readonly entries = new Map<string, AgentEntry>()
  readonly agentsDir: string

  constructor(agentsDir: string) {
    this.agentsDir = agentsDir
    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true })
      log.info('[AgentLoader] Created agents directory:', agentsDir)
    }
  }

  loadAll(): void {
    this.entries.clear()
    let dirs: string[]
    try {
      dirs = readdirSync(this.agentsDir)
    } catch (err) {
      log.warn('[AgentLoader] Failed to read agents directory:', err)
      return
    }

    for (const name of dirs) {
      const dirPath = join(this.agentsDir, name)
      try {
        if (!statSync(dirPath).isDirectory()) continue
      } catch {
        continue
      }

      const jsonPath = join(dirPath, 'agent.json')
      if (!existsSync(jsonPath)) continue

      try {
        const raw = readFileSync(jsonPath, 'utf-8')
        const json = JSON.parse(raw)

        // 运行时清洗存量数据 — 不写回磁盘(避免数据丢失),仅清理内存中的 profile
        const sanitized = sanitizeOnLoad(json, name)

        // lenientCredentialScan: rule 11 降为 warning,确保存量 agent 即使有可疑值也能加载,
        // 让用户在 AgentEditPage 自行迁移到 envFromAccount。write 路径仍是严格 error。
        const result = validateProfile(sanitized, {
          agentRoot: dirPath,
          lenientCredentialScan: true,
        })

        if (!result.valid) {
          const summary = result.errors
            .slice(0, 5)
            .map((e) => `[rule ${e.rule}] ${e.path}: ${e.message}`)
            .join(' | ')
          log.warn(
            '[AgentLoader] Invalid agent.json in',
            name,
            `(${result.errors.length} errors):`,
            summary,
          )
          continue
        }

        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            log.warn(`[AgentLoader] ${name} [rule ${w.rule}] ${w.path}: ${w.message}`)
          }
        }

        this.entries.set(result.profile.id, {
          profile: result.profile,
          dirPath,
          status: 'disabled',
        })
        log.info('[AgentLoader] Loaded agent:', result.profile.id, result.profile.name)
      } catch (err) {
        log.warn('[AgentLoader] Failed to parse agent.json in', name, ':', err)
      }
    }

    log.info('[AgentLoader] Loaded', this.entries.size, 'agents from', this.agentsDir)
  }

  getById(id: string): AgentEntry | undefined {
    return this.entries.get(id)
  }

  getByName(name: string): AgentEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.profile.name === name) return entry
    }
    return undefined
  }

  getAll(): AgentEntry[] {
    return Array.from(this.entries.values())
  }

  setStatus(id: string, status: AgentStatus): void {
    const entry = this.entries.get(id)
    if (entry) {
      entry.status = status
    }
  }

  remove(id: string): boolean {
    return this.entries.delete(id)
  }

  get size(): number {
    return this.entries.size
  }
}

/**
 * 运行时清洗存量 agent.json 数据(仅内存,不写回磁盘)。
 *
 * 当前清洗项:
 *   - 删除 `mcpServers[].serverPackage` 死字段(schema 已无此字段,留着会污染下游)
 *
 * 凭据嫌疑值(`mcpServers[].transport.stdio.env[k]`)**不删** —
 * 删除会让 MCP server 起不来,损失更大;由 validator lenientCredentialScan 降级为
 * warning + log,引导用户迁到 envFromAccount。
 */
function sanitizeOnLoad(raw: unknown, agentDirName: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>

  const mcpServers = cloned.mcpServers
  if (!Array.isArray(mcpServers)) return cloned

  let removedServerPackage = 0
  for (const m of mcpServers) {
    if (!m || typeof m !== 'object') continue
    const mcp = m as Record<string, unknown>
    if ('serverPackage' in mcp) {
      delete mcp.serverPackage
      removedServerPackage++
    }
  }

  if (removedServerPackage > 0) {
    log.info(
      `[AgentLoader] ${agentDirName}: sanitized ${removedServerPackage} dead serverPackage field(s) at load`,
    )
  }

  return cloned
}
