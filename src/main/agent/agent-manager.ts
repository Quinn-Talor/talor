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
  schemaVersion: '2.0',
  id: '__chat__',
  name: 'Talor',
  description:
    'Talor general-purpose AI assistant. Coordinates with specialized business agents via delegate_agent.',
  version: '0.2.0',
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
Talor Agent Schema 2.0 — top-level fields (flat):

  schemaVersion: "2.0"  (literal)
  id:           snake_case, /^[a-z0-9_-]+$/
  name:         display name
  description:  multi-line: identity + 会做 + 不会做
  version:      semver
  agentPrompt:  free-form markdown (operating manual). Sections:
                  ## When invoked (optional)
                  ## Required Inputs (optional)
                  ## Workflow (required, 3-7 numbered steps)
                  ## Principles (required, bullet list)
                  ## Output (required, format + structure)
                  ## Output style (optional)
                  ## Examples (optional)

Dependency manifest (all optional, all reference platform resources by name):
  tools:        BuiltinToolName[] whitelist (read/write/edit/bash/glob/grep/ls)
  skills:       string[]   — names of skills installed at ~/.claude/skills/<name>/SKILL.md
  mcpServers:   string[]   — names of MCP servers configured in Settings → MCP Servers (mcp_servers DB)
  cli:          string[]   — command names the agent uses via bash (e.g. ["gh", "jq"]); dep-checker only runs \`command -v\`
  references:   ReferenceFile[]  (per-agent file index, loaded on demand via read)
  subagents:    { ids?, allowAny? }  (delegate_agent scope)
  preferences:  { modelId?, providerId? }
`.trim()

const CRYSTALLIZER_PROFILE: AgentProfile = {
  schemaVersion: '2.0',
  id: '__crystallizer__',
  name: 'Crystallizer',
  description: `Crystallizes a chat session into a Schema 2.0 agent profile.

会做：锚定用户意图 → 过滤对话噪声 → 提取信号路径依赖 → 以自然语言确认语义 → 最终输出一份合法 JSON。

不会做：推断未经用户确认的意图、在对话阶段展示 JSON、编造步骤或依赖、运行 agent 或修改文件系统。`,
  version: '0.2.0',
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
   - skills[]:     name of skill at ~/.claude/skills/<name>/SKILL.md (string[] — no install method, no required flag)
   - mcpServers[]: name of MCP server pre-configured in Settings → MCP Servers (string[])
                   If conversation used an MCP not yet in Settings, name it and add a TODO in the summary:
                   "TODO: 请先在 Settings → MCP Servers 配置 <name>,Talor 才能连接"
   - cli[]:        command name(s) the agent invokes via bash (string[] — user installs themselves)
   Apply NECESSITY FILTER.
4. Lock semantics in natural language with the user (in "guided" mode: section by section).
5. Emit the final Schema 2.0 JSON only at the final review step, preceded by a ≤7-bullet summary.

## Principles
- Anchor on USER INTENT first — without it the result is a generic summary, not an agent.
- Never show JSON during conversational turns.
- Never invent steps or dependencies not evidenced in the signal path.
- Ask for missing info one question at a time.
- Dependencies are pure name references — never inline transport / install method / required flag.
- Detect and drop any Schema 1.0 fields (identity / mission / method / delivery / execution wrappers) when seeding from old drafts. Also drop dead pre-引用化 fields: SkillItem.purpose/required, McpServerDependency.transport/description/required/tools, CliDependency.install/version/required.

## Output
Emit ONE Schema 2.0 agent.json in a fenced \`\`\`json block at final review:
\`\`\`json
{
  "schemaVersion": "2.0",
  "id": "<snake_case>",
  "name": "<display name>",
  "description": "<identity + 会做 + 不会做>",
  "version": "1.0.0",
  "agentPrompt": "...",
  "tools": ["read", "bash"],
  "skills": ["lark-doc"],
  "mcpServers": ["github"],
  "cli": ["gh", "jq"],
  "references": [],
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
  if (allowedServerNames.length === 0) return null
  return platformRegistry.filterByServerNames(allowedServerNames)
}

export class AgentManager {
  private platformChat: Agent | null = null
  private platformCrystallizer: Agent | null = null
  private readonly businessAgents = new Map<string, Agent>()

  private deps: PlatformAgentDeps | null = null
  private loader: AgentLoader | null = null

  init(deps: PlatformAgentDeps): void {
    this.deps = deps

    if (deps.agentsDir) {
      this.loader = new AgentLoader(deps.agentsDir)
      this.loader.loadAll()
      log.info('[AgentManager] AgentLoader initialized, agents:', this.loader.size)

      for (const entry of this.loader.getAll()) {
        const profile = entry.profile
        // v2.0 引用化: 业务 agent 从平台 mcpRegistry 按 name 过滤,不再自带 transport 定义
        const agentMcpRegistry = buildAgentMcpToolSource(deps.mcpRegistry, profile.mcpServers ?? [])

        // skills 从平台 ~/.claude/skills 按 name 过滤(SkillRegistry.fromPlatformDir 由 deps 提供)
        const agentSkillRegistry = deps.skillRegistry.filterByNames(profile.skills ?? [])

        this.registerBusinessAgent(profile.id, {
          profile,
          source: entry.dirPath,
          mcpRegistry: agentMcpRegistry,
          skillRegistry: agentSkillRegistry,
        })
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
    })

    this.platformCrystallizer = new Agent({
      profile: CRYSTALLIZER_PROFILE,
      source: null,
      builtinRegistry: deps.builtinRegistry,
      mcpRegistry: deps.mcpRegistry,
      skillRegistry: deps.skillRegistry,
      delegationRuntime: deps.delegationRuntime,
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

  get isInitialized(): boolean {
    return this.platformChat !== null
  }
}
