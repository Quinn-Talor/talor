// src/main/agent-pack/exporter.ts — 业务层：Agent Pack 导出
//
// 流程：
//   1. BFS 收集 primary + 递归依赖（含循环检测、深度上限）
//   2. 复制 agent 目录到 tmp（含 skills/ knowledge/）
//   3. 提取 external_dependencies (mcp_servers / cli)
//   4. 生成 manifest.json + checksums
//   5. zip 打包到目标路径
//
// 允许依赖：agent/* / fs / path / archiver / shared/*
// 禁止依赖：ipc/*

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, createWriteStream } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import archiver from 'archiver'
import log from 'electron-log'

import type { AgentManager } from '../agent/agent-manager'
import type { AgentPackManifest, PackAgentEntry, ExternalDep } from './manifest'
import { PACK_FORMAT_VERSION, MAX_DEPENDENCY_DEPTH, computeChecksums } from './manifest'
import { copyDirRecursive } from './fs-helpers'

export class PackExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackExportError'
  }
}

interface CollectedAgent {
  id: string
  version: string
  dirPath: string
  kind: 'primary' | 'dependency'
  dependedOnBy: Set<string>
}

/**
 * 导出 agent 为 .talor-pack zip。
 *
 * @param primaryAgentId 主 agent 的 id
 * @param agentManager 用于查找 agent + dependencies
 * @param outputDir 目标目录（不存在则创建）
 * @returns 生成的 pack 文件路径
 */
export async function exportAgentPack(
  primaryAgentId: string,
  agentManager: AgentManager,
  outputDir: string,
): Promise<{ pack_path: string }> {
  const primary = agentManager.getAgent(primaryAgentId)
  if (!primary) {
    throw new PackExportError(`Primary agent not found: ${primaryAgentId}`)
  }
  if (!primary.source) {
    throw new PackExportError(
      `Primary agent "${primaryAgentId}" has no source dirPath; cannot pack platform agents`,
    )
  }

  // BFS collect dependencies
  const collected = bfsCollectDependencies(primaryAgentId, agentManager)

  // Aggregate external dependencies (MCP servers + CLI) declared by all agents in pack
  const externalDeps = collectExternalDeps(collected, agentManager)

  // Stage agents to tmp dir
  const tmpRoot = mkdtempSync(join(tmpdir(), 'talor-pack-export-'))
  try {
    const agentsRoot = join(tmpRoot, 'agents')
    mkdirSync(agentsRoot, { recursive: true })

    for (const a of collected) {
      const destDir = join(agentsRoot, a.id)
      mkdirSync(destDir, { recursive: true })
      copyDirRecursive(a.dirPath, destDir)
    }

    // Build manifest entries
    const manifestAgents: PackAgentEntry[] = collected.map((a) => ({
      id: a.id,
      version: a.version,
      kind: a.kind,
      depended_on_by: a.kind === 'dependency' ? Array.from(a.dependedOnBy) : undefined,
    }))

    const checksums = computeChecksums(tmpRoot)

    const manifest: AgentPackManifest = {
      format_version: PACK_FORMAT_VERSION,
      pack_id: `${primaryAgentId}.pack`,
      pack_name: `${primary.name} (${primary.profile.version})`,
      created_at: new Date().toISOString(),
      created_by: 'talor:0.1.0',
      primary_agent: primaryAgentId,
      agents: manifestAgents,
      external_dependencies: externalDeps,
      checksums,
    }
    writeFileSync(join(tmpRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

    // 重新计算 checksums 含 manifest.json 自身（manifest 内部 checksums 可不含自身，按惯例排除）
    // 这里保持 manifest.checksums 仅记 agents/ 文件 hash —— manifest 本身校验由 importer 解析时验证 schema

    // Zip
    mkdirSync(outputDir, { recursive: true })
    const safeName = primaryAgentId.replace(/[^a-zA-Z0-9_.-]+/g, '_')
    const packPath = join(outputDir, `${safeName}-${primary.profile.version}.talor-pack`)

    await zipDir(tmpRoot, packPath)

    log.info(
      `[AgentPack] exported: primary=${primaryAgentId}, deps=[${collected
        .filter((c) => c.kind === 'dependency')
        .map((c) => c.id)
        .join(',')}], path=${packPath}`,
    )
    return { pack_path: packPath }
  } finally {
    try {
      rmSync(tmpRoot, { recursive: true, force: true })
    } catch (cleanupErr) {
      log.warn('[AgentPack] cleanup tmp failed:', cleanupErr)
    }
  }
}

function bfsCollectDependencies(primaryId: string, manager: AgentManager): CollectedAgent[] {
  const visited = new Map<string, CollectedAgent>()
  const queue: Array<{ id: string; depth: number; from: string | null }> = [
    { id: primaryId, depth: 0, from: null },
  ]

  while (queue.length > 0) {
    const { id, depth, from } = queue.shift()!
    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw new PackExportError(
        `Dependency depth exceeds ${MAX_DEPENDENCY_DEPTH}: chain ends at "${id}"`,
      )
    }
    const agent = manager.getAgent(id)
    if (!agent) {
      throw new PackExportError(
        `Unresolved dependency: "${id}" (registered at primary's deps but not found)`,
      )
    }
    if (!agent.source) {
      throw new PackExportError(`Cannot pack platform agent: "${id}" has no source dirPath`)
    }
    let entry = visited.get(id)
    if (!entry) {
      entry = {
        id,
        version: agent.profile.version,
        dirPath: agent.source,
        kind: id === primaryId ? 'primary' : 'dependency',
        dependedOnBy: new Set(),
      }
      visited.set(id, entry)
      // 探索其 subagent 依赖
      const subDeps = agent.profile.dependencies.subagents ?? []
      for (const sub of subDeps) {
        queue.push({ id: sub.id, depth: depth + 1, from: id })
      }
    }
    if (from && from !== id) entry.dependedOnBy.add(from)
  }

  return Array.from(visited.values())
}

function collectExternalDeps(agents: CollectedAgent[], manager: AgentManager): ExternalDep[] {
  const seen = new Map<string, ExternalDep>()
  for (const a of agents) {
    const profile = manager.getAgent(a.id)?.profile
    if (!profile) continue
    for (const mcp of profile.dependencies.mcpServers) {
      const key = `mcp:${mcp.name}`
      if (seen.has(key)) continue
      seen.set(key, {
        kind: 'mcp_server',
        id: mcp.name,
        required: mcp.required,
        hint: mcp.transport.type === 'stdio' ? `command: ${mcp.transport.command}` : undefined,
      })
    }
    for (const cli of profile.dependencies.cli) {
      const key = `cli:${cli.command}`
      if (seen.has(key)) continue
      seen.set(key, {
        kind: 'cli',
        id: cli.command,
        required: cli.required,
        hint: cli.version ? `version: ${cli.version}` : undefined,
      })
    }
  }
  return Array.from(seen.values())
}

function zipDir(srcDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)

    archive.pipe(output)
    archive.directory(srcDir, false)
    archive.finalize()
  })
}
