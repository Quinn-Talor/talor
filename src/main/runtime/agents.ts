// src/main/runtime/agents.ts — 业务层：AgentProfile 映射为 agent-engine 的 Agent
//
// 能力为能力目录按 profile 选出的全部内容（选择规则见 runtime/catalog.ts），依次为：内置工具、意图工具
// （intents，取代旧路径的 talor 块）、每个 MCP
// 服务器一项 mcp 能力（引擎缺省延后呈现，经 search_tool 展开）、每个 skill 一项 skill 能力、该 agent 的
// Feature 工具、每个委托目标一项 subagent 能力（深度 < 3 时；只有根 agent 的子 agent 设时长预算）。指令为 agentPrompt 原文
// （__chat__ 的见 agent/agent-manager.ts 的 CHAT_PROFILE）。
// 按 profile 与目录版本缓存：来源变化后新开始的运行用新的 Agent，Agent 定义之后不再修改。
//
// 允许依赖: agent-engine、runtime/catalog（类型）、runtime/tools、skills/types、@shared/types
// 禁止依赖: ipc/*、repos/*、db/*

import { dirname, resolve } from 'path'
import log from 'electron-log'
import {
  defineAgent,
  intents,
  mcp,
  skill,
  subagent,
  tools,
  type Agent,
  type Capability,
  type SkillPackage,
} from '@talor/agent-engine'
import { hashOf } from '@talor/agent-engine/sdk'
import type { AgentProfile } from '@shared/types/agent'
import type { ParsedSkill } from '../skills/types'
import type { CatalogSnapshot } from './catalog'
import { toEngineTool } from './tools'

/** 引擎的 Agent id 格式（agent-engine `defineAgent`）。 */
const ENGINE_AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/

/** 委托链深度上限。 */
export const MAX_DELEGATION_DEPTH = 3
/** 根 agent 的子运行时长缺省值，与委托配置 executionTimeoutMs 的默认值相同。 */
export const DEFAULT_CHILD_TIMEOUT_MS = 1_800_000
const DELEGATE_DESCRIPTION_CHARS = 200

const cache = new Map<string, Agent>()
/** 引擎 Agent id → profile 名字（审批请求标注子 agent 用）。 */
const names = new Map<string, string>()

/** profile id 不合引擎格式时（例如平台 agent `__chat__`）加前缀，仍不合格时用哈希。 */
export function engineAgentId(profileId: string): string {
  if (ENGINE_AGENT_ID.test(profileId)) return profileId
  const prefixed = `talor${profileId}`
  if (ENGINE_AGENT_ID.test(prefixed)) return prefixed
  return `talor-${hashOf(profileId).slice(0, 16)}`
}

/** SKILL.md 正文里的相对链接改为以 SKILL.md 所在目录为基准的绝对路径；http(s) 与锚点链接不变。 */
export function resolveRelativePaths(content: string, skillMdPath: string): string {
  const skillDir = dirname(skillMdPath)
  return content.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
      return `[${text}](${href})`
    }
    return `[${text}](${resolve(skillDir, href)})`
  })
}

/** SKILL.md → 引擎 skill 包：描述接上使用时机，正文里的相对链接改为绝对路径。 */
export function skillPackageOf(parsed: ParsedSkill): SkillPackage {
  const { name, description: base, when_to_use: whenToUse } = parsed.metadata
  const description = whenToUse ? `${base}。使用时机：${whenToUse}` : base
  const content = resolveRelativePaths(parsed.content, parsed.filePath)
  return {
    name,
    description,
    content,
    hash: hashOf({ name, description, content }),
    dir: dirname(parsed.filePath),
  }
}

/** 委托目标的一句话说明：名字加描述的第一个非空行，截到 200 个字符。 */
export function delegateDescriptionOf(profile: AgentProfile): string {
  const firstLine =
    profile.description
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line) ?? ''
  const text = firstLine ? `${profile.name}：${firstLine}` : profile.name
  return text.slice(0, DELEGATE_DESCRIPTION_CHARS)
}

export function agentNameOf(engineId: string): string | undefined {
  return names.get(engineId)
}

/** 视图里保留原图的工具结果图片张数。 */
const KEEP_RECENT_IMAGES = 4

export function agentFor(
  profile: AgentProfile,
  snapshot: CatalogSnapshot,
  opts: { depth?: number; childTimeoutMs?: number } = {},
): Agent {
  const depth = opts.depth ?? 0
  const childTimeoutMs = opts.childTimeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS
  names.set(engineAgentId(profile.id), profile.name)
  const key = hashOf({
    profile,
    version: snapshot.version,
    depth,
    childTimeoutMs: depth === 0 ? childTimeoutMs : null,
  })
  const cached = cache.get(key)
  if (cached) return cached

  const caps = snapshot.select(profile)
  const missing = Object.entries(caps.missing).filter(([, names]) => names.length > 0)
  if (missing.length > 0) {
    log.warn(
      `[agents] ${profile.id} 引用了不存在的能力`,
      missing.map(([kind, names]) => `${kind}=${names.join(',')}`).join(' '),
    )
  }

  const capabilities: Capability[] = []
  if (caps.builtins.length > 0) {
    capabilities.push(tools(caps.builtins.map(toEngineTool), { id: 'builtin' }))
  }
  // 意图工具（ask_user / propose / report_blocked）取代旧路径的 talor 块（C2）；完成时直接答复
  capabilities.push(intents())
  capabilities.push(...caps.mcpServers.map((entry) => mcp(entry.spec)))
  capabilities.push(...caps.skills.map((parsed) => skill(skillPackageOf(parsed))))
  if (caps.featureTools.length > 0) {
    capabilities.push(tools(caps.featureTools.map(toEngineTool), { id: `feature:${profile.id}` }))
  }
  // 委托目标：子 agent 按深度加 1 装配，第 3 层不再委托；环由引擎在调用时拒绝（SPAWN_CYCLE）
  if (depth < MAX_DELEGATION_DEPTH) {
    for (const target of caps.delegates) {
      const child = agentFor(target, snapshot, { depth: depth + 1 })
      capabilities.push(
        subagent(child, {
          name: target.id,
          description: delegateDescriptionOf(target),
          ...(depth === 0 ? { budget: { maxTotalMs: childTimeoutMs } } : {}),
        }),
      )
    }
  }

  const agent = defineAgent({
    id: engineAgentId(profile.id),
    instructions: [{ role: 'system', parts: [{ type: 'text', text: profile.agentPrompt }] }],
    capabilities,
    // 读图 / 浏览器截图会让工具结果里的图片越积越多：视图只留最近几张，运行记录不变
    model: { settings: { keepRecentImages: KEEP_RECENT_IMAGES } },
  })
  cache.set(key, agent)
  return agent
}
