// src/main/runtime/catalog.ts — 业务层：能力目录（能力架构方案 §3.2、§3.5）
//
// 目录是每轮取一次的快照：内置工具、启用的 MCP 服务器（带 slug 与引擎规格）、平台 skill、业务 agent
// 及其 Feature 工具、插件命令。版本是来源内容的哈希，来源不变版本就不变，agentFor 按它缓存。
// 来源由各方登记（B1）：Talor 核心 → Feature → 插件，按登记顺序汇总，同名条目先登记的胜出。
// select(profile) 按旧路径的语义算出一个 agent 这一轮的能力集合，只有两处不同：内置工具白名单
// 不再挡 MCP 与 Feature 工具（修 T5、T8）；allowAny 的委托目标不含自己。取不到的引用记入 missing。
//
// 允许依赖: agent-engine、electron-log、runtime/mcp-spec、@shared/types、agent/agent-manager（类型）、repos/mcp-server-repo、
//           skills/types、tools/registry、tools/types
// 禁止依赖: ipc/*、db/*

import log from 'electron-log'
import { type McpServerSpec } from 'agent-engine'
import { hashOf } from 'agent-engine/sdk'
import { BUILTIN_TOOL_NAMES, type AgentProfile } from '@shared/types/agent'
import type { AgentManager } from '../agent/agent-manager'
import { mcpServerRepo, type MCPServer } from '../repos/mcp-server-repo'
import type { ParsedSkill } from '../skills/types'
import { toolRegistry } from '../tools/registry'
import type { ToolDefinition, ToolMetadata } from '../tools/types'
import { mcpSlugs, toMcpSpec } from './mcp-spec'

/** 声明了内置工具白名单时始终给的只读工具（旧路径的 ALWAYS_AVAILABLE_TOOLS 中的内置部分）。 */
const ALWAYS_AVAILABLE = ['read', 'ls', 'glob', 'grep']

export interface CatalogAgent {
  profile: AgentProfile
  featureTools: ToolDefinition[]
}

/** 插件的斜杠命令。 */
export interface CatalogCommand {
  name: string
  description?: string
  content: string
  source: string
}

export interface CatalogSources {
  builtins(): ToolDefinition[]
  mcpServers(): MCPServer[]
  skills(): ParsedSkill[]
  /** 业务 agent（可委托），不含平台 agent。 */
  agents(): CatalogAgent[]
  /** 已带 slug 与规格的 MCP 条目（插件提供），与 `mcp_servers` 行区分。 */
  mcpEntries?(): McpCatalogEntry[]
  commands?(): CatalogCommand[]
}

/** 一个登记方提供的来源片段，每类可选。 */
export type CatalogContribution = Partial<CatalogSources>

export interface McpCatalogEntry {
  id: string
  name: string
  slug: string
  spec: McpServerSpec
}

export interface AgentCapabilities {
  builtins: ToolDefinition[]
  mcpServers: McpCatalogEntry[]
  skills: ParsedSkill[]
  delegates: AgentProfile[]
  featureTools: ToolDefinition[]
  /** profile 引用了但目录里取不到的名字。 */
  missing: { mcpServers: string[]; skills: string[]; subagents: string[] }
}

export interface CatalogSnapshot {
  readonly version: string
  readonly builtins: ToolDefinition[]
  readonly mcpServers: McpCatalogEntry[]
  readonly skills: ParsedSkill[]
  readonly agents: CatalogAgent[]
  readonly commands: CatalogCommand[]
  select(profile: AgentProfile): AgentCapabilities
}

export function isPlatformAgent(id: string): boolean {
  return id.startsWith('__')
}

const compare = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)

/** 启用且配置有效的服务器，带 slug 与引擎规格；预连接与目录共用，保证规格完全相同。 */
export function mcpCatalogEntries(servers: MCPServer[]): McpCatalogEntry[] {
  // slug 在全部服务器上算，启停一个服务器不改变其他服务器的前缀。
  const slugs = mcpSlugs(servers)
  return servers
    .filter((s) => s.enabled)
    .sort((a, b) => compare(a.created_at, b.created_at) || compare(a.id, b.id))
    .flatMap((s) => {
      const slug = slugs.get(s.id)!
      const spec = toMcpSpec(s, slug)
      return spec ? [{ id: s.id, name: s.name, slug, spec }] : []
    })
}

/** 按 names 的顺序取 key 相同的条目；取不到的名字记入 missing。 */
function pick<T>(items: T[], names: string[], key: (item: T) => string, missing: string[]): T[] {
  const byKey = new Map(items.map((item) => [key(item), item]))
  return names.flatMap((name) => {
    const item = byKey.get(name)
    if (item === undefined) missing.push(name)
    return item === undefined ? [] : [item]
  })
}

/** 按 key 去重，先出现的保留；丢弃的交给 onDrop。 */
function firstBy<T>(items: T[], key: (item: T) => string, onDrop?: (item: T) => void): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) {
      onDrop?.(item)
      return false
    }
    seen.add(k)
    return true
  })
}

export function catalogSnapshot(sources: CatalogSources): CatalogSnapshot {
  const builtinNames = new Set<string>(BUILTIN_TOOL_NAMES)
  const builtins = sources.builtins().filter((t) => builtinNames.has(t.name))
  const mcpServers = firstBy(
    [...mcpCatalogEntries(sources.mcpServers()), ...(sources.mcpEntries?.() ?? [])],
    (e) => e.slug,
    (e) => log.warn(`[catalog] MCP 前缀 ${e.slug} 重复，丢弃 ${e.name}`),
  )
  const skills = firstBy(sources.skills(), (s) => s.metadata.name)
  const agents = firstBy(sources.agents(), (a) => a.profile.id)
  const commands = firstBy(sources.commands?.() ?? [], (c) => c.name)
  const version = hashOf({
    builtins: builtins.map((t) => t.name),
    mcpServers,
    skills: skills.map((s) => ({
      name: s.metadata.name,
      metadata: s.metadata,
      content: s.content,
      filePath: s.filePath,
    })),
    agents: agents.map((a) => ({
      profile: a.profile,
      featureTools: a.featureTools.map((t) => t.name),
    })),
    commands: commands.map((c) => ({ name: c.name, content: c.content })),
  })

  function select(profile: AgentProfile): AgentCapabilities {
    const platform = isPlatformAgent(profile.id)
    const missing: AgentCapabilities['missing'] = { mcpServers: [], skills: [], subagents: [] }

    const declared = profile.tools ?? []
    const allowed = new Set<string>([...declared, ...ALWAYS_AVAILABLE])
    const selectedBuiltins =
      declared.length === 0 ? builtins : builtins.filter((t) => allowed.has(t.name))

    const serverNames = profile.mcpServers ?? []
    const selectedServers =
      platform || serverNames.length === 0
        ? mcpServers
        : pick(mcpServers, serverNames, (e) => e.name, missing.mcpServers)

    const selectedSkills = platform
      ? skills
      : pick(skills, profile.skills ?? [], (s) => s.metadata.name, missing.skills)

    const others = agents.filter((a) => a.profile.id !== profile.id).map((a) => a.profile)
    const delegates =
      profile.subagents?.allowAny === true
        ? others
        : pick(
            others,
            (profile.subagents?.ids ?? []).map((ref) => ref.id),
            (p) => p.id,
            missing.subagents,
          )

    const featureTools = agents.find((a) => a.profile.id === profile.id)?.featureTools ?? []

    return {
      builtins: selectedBuiltins,
      mcpServers: selectedServers,
      skills: selectedSkills,
      delegates,
      featureTools,
      missing,
    }
  }

  return { version, builtins, mcpServers, skills, agents, commands, select }
}

/**
 * Talor 核心的来源：内置工具注册表、`mcp_servers` 表、平台 skill 注册表、AgentManager 的业务 agent。
 * 当前由 Feature 承载的 agent 由 Feature 自己登记，这里排除。
 */
export function talorCatalogSources(agentManager: AgentManager): CatalogSources {
  return {
    builtins: () => toolRegistry.listAll(),
    mcpServers: () => mcpServerRepo.list(),
    skills: () => agentManager.getPlatformSkillRegistry()?.listAll() ?? [],
    agents: () => {
      const featureIds = agentManager.featureAgentIds()
      return agentManager.listBusinessAgentIds().flatMap((id) => {
        if (featureIds.has(id)) return []
        const agent = agentManager.getAgent(id)
        return agent ? [{ profile: agent.profile, featureTools: [] }] : []
      })
    },
  }
}

export interface CatalogRegistry {
  /** 同 id 再登记替换旧内容（移到末尾）；返回的函数注销该 id。 */
  register(id: string, contribution: CatalogContribution): () => void
  sources(): CatalogSources
}

export function createCatalogRegistry(): CatalogRegistry {
  const entries = new Map<string, CatalogContribution>()
  const all = <T>(pick: (c: CatalogContribution) => (() => T[]) | undefined): T[] =>
    [...entries.values()].flatMap((c) => pick(c)?.() ?? [])
  return {
    register(id, contribution) {
      entries.delete(id)
      entries.set(id, contribution)
      return () => {
        entries.delete(id)
      }
    },
    sources: () => ({
      builtins: () => all((c) => c.builtins),
      mcpServers: () => all((c) => c.mcpServers),
      mcpEntries: () => all((c) => c.mcpEntries),
      skills: () => all((c) => c.skills),
      agents: () => all((c) => c.agents),
      commands: () => all((c) => c.commands),
    }),
  }
}

/**
 * 插件斜杠命令展开：`/<名字> <参数>`。正文含 `$ARGUMENTS` 时替换为参数；否则有参数就接在正文后、
 * 隔一个空行。不是已知命令（或不以 `/` 开头）时返回 undefined。
 */
export function expandCommand(text: string, commands: CatalogCommand[]): string | undefined {
  if (!text.startsWith('/')) return undefined
  const rest = text.slice(1)
  const i = rest.search(/\s/)
  const name = i >= 0 ? rest.slice(0, i) : rest
  const args = i >= 0 ? rest.slice(i + 1).trim() : ''
  const cmd = commands.find((c) => c.name === name)
  if (!cmd) return undefined
  const result = cmd.content.includes('$ARGUMENTS')
    ? cmd.content.replaceAll('$ARGUMENTS', args)
    : args
      ? `${cmd.content}\n\n${args}`
      : cmd.content
  return result.trimEnd()
}

/** 全局登记表：Talor 核心、Feature、插件在启动时登记。 */
export const catalogRegistry: CatalogRegistry = createCatalogRegistry()

export function currentCatalog(): CatalogSnapshot {
  return catalogSnapshot(catalogRegistry.sources())
}

/**
 * Feature 的登记端口：Feature 的 agent 只在当前仍由 Feature 承载时进目录（被用户版覆盖、替换或注销后
 * 由核心来源给出或不再出现），与旧路径 AgentManager 里实际的 agent 一致。
 */
export function featureSourcePort(
  registry: CatalogRegistry,
  agentManager: AgentManager,
): (id: string, contribution: CatalogContribution) => void {
  return (id, contribution) => {
    registry.register(id, {
      ...contribution,
      agents: () =>
        (contribution.agents?.() ?? []).filter((a) =>
          agentManager.featureAgentIds().has(a.profile.id),
        ),
    })
  }
}

/** 引擎工具在界面上的说明（与引擎的工具同名）。 */
const ENGINE_TOOL_META = {
  search: {
    name: 'search_tool',
    description: '按关键词查找可用的工具；找到的工具下一步可用。',
    parameters: { type: 'object' },
  },
  skill: {
    name: 'activate_skill',
    description: '读取 skill 的完整说明',
    parameters: { type: 'object' },
  },
  delegate: {
    name: 'delegate',
    description: '把子任务交给可委托的 agent',
    parameters: { type: 'object' },
  },
} satisfies Record<string, ToolMetadata>

/**
 * 引擎路径给界面的工具列表（修 T7）：只来自目录为该 agent 选出的能力。MCP 工具取旧注册表里已连接服务器的
 * 工具列表（引擎宿主不建连读不到），按服务器名过滤，`provider` 为服务器名；其余工具不带 `provider`。
 */
export function engineToolsView(caps: AgentCapabilities, mcpTools: ToolMetadata[]): ToolMetadata[] {
  const meta = (def: ToolDefinition): ToolMetadata => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    ...(def.riskLevel ? { riskLevel: def.riskLevel } : {}),
  })
  const list = [...caps.builtins.map(meta), ...caps.featureTools.map(meta)]
  if (caps.mcpServers.length > 0) list.push({ ...ENGINE_TOOL_META.search })
  if (caps.skills.length > 0) list.push({ ...ENGINE_TOOL_META.skill })
  if (caps.delegates.length > 0) list.push({ ...ENGINE_TOOL_META.delegate })
  const servers = new Set(caps.mcpServers.map((e) => e.name))
  list.push(...mcpTools.filter((t) => t.provider !== undefined && servers.has(t.provider)))
  return list
}
