// src/main/ipc/agents.ts — 入口层：Agent 系统 IPC handlers
//
// 注册 agents:* IPC handlers，转发到 AgentManager / AgentLoader。
//
// 允许依赖：agent/*、repos/*、chat/stream-registry
// 禁止依赖：业务决策

import { ipcMain, dialog } from 'electron'
import { join, sep as pathSep, resolve as pathResolve } from 'path'
import { rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import log from 'electron-log'
import { AgentManager } from '../agent/agent-manager'
import { SkillRegistry } from '../skills/registry'
import { checkDependencies } from '../agent/dependency-checker'
import { exportAgent } from '../agent/exporter'
import { importAgent } from '../agent/importer'
import { validateProfile } from '../agent/validator'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { streamRegistry } from '../chat/stream-registry'
import { getDefaultProvider } from '../chat/provider-selector'
import { getMainWindow } from './window'
import { exportAgentPack } from '../agent-pack/exporter'
import {
  previewPack as previewAgentPack,
  commitPack as commitAgentPack,
} from '../agent-pack/importer'
import type { ImportConflict } from '../agent-pack/manifest'
import type { AgentProfile } from '@shared/types/agent'
import { serializeS1History } from '../agent/draft-extractor'
import { v4 as uuidv4 } from 'uuid'

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

  // ─── Agent Extraction (Workbench)：5 个 IPC handlers ────────────────
  // 替代 v2 的 agents:crystallize（不再切原 session 的 agent_id；改为新建独立工作台 session）

  ipcMain.handle('agents:start-crystallize', (_event, raw: { session_id: string }) => {
    try {
      const source = sessionRepo.getById(raw.session_id)
      if (!source) {
        return { success: false, error: `Session not found: ${raw.session_id}` }
      }

      const messages = messageRepo.listBySession(raw.session_id)
      const currentMsgCount = messages.length
      const snapshot = serializeS1History(messages)
      const delegated = sessionRepo.listDelegatedAgents(raw.session_id)

      // 设计：打开工作台后**不**自动触发 LLM 总结。
      // 原因：用户反馈"直接提取不可控" —— 应让用户先描述意图（要做什么 agent /
      // 风格 / 输出偏好），crystallizer 再综合 S1 历史 + 用户描述给草稿。
      //
      // 启动时 backend 直接预置两条消息：
      //   1. user(snapshot)：S1 历史 + delegated_subagents 信息（前端会折叠显示）
      //   2. assistant(welcome)：欢迎 + 引导用户描述意图
      // 都不走 chat.send，所以不触发 ReactLoop。等用户输入描述后才触发。
      const buildSnapshotMessage = (variant: 'fresh' | 'updated', prevCount: number): string => {
        const header =
          variant === 'fresh'
            ? `Original conversation context for this Agent extraction:`
            : `Updated original conversation history (now ${currentMsgCount} messages, was ${prevCount}):`
        return (
          header +
          `\n\n===== Original Conversation (${currentMsgCount} messages) =====\n` +
          snapshot +
          (delegated.length > 0
            ? `\n\n===== Subagents Delegated To =====\n${delegated.join(', ')}\n` +
              `(If extracting an agent from this context, include these in dependencies.subagents.)`
            : '')
        )
      }
      const WELCOME_FRESH =
        `你好！我已读取你跟 Talor 的对话历史。\n\n` +
        `请告诉我你想从中提取一个**什么样的 agent**，可以涵盖以下任意维度：\n` +
        `- 角色定位（例如：情感挽回助手 / 代码审查师 / 旅行行程规划师）\n` +
        `- 关键能力（这个 agent 主要要做哪些事）\n` +
        `- 输出风格（Markdown / 纯文本 / 结构化 JSON 等）\n` +
        `- 依赖工具或外部服务\n\n` +
        `给一句话或几句话描述都可以，我会结合上面的对话历史综合给出 agent 草稿（fenced \`\`\`json\`\`\` block）。`
      const WELCOME_UPDATED = `S1 对话有更新（最新历史已注入到上面）。如果想基于新内容调整草稿，告诉我要改什么；也可以不动，继续基于之前的方向迭代。`

      const existing = sessionRepo.findWorkbenchForSource(raw.session_id)
      if (existing) {
        const meta = sessionRepo.getMetadata(existing.id)
        const lastCount = (meta.last_snapshot_message_count as number | undefined) ?? 0
        if (lastCount !== currentMsgCount) {
          // S1 有新消息 → 注入"更新版历史"+"提示用户"两条
          messageRepo.create({
            id: uuidv4(),
            session_id: existing.id,
            role: 'user',
            content: [{ type: 'text', text: buildSnapshotMessage('updated', lastCount) }],
            agent_id: '__crystallizer__',
          })
          messageRepo.create({
            id: uuidv4(),
            session_id: existing.id,
            role: 'assistant',
            content: [{ type: 'text', text: WELCOME_UPDATED }],
            agent_id: '__crystallizer__',
          })
          sessionRepo.setMetadata(existing.id, {
            ...meta,
            last_snapshot_message_count: currentMsgCount,
            delegated_subagents: delegated,
          })
        }
        log.info(
          `[Crystallize] start session=${source.id} → workbench=${existing.id} reuse=true snapshot_msgs=${currentMsgCount} updated=${lastCount !== currentMsgCount}`,
        )
        return {
          success: true,
          workbench_session_id: existing.id,
          reused: true,
        }
      }

      // 新建 workbench session + 预置 user(snapshot) + assistant(welcome)
      const workbench = sessionRepo.create({
        title: `Workbench: ${source.title}`,
        provider_id: source.provider_id,
        model_id: source.model_id,
        agent_id: '__crystallizer__',
        // 不传 parent_session_id → null（顶层 session）
      })
      sessionRepo.setMetadata(workbench.id, {
        source_session_id: raw.session_id,
        last_snapshot_message_count: currentMsgCount,
        delegated_subagents: delegated,
        created_agents: [],
      })
      messageRepo.create({
        id: uuidv4(),
        session_id: workbench.id,
        role: 'user',
        content: [{ type: 'text', text: buildSnapshotMessage('fresh', 0) }],
        agent_id: '__crystallizer__',
      })
      messageRepo.create({
        id: uuidv4(),
        session_id: workbench.id,
        role: 'assistant',
        content: [{ type: 'text', text: WELCOME_FRESH }],
        agent_id: '__crystallizer__',
      })
      log.info(
        `[Crystallize] start session=${source.id} → workbench=${workbench.id} reuse=false snapshot_msgs=${currentMsgCount}`,
      )
      return {
        success: true,
        workbench_session_id: workbench.id,
        reused: false,
      }
    } catch (err) {
      log.error('[agents:start-crystallize] failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('agents:finish-crystallize', (_event, raw: { workbench_session_id: string }) => {
    log.info(`[Crystallize] finish workbench=${raw.workbench_session_id}`)
    return { success: true }
  })

  ipcMain.handle(
    'agents:create-from-draft',
    (_event, raw: { profile: AgentProfile; workbench_session_id: string }) => {
      try {
        const profile = raw.profile

        // 1. validateProfile
        const result = validateProfile(profile)
        if (!result.valid) {
          return { success: false, error: result.errors.join('; ') }
        }

        // 2. id 格式 + 平台保留前缀检查
        if (profile.id.startsWith('__') && profile.id.endsWith('__')) {
          return {
            success: false,
            error: `Reserved id pattern: __X__ is for platform agents. Pick a different id.`,
          }
        }
        if (!/^[a-z][a-z0-9_-]*$/.test(profile.id)) {
          return {
            success: false,
            error: `Invalid id format. Use snake-case (lowercase letters, digits, _ or -).`,
          }
        }

        // 3. id 冲突检查
        const loader = agentManager.getLoader()
        if (!loader) {
          return { success: false, error: 'AgentLoader not initialized' }
        }
        if (loader.getById(profile.id)) {
          return {
            success: false,
            error: `Agent id "${profile.id}" already exists. Pick a different id.`,
          }
        }

        // 4. 写文件（path-guard：防 id 含 ../）
        const agentsDir = loader.agentsDir
        const targetDir = join(agentsDir, profile.id)
        const targetAbs = pathResolve(targetDir)
        const agentsDirAbs = pathResolve(agentsDir)
        if (!targetAbs.startsWith(agentsDirAbs + pathSep)) {
          return { success: false, error: `path escape detected: ${profile.id}` }
        }
        if (existsSync(targetDir)) {
          return {
            success: false,
            error: `Directory already exists: ${targetDir}. Pick a different id.`,
          }
        }
        mkdirSync(targetDir, { recursive: true })
        writeFileSync(join(targetDir, 'agent.json'), JSON.stringify(profile, null, 2), 'utf-8')

        // 5. AgentLoader 重载
        loader.loadAll()
        const newEntry = loader.getById(profile.id)
        if (newEntry) {
          // 自动注册（用户审阅+保存=确认，减少摩擦）
          const skillsDirPath = join(newEntry.dirPath, 'skills')
          const skillRegistry = existsSync(skillsDirPath)
            ? SkillRegistry.fromDir(skillsDirPath)
            : SkillRegistry.fromDir(null)
          agentManager.registerBusinessAgent(profile.id, {
            profile: newEntry.profile,
            source: newEntry.dirPath,
            mcpRegistry: null,
            skillRegistry,
          })
          loader.setStatus(profile.id, 'ready')
        }

        // 6. 维护 workbench.metadata.created_agents
        const wsMeta = sessionRepo.getMetadata(raw.workbench_session_id)
        const sourceSessionId = wsMeta.source_session_id as string | undefined
        const sourceMsgCount = sourceSessionId
          ? messageRepo.listBySession(sourceSessionId).length
          : 0
        const created = (wsMeta.created_agents as Array<Record<string, unknown>> | undefined) ?? []
        created.push({
          id: profile.id,
          version: profile.version,
          created_at: new Date().toISOString(),
          based_on_message_count: sourceMsgCount,
        })
        sessionRepo.setMetadata(raw.workbench_session_id, {
          ...wsMeta,
          created_agents: created,
        })

        const createdAt =
          (created[created.length - 1]?.created_at as string) ?? new Date().toISOString()
        log.info(
          `[Crystallize] saved agent=${profile.id} v=${profile.version} from workbench=${raw.workbench_session_id}`,
        )
        return { success: true, id: profile.id, created_at: createdAt }
      } catch (err) {
        log.error('[agents:create-from-draft] failed:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  ipcMain.handle('agents:list-from-workbench', (_event, raw: { workbench_session_id: string }) => {
    const meta = sessionRepo.getMetadata(raw.workbench_session_id)
    const created =
      (meta.created_agents as
        | Array<{
            id: string
            version: string
            created_at: string
            based_on_message_count: number
          }>
        | undefined) ?? []
    const loader = agentManager.getLoader()
    return created.map((c) => {
      const entry = loader?.getById(c.id) ?? null
      return {
        id: c.id,
        name: entry?.profile.name ?? c.id,
        version: c.version,
        created_at: c.created_at,
        based_on_message_count: c.based_on_message_count,
        exists: entry !== null,
        current_version: entry?.profile.version,
      }
    })
  })

  ipcMain.handle(
    'agents:remove-from-workbench',
    (_event, raw: { workbench_session_id: string; agent_id: string }) => {
      const meta = sessionRepo.getMetadata(raw.workbench_session_id)
      const created =
        (meta.created_agents as Array<{ id: string; [k: string]: unknown }> | undefined) ?? []
      const remaining = created.filter((c) => c.id !== raw.agent_id)
      sessionRepo.setMetadata(raw.workbench_session_id, {
        ...meta,
        created_agents: remaining,
      })
      log.info(
        `[Crystallize] removed agent=${raw.agent_id} from workbench=${raw.workbench_session_id}`,
      )
      return { success: true }
    },
  )

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
