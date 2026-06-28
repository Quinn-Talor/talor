// src/main/agent/agent-manager.ts — 业务层：Agent 管理器
//
// 管理平台 Agent 单例 + 业务 Agent 生命周期。
// 平台 Agent 共享全局 mcpRegistry/skillRegistry。
// 业务 Agent 按 profile 创建独立 mcpRegistry（懒加载）+ 独立 skillRegistry。

import log from 'electron-log'
import type { AgentProfile } from '@shared/types/agent'
import { Agent } from './agent'
import type { AgentOptions } from './agent'
import { AgentLoader } from './loader'
import type { BuiltinToolRegistry } from './builtin-registry'
import type { McpToolSource } from './agent-toolset'
import { SkillRegistry } from '../skills/registry'
import type { McpRegistry } from '../mcp/client'
import type { DelegationRuntime } from './delegate-agent'
import type { ToolDefinition } from '../tools/types'

export interface PlatformAgentDeps {
  builtinRegistry: BuiltinToolRegistry
  /** 平台 MCP registry — 持有 mcp_servers DB 表中所有已配 server。业务 agent 按 name 过滤。 */
  mcpRegistry: McpRegistry
  skillRegistry: SkillRegistry
  agentsDir?: string
  /**
   * 委托运行时。统一注入给所有 agent（含平台 + 业务）。
   * 委托能力由 profile 字段决定：
   *   - profile.subagents.allowAny=true → 全开放（仅 __chat__）
   *   - profile.subagents.ids=[...] → 仅可委托列表内 agent
   *   - 都没声明 → scope=[]，工具持有但 listing 为空
   *
   * 启动期由 main/index.ts 装配并注入。
   */
  delegationRuntime?: DelegationRuntime
}

// Schema 2.0: __chat__ platform agent — infrastructure, not a business agent.
// 它是基础设施而非数字员工，没有"完成 X 任务"的具体语义。
const CHAT_PROFILE: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description:
    'Talor general-purpose AI assistant. Coordinates with specialized business agents via delegate_agent.',
  agentPrompt: `## Workflow
1. Understand the user request and identify what it touches: local files/shell on this machine, or something outside it (a service, remote data, 3rd-party platform).
2. Pick the right tool family:
   - Local files / shell / local code editing → built-in tools (read/write/edit/bash/glob/grep/ls).
   - Anything reaching outside this machine → MCP tools in your tool list. If no visible MCP tool matches, call search_tool to refresh the list before falling back to bash.
3. Delegate well-scoped sub-tasks to registered business agents via delegate_agent.
4. Return a clear, concise response.

## Principles
- Prefer direct tool use for common tasks.
- When the user names a service or platform, scan MCP before checking a local CLI — a missing local binary doesn't mean the capability is unavailable.
- Delegate to specialized agents when the task matches their profile.
- Always confirm destructive actions before executing.`,
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

/**
 * 把 agent.profile.mcpServers (string[] of platform MCP server names) 转换为
 * 受限的 McpToolSource — 仅暴露列在白名单的 server 的工具。
 *
 * 平台 MCP servers 在 Settings 配置(mcp_servers DB),全部加载到 platform mcpRegistry;
 * 这里只是 view filter,不复制不重连。
 */
function buildAgentMcpToolSource(
  platformRegistry: McpRegistry,
  allowedServerNames: string[],
): McpToolSource | null {
  // 默认全给(与 builtin 一致:profile 不声明 mcpServers = 全部已配置 MCP);
  // 显式声明则收窄到该子集。McpRegistry 结构上满足 McpToolSource(listRegisteredTools + execute)。
  if (allowedServerNames.length === 0) return platformRegistry
  return platformRegistry.filterByServerNames(allowedServerNames)
}

export class AgentManager {
  private platformChat: Agent | null = null
  private platformCrystallizer: Agent | null = null
  private readonly businessAgents = new Map<string, Agent>()
  /** Feature 声明并注册的 agent profile(origin=feature),供 getFeatureAgentProfiles / 只读门禁。 */
  private readonly featureProfiles: AgentProfile[] = []

  private deps: PlatformAgentDeps | null = null
  private loader: AgentLoader | null = null

  init(deps: PlatformAgentDeps): void {
    this.deps = deps

    // 用户池 agent(磁盘 ~/.talor/agents)。v2.0 引用化:mcp/skill 按 name 从平台过滤。
    // 先于 feature 注册(feature 经 installFeatures 在 init 之后 registerFeatureAgent):
    // 同 id 时用户版已注册 → feature 跳过(fork-override,用户优先)。
    if (deps.agentsDir) {
      this.loader = new AgentLoader(deps.agentsDir)
      this.loader.loadAll()
      log.info('[AgentManager] AgentLoader initialized, agents:', this.loader.size)
      for (const entry of this.loader.getAll()) {
        this.businessAgents.set(entry.profile.id, this.buildAgent(entry.profile, entry.dirPath, []))
      }
    }

    // 平台 agent 装配。两个都接收 delegationRuntime；委托能力由
    // profile.subagents 决定：
    //   - __chat__:        subagents.allowAny=true → 可委托所有业务 agent
    //   - __crystallizer__: 无 subagents → scope=[]
    this.platformChat = new Agent({
      profile: CHAT_PROFILE,
      source: null,
      builtinRegistry: deps.builtinRegistry,
      mcpRegistry: deps.mcpRegistry,
      skillRegistry: deps.skillRegistry,
      delegationRuntime: deps.delegationRuntime,
      // __chat__ 无 feature 工具 → 拿不到 invest 等业务工具(只能 delegate)。
      featureTools: [],
    })

    this.platformCrystallizer = new Agent({
      profile: CRYSTALLIZER_PROFILE,
      source: null,
      builtinRegistry: deps.builtinRegistry,
      mcpRegistry: deps.mcpRegistry,
      skillRegistry: deps.skillRegistry,
      delegationRuntime: deps.delegationRuntime,
      featureTools: [],
    })

    log.info('[AgentManager] Initialized with platform agents: __chat__, __crystallizer__')
  }

  getAgent(agentId: string): Agent | null {
    if (agentId === '__chat__') return this.platformChat
    if (agentId === '__crystallizer__') return this.platformCrystallizer
    return this.businessAgents.get(agentId) ?? null
  }

  getChatAgent(): Agent {
    if (!this.platformChat) throw new Error('AgentManager not initialized')
    return this.platformChat
  }

  /**
   * 从 profile 构造一个业务 Agent 实例(mcp/skill 按 profile 引用从平台过滤)。
   * source:磁盘用户 agent = dirPath(派生本地 skills/knowledge);feature agent = null。
   * 用户池循环 + registerFeatureAgent 共用。
   */
  private buildAgent(profile: AgentProfile, source: string | null, tools: ToolDefinition[]): Agent {
    if (!this.deps) throw new Error('AgentManager not initialized')
    return new Agent({
      profile,
      source,
      builtinRegistry: this.deps.builtinRegistry,
      delegationRuntime: this.deps.delegationRuntime,
      mcpRegistry: buildAgentMcpToolSource(this.deps.mcpRegistry, profile.mcpServers ?? []),
      skillRegistry: this.deps.skillRegistry.filterByNames(profile.skills ?? []),
      featureTools: tools,
    })
  }

  /**
   * Feature 装配端口的落地(installFeatures 经 ports.registerAgent 调用):
   * 把 feature 声明的 agent(连工具)内存注册为业务 agent,标 origin=feature(featureProfiles)。
   * 同 id 已注册(用户池)→ 跳过(fork-override,用户版优先)。须在 init() 之后调用。
   */
  registerFeatureAgent(profile: AgentProfile, tools: ToolDefinition[] = []): void {
    if (!this.deps) throw new Error('AgentManager.init() must run before feature registration')
    if (this.businessAgents.has(profile.id)) {
      log.info('[AgentManager] user agent overrides feature agent:', profile.id)
      return
    }
    this.businessAgents.set(profile.id, this.buildAgent(profile, null, tools))
    this.featureProfiles.push(profile)
    log.info('[AgentManager] Registered feature agent:', profile.id)
  }

  registerBusinessAgent(
    agentId: string,
    opts: Omit<AgentOptions, 'builtinRegistry' | 'delegationRuntime'>,
  ): Agent {
    if (!this.deps) throw new Error('AgentManager not initialized')

    const existing = this.businessAgents.get(agentId)
    if (existing) {
      log.info('[AgentManager] Replacing existing business agent:', agentId)
    }

    // 业务 agent 也接收 delegationRuntime。能否真正委托由 profile 决定：
    //   - profile.subagents 非空 → 可委托列表内 agent（受限 scope）
    //   - profile.subagents 缺省 → scope=[]，工具持有但 listing 为空
    // 数据驱动差异，不再用"业务 agent 不接收 runtime"做特殊隔离。
    const agent = new Agent({
      ...opts,
      builtinRegistry: this.deps.builtinRegistry,
      delegationRuntime: this.deps.delegationRuntime,
      // 用户/业务 agent 经此路径(enable/duplicate)无 feature 工具;feature agent 走 registerFeatureAgent。
      featureTools: [],
    })
    this.businessAgents.set(agentId, agent)
    log.info('[AgentManager] Registered business agent:', agentId)
    return agent
  }

  unregisterBusinessAgent(agentId: string): boolean {
    const removed = this.businessAgents.delete(agentId)
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

  /**
   * 公开访问 builtinRegistry / mcpRegistry,供 IPC `agents:preview`
   * 等需要构造临时 Agent 实例的场景使用。避免反取 chat agent 内部字段。
   */
  getBuiltinRegistry(): import('./builtin-registry').BuiltinToolRegistry {
    if (!this.deps) throw new Error('AgentManager not initialized')
    return this.deps.builtinRegistry
  }

  getMcpToolSource(): import('./agent-toolset').McpToolSource | null {
    if (!this.deps) throw new Error('AgentManager not initialized')
    return this.deps.mcpRegistry ?? null
  }

  /** 公开平台 McpRegistry,供 IPC 装配时按 agent.profile.mcpServers 过滤。 */
  getMcpRegistry(): McpRegistry | null {
    if (!this.deps) throw new Error('AgentManager not initialized')
    return this.deps.mcpRegistry ?? null
  }

  /** 公开平台 SkillRegistry,供 IPC 装配时按 agent.profile.skills 过滤。 */
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

  get isInitialized(): boolean {
    return this.platformChat !== null
  }
}
