// src/main/prompt/plugins/AgentPromptPlugin.ts — 业务层：Agent prompt 拼装
//
// 从 Agent 实例的 profile + skillRegistry 构建 prompt 层（角色/知识/few-shot/skill 列表）。
//
// 允许依赖：prompt/*、shared/*
// 禁止依赖：ipc/*

import type { CoreMessage } from 'ai'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { AgentProfile, AgentRole, AgentKnowledge, KnowledgeFileRef } from '@shared/types/agent'
import type { SkillRegistry } from '../../skills/registry'

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const messages: CoreMessage[] = []
    const { profile, skillRegistry } = ctx.agent

    const identityHeader = buildIdentityHeader(profile)
    const agentPrompt = buildAgentPrompt(profile.role)
    const knowledgeIndex = buildKnowledgeIndex(profile.knowledge)
    const skillListing = buildSkillListing(skillRegistry)

    const sections = [identityHeader, agentPrompt, knowledgeIndex, skillListing].filter(Boolean)
    const content = sections.join('\n\n')

    if (content) {
      messages.push({ role: 'system', content })
    }

    const fewShot = buildFewShot(profile.role)
    messages.push(...fewShot)

    const tokenEstimate = Math.ceil(content.length / 3) + fewShot.length * 50

    return { messages, tools: [], tokenEstimate }
  }
}

/**
 * 身份头 —— 强制以"当前 agent"为答复主体，压制 session 历史中残留的其他 agent 人设。
 *
 * 场景：用户在同一 session 切换过 agent（business → __chat__），上一个 agent 的
 * assistant message 会留在 messages 历史里。LLM 重建 prompt 时看到自己上一句"我是
 * 飞书助手"，会自然延续此身份，导致用户问"你是谁"得到错误答案。
 *
 * 此条目放在 system prompt 的 agent 段最前面，明确告诉模型：
 *   - 当前身份是谁
 *   - 历史中若有其他 agent 的回答，那是切换前的别人，不是当前的你
 *
 * 设计原则参考 patterns §P4：把"模型必须如此"的不变量写进 prompt，但仍保留
 * 历史 messages 的完整性（不删历史，靠 LLM 服从约束）。
 */
function buildIdentityHeader(profile: AgentProfile): string {
  const lines: string[] = []
  lines.push(`# Your identity`)
  lines.push(`You are "${profile.name}" (agent_id: ${profile.id}).`)
  if (profile.description) {
    lines.push(profile.description)
  }
  lines.push('')
  lines.push(
    `IMPORTANT: This session may contain assistant messages from previous agents ` +
      `(the user may have switched agents within this session). Those past responses ` +
      `do NOT define your current identity. From this turn onward, always answer as ` +
      `"${profile.name}" with the role and capabilities described below. If the user ` +
      `asks "who are you", answer based on this profile, not on past assistant messages.`,
  )
  return lines.join('\n')
}

function buildAgentPrompt(role: AgentRole): string {
  const parts: string[] = []

  if (role.capabilities.length > 0) {
    parts.push(`Your core capabilities:\n${role.capabilities.map((c) => `- ${c}`).join('\n')}`)
  }

  if (role.constraints && role.constraints.length > 0) {
    parts.push(`Your behavioral constraints:\n${role.constraints.map((c) => `- ${c}`).join('\n')}`)
  }

  if (role.outputFormat) {
    parts.push(`Your output format: ${role.outputFormat}`)
  }

  if (role.personality) {
    parts.push(`Your style: ${role.personality}`)
  }

  return parts.join('\n\n')
}

function buildKnowledgeIndex(knowledge: AgentKnowledge): string {
  if (!knowledge.files || knowledge.files.length === 0) return ''

  const lines = knowledge.files.map((f: KnowledgeFileRef) => `- ${f.path}: ${f.description}`)
  return `Available knowledge files (load with the read tool when needed):\n${lines.join('\n')}`
}

const MAX_SKILL_DESCRIPTION_CHARS = 1536

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function buildSkillListing(skillRegistry: SkillRegistry): string {
  if (skillRegistry.isEmpty()) return ''

  const skills = skillRegistry.listAll()
  if (skills.length === 0) return ''

  const listing = skills
    .map((s) => {
      const desc = truncate(s.metadata.description, MAX_SKILL_DESCRIPTION_CHARS)
      const whenToUse = s.metadata.when_to_use
      const whenLine = whenToUse
        ? `\n  When to use: ${truncate(whenToUse, MAX_SKILL_DESCRIPTION_CHARS)}`
        : ''
      return `- ${s.metadata.name}\n  ${desc}${whenLine}`
    })
    .join('\n\n')

  return `## Available Skills

Each entry is an encapsulated capability. Use via \`skill\` tool (see Task Routing). The "When to use" line lists trigger phrases and example requests — match the user's input against these to pick a skill.

${listing}`
}

function buildFewShot(role: AgentRole): CoreMessage[] {
  if (!role.sampleConversations || role.sampleConversations.length === 0) return []

  const messages: CoreMessage[] = []
  for (const conv of role.sampleConversations) {
    for (const msg of conv.messages) {
      messages.push({ role: msg.role, content: msg.content })
    }
  }
  return messages
}
