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

export interface PlatformAgentDeps {
  builtinRegistry: BuiltinToolRegistry
  mcpRegistry: McpToolSource
  skillRegistry: SkillRegistry
  agentsDir?: string
}

const CHAT_PROFILE: AgentProfile = {
  id: '__chat__',
  name: 'Talor',
  description: 'Platform default agent',
  version: '0.1.0',
  role: { capabilities: [], outputFormat: '' },
  knowledge: { files: [] },
  dependencies: { tools: [], mcpServers: [], skills: [], cli: [] },
}

const CRYSTALLIZER_PROFILE: AgentProfile = {
  id: '__crystallizer__',
  name: 'Crystallizer',
  description: 'Analyze conversation history and guide user to create an Agent',
  version: '0.1.0',
  role: {
    capabilities: [
      'Analyze the tools and workflow used in the conversation history.',
      "Guide the user through defining an agent's role and capabilities.",
      'Draft an agent.json specification.',
    ],
    constraints: [
      'Do not write any files until the user confirms.',
      'Do not modify the original session data.',
    ],
    outputFormat: 'Conversational guidance, ending with a final agent.json document.',
  },
  knowledge: { files: [] },
  dependencies: {
    tools: [{ name: 'read', required: true }],
    mcpServers: [],
    skills: [],
    cli: [],
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

    this.platformChat = new Agent({
      profile: CHAT_PROFILE,
      source: null,
      builtinRegistry: deps.builtinRegistry,
      mcpRegistry: deps.mcpRegistry,
      skillRegistry: deps.skillRegistry,
    })

    this.platformCrystallizer = new Agent({
      profile: CRYSTALLIZER_PROFILE,
      source: null,
      builtinRegistry: deps.builtinRegistry,
      mcpRegistry: deps.mcpRegistry,
      skillRegistry: deps.skillRegistry,
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

  registerBusinessAgent(agentId: string, opts: Omit<AgentOptions, 'builtinRegistry'>): Agent {
    if (!this.deps) throw new Error('AgentManager not initialized')

    const existing = this.businessAgents.get(agentId)
    if (existing) {
      log.info('[AgentManager] Replacing existing business agent:', agentId)
    }

    const agent = new Agent({
      ...opts,
      builtinRegistry: this.deps.builtinRegistry,
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
