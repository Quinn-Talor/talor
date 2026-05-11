// src/main/agent-pack/manifest.ts — 业务层：Agent Pack 元数据类型 + 校验
//
// Pack 是自包含的 agent 制品：含 primary agent + 它递归依赖的所有 subagent。
// .talor-pack 文件 = zip，含 manifest.json + agents/ 目录 + checksums。
//
// 允许依赖：fs / path / crypto / shared/*
// 禁止依赖：ipc/*

import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { walkAllFiles } from './fs-helpers'

export const PACK_FORMAT_VERSION = 1
export const MAX_DEPENDENCY_DEPTH = 5

export interface AgentPackManifest {
  format_version: 1
  pack_id: string
  pack_name: string
  created_at: string
  created_by: string
  primary_agent: string
  agents: PackAgentEntry[]
  external_dependencies: ExternalDep[]
  checksums: Record<string, string>
}

export interface PackAgentEntry {
  id: string
  version: string
  kind: 'primary' | 'dependency'
  /** dependency 类型：被列表中的哪些 agent 依赖 */
  depended_on_by?: string[]
}

export interface ExternalDep {
  kind: 'mcp_server' | 'cli'
  id: string
  required: boolean
  hint?: string
  /**
   * 跨机器导入时,提示导入端用户需要在 Account 配置的 env var 列表(主要给 mcp_server)。
   * 来源:profile.mcpServers[].transport.auth.envVar(http transport)
   *      或 transport.env keys(stdio transport,如 GITHUB_TOKEN)
   */
  required_env_vars?: string[]
}

export interface ImportConflict {
  agent_id: string
  /** 现有 agent 版本；null = 不存在（新增） */
  existing_version: string | null
  new_version: string
  resolution: 'replace' | 'skip' | 'rename'
  /** resolution='rename' 时使用 */
  rename_to?: string
}

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackValidationError'
  }
}

/**
 * 校验从 pack 内 manifest.json 解析出的对象是否符合 schema。
 * 失败抛 PackValidationError。
 */
export function validateManifest(raw: unknown): AgentPackManifest {
  if (!raw || typeof raw !== 'object') {
    throw new PackValidationError('manifest.json is not a valid object')
  }
  const m = raw as Record<string, unknown>

  if (m.format_version !== PACK_FORMAT_VERSION) {
    throw new PackValidationError(
      `Unsupported pack format_version: ${String(m.format_version)} (this Talor only reads ${PACK_FORMAT_VERSION})`,
    )
  }

  for (const field of ['pack_id', 'pack_name', 'created_at', 'created_by', 'primary_agent']) {
    if (typeof m[field] !== 'string' || (m[field] as string).length === 0) {
      throw new PackValidationError(`manifest field "${field}" must be a non-empty string`)
    }
  }

  if (!Array.isArray(m.agents) || m.agents.length === 0) {
    throw new PackValidationError('manifest.agents must be a non-empty array')
  }

  for (const entry of m.agents) {
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.version !== 'string') {
      throw new PackValidationError('each manifest.agents entry must have string id + version')
    }
    if (e.kind !== 'primary' && e.kind !== 'dependency') {
      throw new PackValidationError(
        `manifest.agents[].kind must be 'primary' or 'dependency', got: ${String(e.kind)}`,
      )
    }
  }

  const primaryEntry = m.agents.find((e: unknown) => (e as { id?: string }).id === m.primary_agent)
  if (!primaryEntry) {
    throw new PackValidationError(
      `primary_agent="${String(m.primary_agent)}" not found in agents list`,
    )
  }

  if (!Array.isArray(m.external_dependencies)) {
    throw new PackValidationError('manifest.external_dependencies must be an array')
  }
  if (!m.checksums || typeof m.checksums !== 'object') {
    throw new PackValidationError('manifest.checksums must be an object')
  }

  return raw as AgentPackManifest
}

/** 计算 sha256（hex）。 */
export function sha256OfFile(filePath: string): string {
  const buf = readFileSync(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * 递归收集 rootDir 下所有文件，相对路径 → sha256。
 * 跳过空目录、符号链接（链接目标不在 rootDir 内时不可控）。
 */
export function computeChecksums(rootDir: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const filePath of walkAllFiles(rootDir)) {
    const rel = relative(rootDir, filePath).split('\\').join('/')
    result[rel] = sha256OfFile(filePath)
  }
  return result
}

/**
 * 校验解压后的 rootDir 文件 checksums 是否与 manifest 一致。
 * 失败抛 PackValidationError。
 */
export function verifyChecksums(rootDir: string, expected: Record<string, string>): void {
  for (const [rel, expectedHash] of Object.entries(expected)) {
    const filePath = join(rootDir, rel)
    try {
      statSync(filePath)
    } catch {
      throw new PackValidationError(`Checksum file not found: ${rel}`)
    }
    const actual = sha256OfFile(filePath)
    if (actual !== expectedHash) {
      throw new PackValidationError(`Checksum mismatch for ${rel}`)
    }
  }
}
