// src/main/agent/agent-manager.ts — 业务层：Agent 管理器
//
// 管理平台 Agent 单例 + 业务 Agent 生命周期。
// 平台 Agent 共享全局 mcpRegistry/skillRegistry。
// 业务 Agent 按 profile 创建独立 mcpRegistry（懒加载）+ 独立 skillRegistry。

import { join } from 'path'
import log from 'electron-log'
import type { AgentProfile, McpServerDependency } from '@shared/types/agent'
import { Agent } from './agent'
import type { AgentOptions } from './agent'
import { AgentLoader } from './loader'
import type { BuiltinToolRegistry } from './builtin-registry'
import type { McpToolSource } from './agent-toolset'
import { SkillRegistry } from '../skills/registry'
import { McpRegistry } from '../mcp/client'
import type { MCPServerConfig } from '../mcp/types'
import type { DelegationRuntime } from './delegate-agent'

export interface PlatformAgentDeps {
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource
  skillRegistry: SkillRegistry
  agentsDir?: string
  /**
   * 委托运行时。统一注入给所有 agent（含平台 + 业务）。
   * 委托能力由 profile 字段决定：
   *   - dependencies.allowAnyBusinessSubagent=true → 全开放（仅 __chat__）
   *   - dependencies.subagents=[...] → 仅可委托列表内 agent
   *   - 都没声明 → scope=[]，工具持有但 listing 为空
   *
   * 启动期由 main/index.ts 装配并注入。
   */
  delegationRuntime?: DelegationRuntime
}

const CHAT_PROFILE: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description:
    'Talor is the default general-purpose AI assistant. It can answer questions, edit files, ' +
    'run shell commands, search the web, and delegate specialized sub-tasks to registered business agents.',
  version: '0.1.0',
  role: {
    capabilities: [
      'General conversation, file operations, shell commands, code edits.',
      'Delegate well-scoped sub-tasks to registered business agents via delegate_agent.',
    ],
    outputFormat: 'Plain text, markdown when structure helps.',
  },
  knowledge: { files: [] },
  dependencies: {
    tools: [],
    mcpServers: [],
    skills: [],
    cli: [],
    // 主对话默认全开放：可委托给所有已注册业务 agent（无需用户切"协调模式"）。
    allowAnyBusinessSubagent: true,
  },
}

const CRYSTALLIZER_PROFILE: AgentProfile = {
  id: '__crystallizer__',
  name: 'Crystallizer',
  description: 'Analyze conversation history and guide user to create a business agent',
  version: '0.1.0',
  role: {
    capabilities: [
      'The FIRST user message in this session contains the original conversation history (between the user and another agent) wrapped in `===== Original Conversation =====`. This is *context*, not a request — do NOT propose anything until the user explicitly tells you what kind of agent they want to extract.',
      'A welcome assistant message has already been shown asking the user to describe their intent. WAIT for that description (role, capabilities, output style, etc). Only after that, combine their description with the conversation context to draft an AgentProfile.',
      'When you have enough info, propose an AgentProfile inside a fenced ```json``` code block. Use snake-case for id. Include dependencies.subagents if delegation was observed.',
      'After the initial proposal, accept user feedback ("add capability X", "rename to Y", "change output to markdown") and re-output an UPDATED ```json``` block reflecting all changes.',
      'When the user says "save", "looks good", "ok" or similar, restate the FINAL profile in a clean ```json``` block.',
      'If the user provides additional history (a later user message saying "Updated original conversation history..."), use the new context but keep waiting for explicit instructions before changing the draft.',
    ],
    constraints: [
      'Do NOT auto-extract / auto-summarize / auto-propose on the first turn. The user must describe what agent they want first. If their first message is unclear, ask a clarifying question — never guess.',
      'Do NOT write files yourself. The renderer detects the ```json``` block and saves it when the user confirms.',
      'Always wrap the final profile in a fenced ```json ... ``` block — the renderer detects this format.',
      'capabilities should be 3-5 concrete behaviors derived from BOTH the conversation context AND the user description, not generic statements.',
      'id must be snake-case (lowercase letters / digits / _ / -). Do not use names starting and ending with __ (reserved for platform agents).',
      'If the original conversation used delegate_agent, MUST include those agent_ids in dependencies.subagents.',
    ],
    outputFormat:
      'Brief conversational responses; final profile (when ready) wrapped in ```json``` code block.',
  },
  knowledge: { files: [] },
  dependencies: {
    tools: [{ name: 'read', required: true }],
    mcpServers: [],
    skills: [],
    cli: [],
    // 不声明 subagents 也不声明 allowAnyBusinessSubagent → scope=[]
    // 持有 delegate_agent 工具但 listing 为空，自然不会委托。
  },
}

function buildAgentMcpRegistry(mcpServers: McpServerDependency[]): McpRegistry | null {
  if (mcpServers.length === 0) return null
  const registry = new McpRegistry()
  for (const dep of mcpServers) {
    const transport = dep.transport
    const config: MCPServerConfig = {
      id: dep.name,
      name: dep.name,
      type: transport.type === 'stdio' ? 'stdio' : 'http',
      command: transport.type === 'stdio' ? transport.command : undefined,
      args: transport.type === 'stdio' ? transport.args : undefined,
      url: transport.type === 'http' ? transport.url : undefined,
      enabled: true,
    }
    registry.addPendingConfig(config)
  }
  return registry
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
        const agentMcpRegistry = buildAgentMcpRegistry(profile.dependencies.mcpServers)
        const agentSkillRegistry = entry.dirPath
          ? SkillRegistry.fromDir(join(entry.dirPath, 'skills'))
          : new SkillRegistry()

        this.registerBusinessAgent(profile.id, {
          profile,
          source: entry.dirPath,
          mcpRegistry: agentMcpRegistry,
          skillRegistry: agentSkillRegistry,
        })
      }
    }

    // 平台 agent 装配。两个都接收 delegationRuntime；委托能力由 profile 字段
    // (allowAnyBusinessSubagent / subagents) 决定：
    //   - __chat__:        allowAnyBusinessSubagent=true → 可委托所有业务 agent
    //   - __crystallizer__: 无 subagents 也无 allowAnyBusinessSubagent → scope=[]
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
    //   - profile.dependencies.subagents 非空 → 可委托列表内 agent（受限 scope）
    //   - profile.dependencies.subagents 缺省 → scope=[]，工具持有但 listing 为空
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

  get isInitialized(): boolean {
    return this.platformChat !== null
  }
}
