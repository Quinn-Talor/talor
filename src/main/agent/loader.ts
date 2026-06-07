// src/main/agent/loader.ts — 业务层：Agent 加载器
//
// 启动时扫描 ~/.talor/agents/ 目录，校验每个 agent.json，构建内存索引。
//
// 允许依赖：agent/*、shared/*
// 禁止依赖：ipc/*

import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'
import { validateProfile } from './validator'
import { loadAgentBundle } from './profile-fs'
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
        const { raw, agentPrompt } = loadAgentBundle(dirPath)
        const result = validateProfile(raw, {
          agentRoot: dirPath,
          injectedAgentPrompt: agentPrompt,
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

        this.entries.set(result.profile.id, {
          profile: result.profile,
          dirPath,
          status: 'disabled',
        })
        log.info('[AgentLoader] Loaded agent:', result.profile.id, result.profile.name)
      } catch (err) {
        log.warn('[AgentLoader] Failed to load agent at', name, ':', err)
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
