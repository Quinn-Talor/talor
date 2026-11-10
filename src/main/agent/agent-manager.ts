// src/main/agent/agent-manager.ts — 业务层：Agent 注册表
//
// 存平台 agent（__chat__ / __crystallizer__）与业务 agent 的 profile 及来源目录。能力（工具、MCP、skill、
// 委托）由能力目录在每轮按 profile 计算（runtime/catalog.ts），这里只存 profile。
//
// 允许依赖: agent/loader、skills/registry、@shared/types
// 禁止依赖: ipc/*、runtime/*

import log from 'electron-log'
import type { AgentProfile } from '@shared/types/agent'
import { AgentLoader } from './loader'
import type { SkillRegistry } from '../skills/registry'

/** AgentManager 存储的单位：profile 与来源目录（磁盘用户 agent 为其目录，平台与 Feature agent 为 null）。 */
export interface RegisteredAgent {
  profile: AgentProfile
  source: string | null
}

export interface AgentManagerDeps {
  skillRegistry: SkillRegistry
  agentsDir?: string
}

// Schema 2.0: __chat__ platform agent — infrastructure, not a business agent.
// 它是基础设施而非数字员工，没有"完成 X 任务"的具体语义。
export const CHAT_PROFILE: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description: 'Talor general-purpose AI assistant. Coordinates with specialized business agents.',
  // 目标驱动，不点名工具；工具的用法由各能力的说明给出。
  agentPrompt: `## Workflow
1. Work out what the request needs: something on this machine (files, shell, code) or something outside it (a service, a website, remote data, a third-party platform).
2. Do local work with the built-in tools. For anything outside this machine, look for a matching tool first: more tools are available than the ones listed, and you can find them by searching. Fall back to a local command only when no tool matches.
3. When an available skill matches the task, read it before acting.
4. Return a clear, concise answer.

## Principles
- When the user names a service or platform, search for its tools before checking for a local CLI; a missing local binary does not mean the capability is unavailable.
- Confirm destructive actions before running them.
- If a rule, hook or the user denies an action, do not try to achieve the same thing another way (another tool, a shell command, a different path); explain the denial or do the parts that are allowed.
- A denial covers the turn it happened in. When the user asks for the action again in a later message, try it once more, since the rules or their decision may have changed; if it is denied again, explain.`,
  subagents: {
    // 主对话默认全开放：可委托给所有已注册业务 agent
    allowAny: true,
  },
}

// Schema 2.0 · Crystallizer:
//   ① 锚定用户意图 → ② 信号过滤(从被接受的成果反向回溯) → ③ 提取依赖必要性 →
//   ④ 自然语言锁定语义(对话期间不展示 JSON) → ⑤ 最终评审才出完整 JSON。
// 双模式:Express(一气呵成) / Guided(分段确认),共享同一套规则,仅 emission cadence 分叉。
//
// 不锁模型 — 用 session 当前选定的 provider/model 即可(用户可随时切到更强模型)。
const SCHEMA_DESCRIPTION = `
Talor Agent 极简 schema — 8 字段:

  id:           snake_case, /^[a-z0-9_-]+$/
  name:         display name
  description:  multi-line: identity + 会做 + 不会做
  agentPrompt:  free-form markdown (operating manual). Sections:
                  ## When invoked (optional)
                  ## Required Inputs (optional)
                  ## Workflow (required, 3-7 numbered steps)
                  ## Principles (required, bullet list)
                  ## Output (required, format + structure)

能力(全 optional,全 string[]/name 引用平台资源):
  tools:        BuiltinToolName[] — 内置工具白名单 (read/write/edit/bash/glob/grep/ls)
  skills:       string[]          — ~/.talor/skills/<name>/SKILL.md 的 name
  mcpServers:   string[]          — Settings → MCP Servers 中配的 name
  subagents:    { ids?, allowAny? } — delegate_agent 工具的 scope 配置
`.trim()

const CRYSTALLIZER_PROFILE: AgentProfile = {
  id: '__crystallizer__',
  name: 'Crystallizer',
  description: `Crystallizes a chat session into a Talor agent profile (极简 8-字段 schema).

会做：锚定用户意图 → 过滤对话噪声 → 提取信号路径依赖 → 以自然语言确认语义 → 最终输出一份合法 JSON。

不会做：推断未经用户确认的意图、在对话阶段展示 JSON、编造步骤或依赖、运行 agent 或修改文件系统。`,
  agentPrompt: `${SCHEMA_DESCRIPTION}

## When invoked
User wants to save a workflow from the current chat as a reusable agent.
Typically triggered by: "把刚才的过程做成 agent" / "crystallize this" / "export as agent".

## Required Inputs
- **user_intent** (text, REQUIRED): Confirmed goal — what agent the user wants to crystallize.
- **mode** (text, optional): "express" (one-shot) or "guided" (section-by-section). Defaults to heuristic.
- **agent_id_hint** (text, optional): Suggested id in snake_case; otherwise inferred.

## Workflow
1. In turn 1 — state best-guess intent, ask user to confirm or redirect. DO NOT draft yet.
2. Filter chat history: backward-trace from the user-accepted outcome to extract the signal path. Drop noise (failed calls, abandoned approaches, exploratory probes, off-topic asides).
3. Map signal-path steps to:
   - tools[]:      builtin names (read/write/edit/bash/glob/grep/ls)
   - skills[]:     name of skill at ~/.talor/skills/<name>/SKILL.md
   - mcpServers[]: name of MCP server pre-configured in Settings → MCP Servers
                   若对话用到的 MCP 未在 Settings 配过 → 在 summary 末尾加 TODO:
                   "⚠️ TODO: 请先在 Settings → MCP Servers 配置 <name>,Talor 才能连接"
   - subagents:    若对话依赖其它已注册业务 agent, 在 subagents.ids 列出 (delegate_agent scope)
   Apply NECESSITY FILTER. agent 若不依赖 CLI/平台外资源,不要编。

   注:agent 极简 schema 只有 8 个字段(id/name/description/agentPrompt + tools/skills/mcpServers/subagents),
   不存在 cli/references/preferences/version/schemaVersion/avatar — 旧字段一律不输出。
4. Lock semantics in natural language with the user (in "guided" mode: section by section).
5. Emit the final agent.json only at the final review step, preceded by a ≤7-bullet summary.

## Principles
- Anchor on USER INTENT first — without it the result is a generic summary, not an agent.
- Never show JSON during conversational turns.
- Never invent steps or dependencies not evidenced in the signal path.
- Ask for missing info one question at a time.
- Dependencies are pure name references (string[]).

## Output
Emit ONE agent.json in a fenced \`\`\`json block at final review:
\`\`\`json
{
  "id": "<snake_case>",
  "name": "<display name>",
  "description": "<identity + 会做 + 不会做>",
  "agentPrompt": "...",
  "tools": ["read", "bash"],
  "skills": ["lark-doc"],
  "mcpServers": ["github"],
  "subagents": { "ids": [] }
}
\`\`\`

Preceded by a summary:
✅ 已生成 agent 草稿：
• 锚定意图：<one sentence>
• 工具依赖：<count>
• 流程步骤：<count>
• 已过滤噪声：<count> 步
[若有 MCP 未配置 → 额外列 "⚠️ TODO: 请先在 Settings → MCP Servers 配置 <X>"]

## Output style
Terse, evidence-based. Chinese when the user writes Chinese. Natural language only during dialogue turns.
`.trim(),
  tools: ['read'],
  // No preferences — model not locked. Crystallizer uses session-selected provider/model.
}

export class AgentManager {
  private platformChat: RegisteredAgent | null = null
  private platformCrystallizer: RegisteredAgent | null = null
  private readonly businessAgents = new Map<string, RegisteredAgent>()
  /** Feature 声明并注册的 agent profile(origin=feature),供 getFeatureAgentProfiles / 只读门禁。 */
  private readonly featureProfiles: AgentProfile[] = []
  /** 当前由 Feature 承载(没有被用户版覆盖、替换或注销)的 agent id;能力目录按它排除核心来源里的 Feature agent。 */
  private readonly featureIds = new Set<string>()

  private deps: AgentManagerDeps | null = null
  private loader: AgentLoader | null = null

  init(deps: AgentManagerDeps): void {
    this.deps = deps

    // 用户池 agent(磁盘 ~/.talor/agents)。
    // 先于 feature 注册(feature 经 installFeatures 在 init 之后 registerFeatureAgent):
    // 同 id 时用户版已注册 → feature 跳过(fork-override,用户优先)。
    if (deps.agentsDir) {
      this.loader = new AgentLoader(deps.agentsDir)
      this.loader.loadAll()
      log.info('[AgentManager] AgentLoader initialized, agents:', this.loader.size)
      for (const entry of this.loader.getAll()) {
        this.businessAgents.set(entry.profile.id, { profile: entry.profile, source: entry.dirPath })
      }
    }

    this.platformChat = { profile: CHAT_PROFILE, source: null }
    this.platformCrystallizer = { profile: CRYSTALLIZER_PROFILE, source: null }

    log.info('[AgentManager] Initialized with platform agents: __chat__, __crystallizer__')
  }

  getAgent(agentId: string): RegisteredAgent | null {
    if (agentId === '__chat__') return this.platformChat
    if (agentId === '__crystallizer__') return this.platformCrystallizer
    return this.businessAgents.get(agentId) ?? null
  }

  getChatAgent(): RegisteredAgent {
    if (!this.platformChat) throw new Error('AgentManager not initialized')
    return this.platformChat
  }

  /**
   * Feature 装配端口的落地(installFeatures 经 ports.registerAgent 调用):
   * 把 feature 声明的 agent 内存注册为业务 agent,标 origin=feature(featureProfiles)。
   * Feature 工具由能力目录登记(features/install.ts),这里不存。
   * 同 id 已注册(用户池)→ 跳过(fork-override,用户版优先)。须在 init() 之后调用。
   */
  registerFeatureAgent(profile: AgentProfile): void {
    if (!this.deps) throw new Error('AgentManager.init() must run before feature registration')
    if (this.businessAgents.has(profile.id)) {
      log.info('[AgentManager] user agent overrides feature agent:', profile.id)
      return
    }
    this.businessAgents.set(profile.id, { profile, source: null })
    this.featureProfiles.push(profile)
    this.featureIds.add(profile.id)
    log.info('[AgentManager] Registered feature agent:', profile.id)
  }

  registerBusinessAgent(agentId: string, entry: RegisteredAgent): RegisteredAgent {
    if (!this.deps) throw new Error('AgentManager not initialized')
    if (this.businessAgents.has(agentId)) {
      log.info('[AgentManager] Replacing existing business agent:', agentId)
    }
    this.businessAgents.set(agentId, entry)
    this.featureIds.delete(agentId)
    log.info('[AgentManager] Registered business agent:', agentId)
    return entry
  }

  /** 编辑保存后用磁盘最新 profile 替换用户池 agent。 */
  reloadUserAgent(profile: AgentProfile, dirPath: string): RegisteredAgent {
    const entry: RegisteredAgent = { profile, source: dirPath }
    this.businessAgents.set(profile.id, entry)
    this.featureIds.delete(profile.id)
    log.info('[AgentManager] Reloaded user agent:', profile.id)
    return entry
  }

  unregisterBusinessAgent(agentId: string): boolean {
    const removed = this.businessAgents.delete(agentId)
    this.featureIds.delete(agentId)
    if (removed) {
      log.info('[AgentManager] Unregistered business agent:', agentId)
    }
    return removed
  }

  listBusinessAgentIds(): string[] {
    return Array.from(this.businessAgents.keys())
  }

  getLoader(): AgentLoader | null {
    return this.loader
  }

  /** 平台 SkillRegistry(能力目录的 skill 来源)。 */
  getPlatformSkillRegistry(): SkillRegistry | null {
    if (!this.deps) throw new Error('AgentManager not initialized')
    return this.deps.skillRegistry ?? null
  }

  /**
   * 公开 feature 自管的内存 agent profile(只读;不在 ~/.talor/agents 用户池)。
   * 供 agents:list / agents:get 把内置 feature agent 只读露出给 UI(可选择/预览,不可编辑删除)。
   */
  getFeatureAgentProfiles(): AgentProfile[] {
    return this.featureProfiles
  }

  /** 当前由 Feature 承载的 agent id。 */
  featureAgentIds(): ReadonlySet<string> {
    return this.featureIds
  }

  get isInitialized(): boolean {
    return this.platformChat !== null
  }
}
