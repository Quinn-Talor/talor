// src/main/ipc/agents.ts — 入口层：Agent 系统 IPC handlers
//
// 注册 agents:* IPC handlers，转发到 AgentManager / AgentLoader。
//
// 允许依赖：agent/*、repos/*、chat/stream-registry
// 禁止依赖：业务决策

import { ipcMain } from 'electron'
import { join, sep as pathSep, resolve as pathResolve } from 'path'
import { rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import log from 'electron-log'
import { AgentManager } from '../agent/agent-manager'
import { SkillRegistry } from '../skills/registry'
import { checkDependencies } from '../agent/dependency-checker'
import { validateProfile } from '../agent/validator'
import { previewAgent } from '../agent/preview'
import { getRegisteredModelSet } from '../providers/registry'
import { sessionRepo, messageRepo } from '../repos/session-repo'
import { streamRegistry } from '../chat/stream-registry'
import { getDefaultProvider } from '../chat/provider-selector'
import type { AgentProfile } from '@shared/types/agent'
import { serializeS1History } from '../agent/draft-extractor'
import { recommendMode } from '../agent/crystallizer-heuristics'
import { v4 as uuidv4 } from 'uuid'

/**
 * 粗略统计 session 中失败的工具调用数量（用于 Crystallizer mode 启发式）。
 * 命中信号：tool-result 内 __talor_error 标志、output 含 "error"/"failed"。
 * 误差容忍 — 仅作为 guided 模式触发的近似指标。
 */
function countFailedToolCalls(messages: Array<{ content?: unknown }>): number {
  let count = 0
  for (const msg of messages) {
    let content = msg.content
    if (typeof content === 'string') {
      try {
        content = JSON.parse(content) as unknown
      } catch {
        continue
      }
    }
    if (!Array.isArray(content)) continue
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type !== 'tool-result') continue
      const out = block.output
      if (
        out &&
        typeof out === 'object' &&
        (out as Record<string, unknown>).__talor_error === true
      ) {
        count++
        continue
      }
      const outStr =
        typeof out === 'string'
          ? out
          : out && typeof (out as { value?: unknown }).value === 'string'
            ? (out as { value: string }).value
            : ''
      if (/\b(error|failed|timeout|denied|missing)\b/i.test(outStr)) count++
    }
  }
  return count
}

export function registerAgentHandlers(agentManager: AgentManager): void {
  /**
   * 把 workbench.metadata.created_agents 跟 AgentLoader 的真相对账：
   * agent 文件已被外部删除（Settings → Agents 删除、手动 rm 等）的条目从 metadata 抠掉并持久化。
   *
   * 何时调用：
   *   - agents:start-crystallize 复用既有 workbench 时（用户重新进工作台 → 看到的就是干净的）
   *   - agents:list-from-workbench 每次刷新（工作台开着的时候用户去删 agent 也能立刻同步）
   *
   * 不在 agents:delete 里 cascade，避免入口层耦合 workbench 的内部数据结构；
   * 走"懒清理 + 持久化"路线，自愈对外部修改也健壮。
   */
  function reconcileCreatedAgents(workbenchSessionId: string): Array<{
    id: string
    version: string
    created_at: string
    based_on_message_count: number
  }> {
    const meta = sessionRepo.getMetadata(workbenchSessionId)
    const created =
      (meta.created_agents as
        | Array<{
            id: string
            version: string
            created_at: string
            based_on_message_count: number
          }>
        | undefined) ?? []
    if (created.length === 0) return []
    const loader = agentManager.getLoader()
    if (!loader) return created // loader 未就绪：保守返回原列表，不误删
    const alive: typeof created = []
    const removed: string[] = []
    for (const c of created) {
      if (loader.getById(c.id)) alive.push(c)
      else removed.push(c.id)
    }
    if (removed.length > 0) {
      sessionRepo.setMetadata(workbenchSessionId, { ...meta, created_agents: alive })
      log.info(
        `[Crystallize] reconciled workbench=${workbenchSessionId}: removed ${removed.length} stale agents (${removed.join(', ')})`,
      )
    }
    return alive
  }

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

    // 选 provider + model:
    //   - profile.preferences.providerId/modelId 优先(若匹配 + provider 启用)
    //   - 否则 default provider + 其第一个 model
    //   避免 session.model_id 为 null 时 orchestrator 拿到 'default' 字符串字面量
    //   被 OpenAI-compatible API 拒收 (e.g. deepseek 报 'but you passed default')
    const provider = getDefaultProvider()
    const prefsModel =
      (agent.profile.preferences as { modelId?: string } | undefined)?.modelId ?? null
    const fallbackModel = provider.models?.[0]?.id ?? null
    const modelId =
      prefsModel && provider.models?.some((m) => m.id === prefsModel) ? prefsModel : fallbackModel

    const session = sessionRepo.create({
      title: agent.name,
      provider_id: provider.id,
      agent_id: agentId,
      model_id: modelId ?? undefined,
    })

    log.info(
      '[agents:create-session] Created session:',
      session.id,
      'for agent:',
      agentId,
      'model:',
      modelId,
    )
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

  ipcMain.handle('agents:install-deps', async (_event, id: string) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(id)
    if (!entry) throw new Error(`Agent not found: ${id}`)

    // 真正触发 skill 安装(npx),完成后再跑 dependency-checker 报告状态
    try {
      const { installAgentSkills } = await import('../agent/skill-installer')
      const installResult = await installAgentSkills(entry.profile, entry.dirPath)
      log.info(
        '[agents:install-deps]',
        id,
        '— installed:',
        installResult.installed,
        'skipped:',
        installResult.skipped.length,
        'failed:',
        installResult.failed.length,
      )
    } catch (err) {
      log.warn(
        '[agents:install-deps] skill installer error (non-fatal):',
        err instanceof Error ? err.message : err,
      )
    }
    // 安装后跑 dep-check 给前端最终状态
    return checkDependencies(entry.profile, entry.dirPath)
  })

  ipcMain.handle('agents:update', (_event, raw: { id: string; profile: unknown }) => {
    const loader = agentManager.getLoader()
    if (!loader) throw new Error('AgentLoader not initialized')
    const entry = loader.getById(raw.id)
    if (!entry) throw new Error(`Agent not found: ${raw.id}`)

    const result = validateProfile(raw.profile, { agentRoot: entry.dirPath })
    if (!result.valid) {
      const summary = result.errors
        .map((e) => `[rule ${e.rule}] ${e.path}: ${e.message}`)
        .join('; ')
      throw new Error(`Invalid profile: ${summary}`)
    }

    writeFileSync(
      join(entry.dirPath, 'agent.json'),
      JSON.stringify(result.profile, null, 2),
      'utf-8',
    )
    loader.loadAll()
    log.info('[agents:update] Updated agent:', raw.id)
  })

  // ─── validate / preview / dry-run / templates ────────────────────────

  /**
   * AC-081: 仅校验 profile,不持久化。返回 ValidatorIssue[] 含 path/rule/severity/message
   * 供编辑 UI 实时反馈。
   */
  ipcMain.handle('agents:validate', (_event, profile: unknown) => {
    const result = validateProfile(profile, {
      knownModelIds: getRegisteredModelSet() as Set<string>,
    })
    if (result.valid) {
      return { valid: true, errors: [], warnings: result.warnings }
    }
    return { valid: false, errors: result.errors, warnings: result.warnings }
  })

  /**
   * AC-082: 渲染 prompt + 工具列表 + 依赖状态 + 可视化数据 + 估算。
   * 不创建/修改任何持久化数据.
   */
  ipcMain.handle('agents:preview', async (_event, profile: unknown) => {
    // 共享 builtin/mcp registry 通过 AgentManager 公开 getter 获取
    return previewAgent(profile, {
      builtinRegistry: agentManager.getBuiltinRegistry(),
      mcpRegistry: agentManager.getMcpToolSource(),
      knownModelIds: getRegisteredModelSet() as Set<string>,
    })
  })

  /**
   * AC-085: 列出内置 agent 模板供用户复制.
   * P0: 返回硬编码模板 (TASK-10 提供更完善的模板库).
   */
  ipcMain.handle('agents:list-templates', async () => {
    const { listTemplates } = await import('../agent/templates')
    return listTemplates()
  })

  /**
   * 复制现有 agent profile (返回未持久化的副本,UI 让用户改 id 后保存).
   */
  ipcMain.handle('agents:duplicate', (_event, id: string) => {
    const src = agentManager.getAgent(id)
    if (!src) throw new Error(`Agent not found: ${id}`)
    const copy = JSON.parse(JSON.stringify(src.profile)) as AgentProfile
    copy.id = `${id}_copy_${Date.now().toString(36)}`
    copy.name = `${src.profile.name} (Copy)`
    return copy
  })

  /**
   * AC-083: dry-run 沙箱执行 (TASK-10 实现).
   */
  ipcMain.handle(
    'agents:dry-run',
    async (_event, args: { profile: unknown; userMessage: string }) => {
      const { dryRunAgent } = await import('../agent/dry-runner')
      return dryRunAgent(args)
    },
  )

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

      // v7: 启发式推荐 mode (express vs guided), 渲染到 welcome 让 Crystallizer + 用户都看到
      const failureCount = countFailedToolCalls(messages)
      const recommendation = recommendMode({
        turnCount: currentMsgCount,
        failureCount,
        // workflowCandidateCount / hasPriorExports 留空 — 当前不做检测,让 LLM 自己判断
      })
      const modeLine =
        recommendation.mode === 'guided'
          ? `🧭 默认采用【分步引导】模式（${recommendation.reasons.join('、')}）— 我会按段落确认，避免漂移。如果想直接出完整草稿，跟我说"快一点"或"express"。`
          : `🧭 默认采用【快速】模式（${recommendation.reasons.join('、')}）— 我会一次性给出完整草稿。如果想分段确认，跟我说"分步"或"guided"。`

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
        modeLine +
        `\n\n` +
        `先确认一下意图 — 你想从这段对话沉淀出什么样的 agent？\n` +
        `（核心任务一句话即可，比如 "把周会纪要整理成结构化日报" / "审查 Go 代码并给改进建议"）\n\n` +
        `我会根据你的意图，从对话里筛出真正用到的步骤和依赖，**过滤掉失败和探索的部分**，再生成草稿。`
      const WELCOME_UPDATED =
        `S1 对话有更新（最新历史已注入到上面）。\n\n` +
        modeLine +
        `\n\n` +
        `如果想基于新内容调整草稿，告诉我要改什么；也可以不动，继续基于之前的方向迭代。`

      const existing = sessionRepo.findWorkbenchForSource(raw.session_id)
      if (existing) {
        // 复用既有 workbench：先把 created_agents 跟 loader 对账，
        // 用户在 Settings 删过的 agent 不会再以 exists=false 的死链出现。
        reconcileCreatedAgents(existing.id)
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
        crystallizer_mode: recommendation.mode,
        crystallizer_mode_reasons: recommendation.reasons,
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
    async (_event, raw: { profile: AgentProfile; workbench_session_id: string }) => {
      try {
        const profile = raw.profile

        // 1. validateProfile
        const result = validateProfile(profile)
        // adapt new ValidatorIssue[] → string for legacy error path
        if (!result.valid) {
          return {
            success: false,
            error: result.errors.map((e) => `[rule ${e.rule}] ${e.path}: ${e.message}`).join('; '),
          }
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
        // Schema 2.0 Agent 是文件夹 bundle:
        //   <root>/agent.json       — profile (必有)
        //   <root>/skills/          — profile.skills 引用的 skill 包(占位即建,空目录也允许)
        //   <root>/references/      — profile.references[].path 引用的本地文件
        //   <root>/README.md        — 自动生成给人看的元数据
        mkdirSync(targetDir, { recursive: true })
        mkdirSync(join(targetDir, 'skills'), { recursive: true })
        mkdirSync(join(targetDir, 'references'), { recursive: true })

        // P1: 物理化 references[]
        // LLM 可能写绝对路径(workspace 内的文件)或相对路径,尝试从这些来源复制到 <root>/references/<basename>:
        //   1. 路径已经是绝对路径 + 文件存在 → 直接 cp
        //   2. 路径相对于 workbench session 的 source workspace → cp
        //   3. 都没找到 → 保留 entry,dep-checker 会标 missing,UI 警告用户
        // 复制后 path 改写为 './references/<basename>',让 agent 自包含且导出 .talor-pack 时整目录跟带
        const sourceWorkspace = resolveSourceWorkspaceFromWorkbench(raw.workbench_session_id)
        const referencesReport = materializeReferenceFiles(profile, targetDir, sourceWorkspace)
        if (referencesReport.copied > 0 || referencesReport.missing.length > 0) {
          log.info(
            '[agents:create-from-draft] references — copied:',
            referencesReport.copied,
            'missing:',
            referencesReport.missing,
          )
        }

        writeFileSync(join(targetDir, 'agent.json'), JSON.stringify(profile, null, 2), 'utf-8')

        // README — 给人看的轻量元数据,从 profile 派生,不影响装配
        const readmeContent = buildReadmeContent(profile)
        writeFileSync(join(targetDir, 'README.md'), readmeContent, 'utf-8')

        // 触发 skill 自动安装 — 失败不阻断保存,把结果返给 renderer 让用户看到
        let skillInstallResult: {
          installed: Array<{ name: string; from: string }>
          skipped: Array<{ name: string; reason: string }>
          failed: Array<{ name: string; error: string }>
        } = { installed: [], skipped: [], failed: [] }
        try {
          const { installAgentSkills } = await import('../agent/skill-installer')
          skillInstallResult = await installAgentSkills(profile, targetDir)
        } catch (skillErr) {
          log.warn(
            '[agents:create-from-draft] skill auto-install partial failure:',
            skillErr instanceof Error ? skillErr.message : skillErr,
          )
        }

        // 5. AgentLoader 重载
        loader.loadAll()
        const newEntry = loader.getById(profile.id)
        if (newEntry) {
          // 自动注册（用户审阅+保存=确认，减少摩擦）
          // v8.1: 业务 agent 注册时用平台 mcpRegistry,让新 agent 自动继承平台 MCP
          const skillsDirPath = join(newEntry.dirPath, 'skills')
          const skillRegistry = existsSync(skillsDirPath)
            ? SkillRegistry.fromDir(skillsDirPath)
            : SkillRegistry.fromDir(null)
          agentManager.registerBusinessAgent(profile.id, {
            profile: newEntry.profile,
            source: newEntry.dirPath,
            mcpRegistry: agentManager.getMcpToolSource(),
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
          `[Crystallize] saved agent=${profile.id} v=${profile.version} from workbench=${raw.workbench_session_id} ` +
            `skills installed=${skillInstallResult.installed.length} skipped=${skillInstallResult.skipped.length} failed=${skillInstallResult.failed.length}`,
        )
        return {
          success: true,
          id: profile.id,
          created_at: createdAt,
          skill_install: skillInstallResult,
        }
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
    // 每次列表请求都做一次自愈：工作台开着时用户在别处删了 agent，
    // 下一次 refresh() 就能立即把死链从 metadata 抠掉，UI 不再显示。
    const created = reconcileCreatedAgents(raw.workbench_session_id)
    const loader = agentManager.getLoader()
    return created.map((c) => {
      const entry = loader?.getById(c.id) ?? null
      // reconcile 后理论上 entry 一定存在;loader 失效或并发删除时 fallback。
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
}

/**
 * 从 workbench session 元数据回溯 source 对话的 workspace 路径,
 * 用于解析 profile.references[].path 中的相对路径。
 */
function resolveSourceWorkspaceFromWorkbench(workbenchSessionId: string): string | null {
  try {
    const wsMeta = sessionRepo.getMetadata(workbenchSessionId)
    const sourceSessionId = wsMeta.source_session_id as string | undefined
    if (!sourceSessionId) return null
    const sourceSession = sessionRepo.getById(sourceSessionId)
    return sourceSession?.workspace ?? null
  } catch {
    return null
  }
}

interface ReferenceMaterializeReport {
  copied: number
  missing: string[]
}

/**
 * 把 profile.references[].path 引用的文件复制到 <agentDir>/references/<basename>,
 * 并把 profile 中的 path 改写为相对路径 './references/<basename>'。
 *
 * 找不到源文件时保留 entry 但 path 不变,dep-checker 会标 missing,UI 警示用户。
 */
function materializeReferenceFiles(
  profile: AgentProfile,
  agentDir: string,
  sourceWorkspace: string | null,
): ReferenceMaterializeReport {
  const report: ReferenceMaterializeReport = { copied: 0, missing: [] }
  const items = profile.references ?? []
  if (items.length === 0) return report

  const referencesDir = join(agentDir, 'references')

  for (let i = 0; i < items.length; i++) {
    const k = items[i]
    const declaredPath = k.path

    // 候选源路径:绝对 path / sourceWorkspace 相对 / cwd 相对
    const candidates: string[] = []
    if (declaredPath.startsWith('/')) {
      candidates.push(declaredPath)
    } else {
      if (sourceWorkspace) candidates.push(join(sourceWorkspace, declaredPath))
      candidates.push(declaredPath) // 相对 cwd 兜底
    }

    let foundSrc: string | null = null
    for (const c of candidates) {
      if (existsSync(c)) {
        foundSrc = c
        break
      }
    }

    if (!foundSrc) {
      report.missing.push(declaredPath)
      continue
    }

    const basename = declaredPath.split('/').pop() ?? `reference-${i}.bin`
    const dest = join(referencesDir, basename)
    try {
      writeFileSync(dest, readFileSync(foundSrc))
      // 改写 profile 中的 path 为相对路径
      ;(profile.references as Array<{ path: string }>)[i].path = `./references/${basename}`
      report.copied++
    } catch (err) {
      log.warn('[references-materialize] copy failed:', foundSrc, '→', dest, err)
      report.missing.push(declaredPath)
    }
  }

  return report
}

function buildReadmeContent(profile: AgentProfile): string {
  const lines: string[] = []
  lines.push(`# ${profile.name}`)
  lines.push('')
  lines.push(`> ${profile.description}`)
  lines.push('')
  lines.push(`- **id**: \`${profile.id}\``)
  lines.push(`- **version**: ${profile.version}`)
  lines.push(`- **schemaVersion**: ${profile.schemaVersion}`)
  lines.push(`- **created_at**: ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Folder Structure')
  lines.push('')
  lines.push('```')
  lines.push('agent.json        Schema 2.0 profile')
  lines.push('skills/           profile.skills 引用的 skill 包')
  lines.push('references/       profile.references 引用的本地文件')
  lines.push('README.md         本文件')
  lines.push('```')
  lines.push('')
  lines.push('_Generated by Talor Crystallizer._')
  return lines.join('\n')
}
