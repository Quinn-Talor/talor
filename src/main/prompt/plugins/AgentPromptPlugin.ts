// src/main/prompt/plugins/AgentPromptPlugin.ts — 业务层：Agent prompt 拼装
//
// 从 Agent 实例的 profile + skillRegistry 构建 prompt 层（角色/知识/few-shot/skill 列表）。
//
// 允许依赖：prompt/*、shared/*
// 禁止依赖：ipc/*

import type { CoreMessage } from 'ai'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { AgentRole, AgentKnowledge, KnowledgeFileRef } from '@shared/types/agent'
import type { SkillRegistry } from '../../skills/registry'

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const messages: CoreMessage[] = []
    const { profile, skillRegistry } = ctx.agent

    const agentPrompt = buildAgentPrompt(profile.role)
    const knowledgeIndex = buildKnowledgeIndex(profile.knowledge)
    const skillListing = buildSkillListing(skillRegistry)

    const sections = [agentPrompt, knowledgeIndex, skillListing].filter(Boolean)
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

function buildAgentPrompt(role: AgentRole): string {
  const parts: string[] = []

  if (role.capabilities.length > 0) {
    parts.push(`你的核心能力：\n${role.capabilities.map(c => `- ${c}`).join('\n')}`)
  }

  if (role.constraints && role.constraints.length > 0) {
    parts.push(`你的行为约束：\n${role.constraints.map(c => `- ${c}`).join('\n')}`)
  }

  if (role.outputFormat) {
    parts.push(`你的输出格式：${role.outputFormat}`)
  }

  if (role.personality) {
    parts.push(`你的风格：${role.personality}`)
  }

  return parts.join('\n\n')
}

function buildKnowledgeIndex(knowledge: AgentKnowledge): string {
  if (!knowledge.files || knowledge.files.length === 0) return ''

  const lines = knowledge.files.map(
    (f: KnowledgeFileRef) => `- ${f.path}：${f.description}`,
  )
  return `可用知识文件（需要时通过 read 工具加载）：\n${lines.join('\n')}`
}

const MAX_SKILL_DESCRIPTION_CHARS = 1536

function buildSkillListing(skillRegistry: SkillRegistry): string {
  if (skillRegistry.isEmpty()) return ''

  const descriptions = skillRegistry.listDescriptions()
  if (descriptions.length === 0) return ''

  const listing = descriptions.map(s => {
    const desc = s.description.length > MAX_SKILL_DESCRIPTION_CHARS
      ? s.description.slice(0, MAX_SKILL_DESCRIPTION_CHARS) + '...'
      : s.description
    return `- ${s.name}: ${desc}`
  }).join('\n')

  return `## 可用技能（Skills）

以下是技能名称，**不是工具名，不能直接调用**。需要使用某个技能时，必须先用 \`skill\` 工具激活，例如：
  skill({"name": "lark-doc"})

激活后按返回的指令执行操作。已激活过的技能无需重复激活。

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
