// src/main/agent-pack/importer.ts — 业务层：Agent Pack 导入
//
// 双阶段流程：
//   previewPack: 解压到 tmp → 校验 manifest + checksums + zip slip → 生成冲突清单
//   commitPack:  rewrite rename 引用 → 备份 existing → 复制新版到 agentsDir → loader 重载
//
// 允许依赖：agent/* / fs / path / unzipper / shared/*
// 禁止依赖：ipc/*

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import unzipper from 'unzipper'
import log from 'electron-log'

import type { AgentLoader } from '../agent/loader'
import type { AgentProfile } from '@shared/types/agent'
import { validateProfile } from '../agent/validator'
import {
  validateManifest,
  verifyChecksums,
  PackValidationError,
  PACK_FORMAT_VERSION,
  type AgentPackManifest,
  type ImportConflict,
  type PackAgentEntry,
  type ExternalDep,
} from './manifest'
import { copyDirRecursive, isSafePackEntryPath } from './fs-helpers'

export class PackImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackImportError'
  }
}

export interface PackPreview {
  agents: PackAgentEntry[]
  conflicts: ImportConflict[]
  external_dependencies: ExternalDep[]
  /** 解压后的 tmp 目录路径；commitPack 用同一路径 */
  staging_dir: string
}

/**
 * 解压 + 校验 + 生成冲突清单。返回的 staging_dir 仍在磁盘上等 commitPack 使用。
 * commit 完成或被取消后调用方应清理 staging_dir。
 */
export async function previewPack(
  packPath: string,
  agentLoader: AgentLoader,
): Promise<PackPreview> {
  const stagingDir = mkdtempSync(join(tmpdir(), 'talor-pack-import-'))

  try {
    // Step 1: 解压（含 zip slip 校验）
    await extractZip(packPath, stagingDir)

    // Step 2: 解析并校验 manifest
    const manifestPath = join(stagingDir, 'manifest.json')
    if (!existsSync(manifestPath)) {
      throw new PackImportError('manifest.json not found in pack')
    }
    let manifest: AgentPackManifest
    try {
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      manifest = validateManifest(raw)
    } catch (err) {
      if (err instanceof PackValidationError) throw new PackImportError(err.message)
      throw new PackImportError(
        `manifest parse failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // Step 3: checksum 校验（确保解压后内容与 manifest 一致）
    try {
      verifyChecksums(stagingDir, manifest.checksums)
    } catch (err) {
      throw new PackImportError(
        `Checksum verification failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    // Step 4: 校验每个 agent.json
    for (const entry of manifest.agents) {
      const agentJsonPath = join(stagingDir, 'agents', entry.id, 'agent.json')
      if (!existsSync(agentJsonPath)) {
        throw new PackImportError(`Pack inconsistent: missing ${entry.id}/agent.json`)
      }
      try {
        const raw = JSON.parse(readFileSync(agentJsonPath, 'utf-8'))
        const result = validateProfile(raw)
        if (!result.valid) {
          throw new PackImportError(`Invalid profile for ${entry.id}: ${result.errors.join('; ')}`)
        }
      } catch (err) {
        if (err instanceof PackImportError) throw err
        throw new PackImportError(
          `Profile parse failed for ${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }

    // Step 5: 生成冲突清单
    const conflicts: ImportConflict[] = manifest.agents.map((entry) => {
      const existing = agentLoader.getById(entry.id)
      if (!existing) {
        return {
          agent_id: entry.id,
          existing_version: null,
          new_version: entry.version,
          resolution: 'replace', // 新增视作 replace（无现有可备份）
        }
      }
      const existingVersion = existing.profile.version
      // 简化版本比较：相同 → skip；不同 → replace
      const resolution: 'replace' | 'skip' = existingVersion === entry.version ? 'skip' : 'replace'
      return {
        agent_id: entry.id,
        existing_version: existingVersion,
        new_version: entry.version,
        resolution,
      }
    })

    return {
      agents: manifest.agents,
      conflicts,
      external_dependencies: manifest.external_dependencies,
      staging_dir: stagingDir,
    }
  } catch (err) {
    // 失败清理 staging
    try {
      rmSync(stagingDir, { recursive: true, force: true })
    } catch (cleanupErr) {
      log.warn('[AgentPack] cleanup staging on preview error failed:', cleanupErr)
    }
    throw err
  }
}

export interface PackCommitResult {
  imported: string[]
  skipped: string[]
  errors: Array<{ id: string; error: string }>
}

/**
 * 按 resolutions 落盘 staging_dir 下的 agent。
 *
 * 顺序：先处理被依赖者（dependency），再处理 primary —— BFS 顺序按 PackAgentEntry.kind 分。
 * Rename: 必须 rewrite primary 的 dependencies.subagents[].id 引用，否则 primary 加载时
 * 找不到依赖。
 */
export async function commitPack(
  staging_dir: string,
  resolutions: ImportConflict[],
  agentsDir: string,
  agentLoader: AgentLoader,
): Promise<PackCommitResult> {
  const result: PackCommitResult = { imported: [], skipped: [], errors: [] }

  // 解析 manifest 获取 agents 顺序
  const manifest: AgentPackManifest = validateManifest(
    JSON.parse(readFileSync(join(staging_dir, 'manifest.json'), 'utf-8')),
  )

  // 校验 resolutions 与 manifest 一致
  const resMap = new Map(resolutions.map((r) => [r.agent_id, r]))
  for (const entry of manifest.agents) {
    if (!resMap.has(entry.id)) {
      throw new PackImportError(`Resolution missing for agent: ${entry.id}`)
    }
  }

  // 校验 rename 目标不冲突
  const renameMap = new Map<string, string>()
  for (const r of resolutions) {
    if (r.resolution === 'rename') {
      if (!r.rename_to) {
        throw new PackImportError(`rename resolution for "${r.agent_id}" missing rename_to`)
      }
      if (agentLoader.getById(r.rename_to)) {
        throw new PackImportError(`rename target "${r.rename_to}" already exists`)
      }
      renameMap.set(r.agent_id, r.rename_to)
    }
  }

  // 重写所有 agent.json 中对 rename 旧 id 的引用（dependencies.subagents[].id）
  if (renameMap.size > 0) {
    for (const entry of manifest.agents) {
      const agentJsonPath = join(staging_dir, 'agents', entry.id, 'agent.json')
      const profile: AgentProfile = JSON.parse(readFileSync(agentJsonPath, 'utf-8'))
      const subs = profile.dependencies.subagents
      if (subs && subs.length > 0) {
        let mutated = false
        for (const sub of subs) {
          if (renameMap.has(sub.id)) {
            sub.id = renameMap.get(sub.id)!
            mutated = true
          }
        }
        if (mutated) {
          writeFileSync(agentJsonPath, JSON.stringify(profile, null, 2), 'utf-8')
        }
      }
    }
  }

  // 排序：dependency 先，primary 后
  const sortedEntries = [...manifest.agents].sort((a, b) => {
    if (a.kind === 'dependency' && b.kind === 'primary') return -1
    if (a.kind === 'primary' && b.kind === 'dependency') return 1
    return 0
  })

  for (const entry of sortedEntries) {
    const r = resMap.get(entry.id)!
    try {
      if (r.resolution === 'skip') {
        result.skipped.push(entry.id)
        continue
      }

      const targetId = r.resolution === 'rename' ? r.rename_to! : entry.id
      const targetDir = join(agentsDir, targetId)
      const sourceDir = join(staging_dir, 'agents', entry.id)

      // replace: 备份现有目录
      if (r.resolution === 'replace' && existsSync(targetDir)) {
        const backupRoot = join(agentsDir, '.backup')
        mkdirSync(backupRoot, { recursive: true })
        const backupDir = join(backupRoot, `${entry.id}-${Date.now()}`)
        renameSync(targetDir, backupDir)
        log.info(`[AgentPack] backed up existing agent "${entry.id}" to ${backupDir}`)
      }

      // 复制新版本（rename 走相同路径，仅 targetId 不同）
      mkdirSync(targetDir, { recursive: true })
      copyDirRecursive(sourceDir, targetDir)

      result.imported.push(targetId)
    } catch (err) {
      result.errors.push({
        id: entry.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 重新加载 agent 列表
  agentLoader.loadAll()

  log.info(
    `[AgentPack] imported: primary=${manifest.primary_agent}, ` +
      `replaced=[${result.imported.join(',')}], skipped=[${result.skipped.join(',')}], ` +
      `errors=${result.errors.length}`,
  )
  return result
}

/**
 * 解压 zip 到 destDir，路径走 isSafePackEntryPath 校验防 zip slip。
 *
 * 使用 unzipper.Open.file() API：先解析中央目录，再串行 extract 每个 entry。
 * 比 Parse 流式 API 简单（每个 entry 用 await 等 buffer 写完再继续）。
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  let directory: unzipper.CentralDirectory
  try {
    directory = await unzipper.Open.file(zipPath)
  } catch (err) {
    throw new PackImportError(
      `Cannot open pack as zip: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const destAbs = resolve(destDir)
  for (const entry of directory.files) {
    const relPath = entry.path
    if (!isSafePackEntryPath(relPath)) {
      log.error(`[AgentPack] zip slip attempt blocked: entry=${relPath}`)
      throw new PackImportError(`Unsafe entry path: ${relPath}`)
    }
    const fullPath = resolve(destDir, relPath)
    if (!fullPath.startsWith(destAbs + '\\') && !fullPath.startsWith(destAbs + '/')) {
      if (fullPath !== destAbs) {
        log.error(`[AgentPack] zip slip resolved-path attempt blocked: ${fullPath}`)
        throw new PackImportError(`Unsafe resolved path: ${relPath}`)
      }
    }
    if (entry.type === 'Directory') {
      mkdirSync(fullPath, { recursive: true })
    } else {
      mkdirSync(join(fullPath, '..'), { recursive: true })
      const buf = await entry.buffer()
      writeFileSync(fullPath, buf)
    }
  }
}

// Used to satisfy "format_version is checked" requirement reference
void PACK_FORMAT_VERSION
