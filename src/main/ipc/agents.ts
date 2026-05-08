// src/main/ipc/agents.ts — 入口层：Agent 系统 IPC handlers
//
// 注册 agents:* IPC handlers，转发到 AgentManager / AgentLoader。
//
// 允许依赖：agent/*、repos/*、chat/stream-registry
// 禁止依赖：业务决策

import { ipcMain, dialog } from 'electron'
import { join } from 'path'
import { rmSync, readFileSync, writeFileSync } from 'fs'
import log from 'electron-log'
import { AgentManager } from '../agent/agent-manager'
import { SkillRegistry } from '../skills/registry'
import { checkDependencies } from '../agent/dependency-checker'
import { exportAgent } from '../agent/exporter'
import { importAgent } from '../agent/importer'
import { validateProfile } from '../agent/validator'
import { sessionRepo } from '../repos/session-repo'
import { streamRegistry } from '../chat/stream-registry'
import { getDefaultProvider } from '../chat/provider-selector'
import { getMainWindow } from './window'
import { exportAgentPack } from '../agent-pack/exporter'
import {
  previewPack as previewAgentPack,
  commitPack as commitAgentPack,
} from '../agent-pack/importer'
import type { ImportConflict } from '../agent-pack/manifest'

export function registerAgentHandlers(agentManager: AgentManager): void {
  ipcMain.handle('agents:list', () => {
    // 仅业务 agent 出现在用户列表里。__chat__ 是默认主对话（不需 picker）；
    // __crystallizer__ 是沉淀引导（专用按钮触发，不进列表）。
    const loader = agentManager.getLoader()
    if (!loader) return []
    return loader.getAll().map((entry) => ({
      id: entry.profile.id,
      name: entry.profile.name,
      description: entry.profile.description,
      avatar: entry.profile.avatar,
      version: entry.profile.version,
      status: entry.status,
      lastUsedAt: entry.lastUsedAt,
      dirPath: entry.dirPath,
    }))
  })

  ipcMain.handle('agents:get', (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) return null
    const entry = loader.getById(id)
    if (!entry) return null
    return {
      id: entry.profile.id,
      name: entry.profile.name,
      description: entry.profile.description,
      avatar: entry.profile.avatar,
      version: entry.profile.version,
      status: entry.status,
      lastUsedAt: entry.lastUsedAt,
      dirPath: entry.dirPath,
      profile: entry.profile,
    }
  })

  ipcMain.handle('agents:create-session', (_event, raw: { agent_id: string }) => {
    const agentId = raw.agent_id
    const agent = agentManager.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)

    const provider = getDefaultProvider()
    const session = sessionRepo.create({
      title: agent.name,
      provider_id: provider.id,
      agent_id: agentId,
    })

    log.info('[agents:create-session] Created session:', session.id, 'for agent:', agentId)
    return { session_id: session.id }
  })

  ipcMain.handle('agents:enable', (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)

    const skillRegistry = entry.dirPath
      ? SkillRegistry.fromDir(join(entry.dirPath, 'skills'))
      : SkillRegistry.fromDir(null)

    agentManager.registerBusinessAgent(id, {
      profile: entry.profile,
      source: entry.dirPath,
      mcpRegistry: null,
      skillRegistry,
    })

    loader.setStatus(id, 'ready')
    log.info('[agents:enable] Enabled agent:', id)
    return { passed: true, steps: [] }
  })

  ipcMain.handle('agents:delete', (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)

    agentManager.unregisterBusinessAgent(id)
    rmSync(entry.dirPath, { recursive: true, force: true })
    loader.remove(id)

    log.info('[agents:delete] Deleted agent:', id, 'at', entry.dirPath)
  })

  ipcMain.handle('agents:reload', () => {
    const loader = agentManager.getLoader()
    if (!loader) return []
    loader.loadAll()
    return loader.getAll().map((e) => ({
      id: e.profile.id,
      name: e.profile.name,
      status: e.status,
    }))
  })

  ipcMain.handle('agents:check-deps', (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)
    return checkDependencies(entry.profile, entry.dirPath)
  })

  ipcMain.handle('agents:export', async (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)

    const win = getMainWindow()
    if (!win) throw new Error('No main window')

    const zipBuffer = exportAgent(entry.dirPath)
    const fileName = `${entry.profile.name}-${entry.profile.version}.agent.zip`
    const result = await dialog.showSaveDialog(win, {
      defaultPath: fileName,
      filters: [{ name: 'Agent Package', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    writeFileSync(result.filePath, zipBuffer)
    log.info('[agents:export] Exported to:', result.filePath)
    return { filePath: result.filePath }
  })

  ipcMain.handle('agents:import', async () => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')

    const win = getMainWindow()
    if (!win) throw new Error('No main window')

    const result = await dialog.showOpenDialog(win, {
      title: '导入 Agent',
      filters: [{ name: 'Agent Package', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }

    const zipBuffer = readFileSync(result.filePaths[0])
    const importResult = importAgent(zipBuffer, loader.agentsDir)
    loader.loadAll()
    log.info(
      '[agents:import] Imported:',
      importResult.profile.id,
      'overwritten:',
      importResult.overwritten,
    )
    return { agentId: importResult.profile.id, overwritten: importResult.overwritten }
  })

  ipcMain.handle('agents:install-deps', (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)
    // Skill 安装 + 依赖检查的完整流程
    return checkDependencies(entry.profile, entry.dirPath)
  })

  ipcMain.handle('agents:update', (_event, raw: { id: string; profile: unknown }) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(raw.id)
    if (!entry) throw new Error(`Agent not found: ${raw.id}`)

    const result = validateProfile(raw.profile)
    if (!result.valid) throw new Error(`Invalid profile: ${result.errors.join(', ')}`)

    writeFileSync(
      join(entry.dirPath, 'agent.json'),
      JSON.stringify(result.profile, null, 2),
      'utf-8',
    )
    loader.loadAll()
    log.info('[agents:update] Updated agent:', raw.id)
  })

  ipcMain.handle('agents:crystallize', (_event, raw: { session_id: string }) => {
    // v2: warn + ingest（不再 refuse 含委托的 session）。
    // 把委托过的 subagent_id 写入 session.metadata，crystallizer profile 据此
    // 引导 LLM 把它们列入新 agent 的 dependencies.subagents。
    const session = sessionRepo.getById(raw.session_id)
    if (!session) throw new Error(`Session not found: ${raw.session_id}`)

    const delegated = sessionRepo.listDelegatedAgents(raw.session_id)
    if (delegated.length > 0) {
      const existing = sessionRepo.getMetadata(raw.session_id)
      sessionRepo.setMetadata(raw.session_id, {
        ...existing,
        delegated_subagents: delegated,
      })
      log.info(
        `[Crystallizer] ingested delegated_subagents=[${delegated.join(',')}] for session=${raw.session_id}`,
      )
    }

    const updated = sessionRepo.updateAgentId(raw.session_id, '__crystallizer__')
    if (!updated) throw new Error(`Session not found: ${raw.session_id}`)
    log.info('[agents:crystallize] Session switched to crystallizer:', raw.session_id)

    return { success: true, delegated_subagents: delegated }
  })

  ipcMain.handle('agents:list-tools', (_event, agentId: string) => {
    const agent = agentManager.getAgent(agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    return agent.toolRegistry.listTools()
  })

  ipcMain.handle(
    'session:switch-agent',
    (_event, raw: { session_id: string; agent_id: string }) => {
      const { session_id, agent_id } = raw

      const agent = agentManager.getAgent(agent_id)
      if (!agent) throw new Error(`Agent not found: ${agent_id}`)

      streamRegistry.abort(session_id)

      const updated = sessionRepo.updateAgentId(session_id, agent_id)
      if (!updated) throw new Error(`Session not found: ${session_id}`)

      log.info('[session:switch-agent] Switched session:', session_id, 'to agent:', agent_id)
      return { success: true }
    },
  )

  // ─── Agent Pack：导出 / 导入（TASK-5）───────────────────────────────────

  ipcMain.handle(
    'agents:export-pack',
    async (_event, raw: { agent_id: string; output_path?: string }) => {
      const outputDir = raw.output_path ?? (await pickPackOutputDir())
      if (!outputDir) return { cancelled: true }
      try {
        const result = await exportAgentPack(raw.agent_id, agentManager, outputDir)
        return { success: true, pack_path: result.pack_path }
      } catch (err) {
        log.error('[agents:export-pack] failed:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  ipcMain.handle('agents:import-pack:preview', async (_event, raw: { pack_path: string }) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    try {
      const preview = await previewAgentPack(raw.pack_path, loader)
      return {
        success: true,
        agents: preview.agents,
        conflicts: preview.conflicts,
        external_dependencies: preview.external_dependencies,
        staging_dir: preview.staging_dir,
      }
    } catch (err) {
      log.error('[agents:import-pack:preview] failed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  ipcMain.handle(
    'agents:import-pack:commit',
    async (
      _event,
      raw: { staging_dir: string; resolutions: ImportConflict[]; agents_dir: string },
    ) => {
      const loader = agentManager.getLoader()
      if (!loader) throw new Error('AgentLoader not initialized')
      try {
        const result = await commitAgentPack(
          raw.staging_dir,
          raw.resolutions,
          raw.agents_dir,
          loader,
        )
        // 清理 staging（commit 完成后不再需要）
        try {
          rmSync(raw.staging_dir, { recursive: true, force: true })
        } catch (cleanupErr) {
          log.warn('[agents:import-pack:commit] cleanup staging failed:', cleanupErr)
        }
        return { success: true, ...result }
      } catch (err) {
        log.error('[agents:import-pack:commit] failed:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )
}

async function pickPackOutputDir(): Promise<string | null> {
  const win = getMainWindow()
  const result = await dialog.showOpenDialog(win!, {
    title: 'Choose pack output directory',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
