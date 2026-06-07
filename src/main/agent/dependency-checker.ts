// src/main/agent/dependency-checker.ts — 业务层:Agent 依赖检查(极简 3 步)
//
// step skill:    检查平台 ~/.talor/skills/<name>/SKILL.md 存在
// step mcpServer: mcp_servers DB lookup + envVar 配置(若有)
// step subagent: profile.subagents.ids 中 required 的 agent 已注册
// step complete: 汇总
//
// 已删:
//   - step minAppVersion / version (无 migration,版本无意义)
//   - step cli (cli 字段已删,改由 bash + agentPrompt 自然描述)
//   - step tool (validator rule 5 已校验 builtin name)
//   - step config ({{var}} 模板系统死了)
//   - step references (字段已删,LLM 想用本地文件直接 read agent 目录)
//
// 允许依赖: agent/*、shared/*、repos/*、fs
// 禁止依赖: ipc/*

import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentProfile, DependencyCheckResult, DependencyStepResult } from '@shared/types/agent'
import { mcpServerRepo } from '../repos/mcp-server-repo'

const PLATFORM_SKILLS_DIR = join(homedir(), '.talor', 'skills')

export function checkDependencies(
  profile: AgentProfile,
  _dirPath: string,
  opts?: {
    accountValues?: Map<string, string>
    /**
     * 已注册业务 agent_id 集合(用于校验 subagents.ids)。不传时跳过 subagent 检查。
     */
    registeredBusinessAgents?: Set<string>
  },
): DependencyCheckResult {
  const steps: DependencyStepResult[] = []
  const accountValues = opts?.accountValues ?? new Map<string, string>()

  const skills = profile.skills ?? []
  const mcpNames = profile.mcpServers ?? []
  const subagentIds = profile.subagents?.ids ?? []

  // ── step skill: 平台路径存在性 ──
  const missingSkills: string[] = []
  for (const skillName of skills) {
    const skillPath = join(PLATFORM_SKILLS_DIR, skillName, 'SKILL.md')
    if (!existsSync(skillPath)) {
      missingSkills.push(skillName)
    }
  }
  if (missingSkills.length > 0) {
    steps.push({
      step: 'skill',
      status: 'missing',
      message: `缺少 Skill: ${missingSkills.join(', ')}(在 ~/.talor/skills/ 下未找到)`,
      details: missingSkills,
    })
  } else {
    steps.push({ step: 'skill', status: 'pass' })
  }

  // ── step mcpServer: DB lookup + envVar ──
  const mcpIssues: string[] = []
  for (const mcpName of mcpNames) {
    const server = mcpServerRepo.getByName(mcpName)
    if (!server) {
      mcpIssues.push(`${mcpName}: 未在 Settings → MCP Servers 配置`)
      continue
    }
    if (server.type === 'http' && server.auth?.type === 'bearer' && server.auth.token) {
      if (!accountValues.has(server.auth.token)) {
        mcpIssues.push(`${mcpName}: 需要配置 ${server.auth.token} → 前往账户管理`)
      }
    }
  }
  if (mcpIssues.length > 0) {
    steps.push({
      step: 'mcpServer',
      status: 'missing',
      message: mcpIssues.join('; '),
      details: mcpIssues,
    })
  } else {
    steps.push({ step: 'mcpServer', status: 'pass' })
  }

  // ── step subagent: required subagent 已注册 ──
  if (opts?.registeredBusinessAgents) {
    const missingSubagents: string[] = []
    for (const ref of subagentIds) {
      if (ref.required && !opts.registeredBusinessAgents.has(ref.id)) {
        missingSubagents.push(ref.id)
      }
    }
    if (missingSubagents.length > 0) {
      steps.push({
        step: 'subagent',
        status: 'missing',
        message: `Required subagents not installed or disabled: ${missingSubagents.join(', ')}`,
        details: missingSubagents,
      })
    } else {
      steps.push({ step: 'subagent', status: 'pass' })
    }
  } else {
    steps.push({ step: 'subagent', status: 'pass' })
  }

  // 汇总
  const passed = steps.every((s) => s.status === 'pass')
  steps.push({ step: 'complete', status: passed ? 'pass' : 'fail' })

  return { passed, steps }
}
