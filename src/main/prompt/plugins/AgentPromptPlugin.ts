import type { CoreMessage } from 'ai'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'
import type { AgentManifest, AgentRole, AgentKnowledge, KnowledgeFileRef } from '@shared/types/agent'

export class AgentPromptPlugin implements PromptPlugin {
  name = 'AgentPromptPlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    if (!ctx.agent && !ctx.skillRegistry) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const messages: CoreMessage[] = []

    const agentPrompt = ctx.agent ? buildAgentPrompt(ctx.agent.role) : ''
    const knowledgeIndex = ctx.agent ? buildKnowledgeIndex(ctx.agent.knowledge) : ''
    const skillListing = buildSkillListing(ctx)

    const sections = [agentPrompt, knowledgeIndex, skillListing].filter(Boolean)
    const content = sections.join('\n\n')

    if (content) {
      messages.push({ role: 'system', content })
    }

    const fewShot = ctx.agent ? buildFewShot(ctx.agent.role) : []
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

function buildSkillListing(ctx: PipelineContext): string {
  if (!ctx.skillRegistry) return ''

  const descriptions = ctx.skillRegistry.listDescriptions()
  if (descriptions.length === 0) return ''

  const listing = descriptions.map(s => {
    const desc = s.description.length > MAX_SKILL_DESCRIPTION_CHARS
      ? s.description.slice(0, MAX_SKILL_DESCRIPTION_CHARS) + '...'
      : s.description
    return `- ${s.name}: ${desc}`
  }).join('\n')
  return `你有以下技能可用（需要时调用 skill 工具激活）：\n${listing}`
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
