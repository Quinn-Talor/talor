// src/main/prompt/runtime-context.ts — 业务层: 模板渲染上下文 (极简 schema)
//
// 把 Agent 实体属性 → TemplateContext (供 render.ts 消费)。
//
// 允许依赖: agent/*、shared/*
// 禁止依赖: ipc/*

import type { Agent } from '../agent/agent'

export interface TemplateContext {
  // ── 顶层标识 (模板直接读) ──
  name: string
  description: string
  agentPrompt: string

  // ── Critical role constraints (platform agent 内置) ──
  criticalRoleConstraints: string[]

  // ── Skills listing (从 SkillRegistry 渲染好的字符串,空则段省略) ──
  hasSkillListing: boolean
  skillListing: string
}

export function buildRuntimeContext(agent: Agent): TemplateContext {
  const p = agent.profile

  return {
    name: p.name,
    description: p.description,
    agentPrompt: p.agentPrompt,

    criticalRoleConstraints: buildCriticalRoleConstraints(p.id),

    skillListing: renderSkillListing(agent.skillRegistry),
    hasSkillListing: !agent.skillRegistry.isEmpty() && agent.skillRegistry.listAll().length > 0,
  }
}

function buildCriticalRoleConstraints(agentId: string): string[] {
  if (agentId === '__chat__') {
    return [
      'You may delegate sub-tasks via delegate_agent when specialized agents fit better than direct work.',
    ]
  }
  return []
}

const MAX_SKILL_DESCRIPTION_CHARS = 1536

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function renderSkillListing(skillRegistry: {
  isEmpty: () => boolean
  listAll: () => Array<{ metadata: { name: string; description: string; when_to_use?: string } }>
}): string {
  if (skillRegistry.isEmpty()) return ''
  const skills = skillRegistry.listAll()
  if (skills.length === 0) return ''

  const listing = skills
    .map((s) => {
      const desc = truncate(s.metadata.description, MAX_SKILL_DESCRIPTION_CHARS)
      const whenLine = s.metadata.when_to_use
        ? `\n  When to use: ${truncate(s.metadata.when_to_use, MAX_SKILL_DESCRIPTION_CHARS)}`
        : ''
      return `- ${s.metadata.name}\n  ${desc}${whenLine}`
    })
    .join('\n\n')

  return `## Available Skills\n\nEach entry is an encapsulated capability. Use via \`skill\` tool. The "When to use" line lists trigger phrases — match the user's input against these to pick a skill.\n\n${listing}`
}
