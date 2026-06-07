// src/main/agent/dependency-checker.ts — 业务层：Agent 依赖检查 (Schema 2.0 引用化)
//
// Step 2: Skill 检查     → 平台 ~/.claude/skills/<name>/SKILL.md 存在性
// Step 3: CLI 检查       → command -v 校验存在(不自动安装)
// Step 4: MCP Server     → mcpServerRepo lookup + envVar 配置检查
// Step 5: Tool 白名单    → profile.tools 全是合法 builtin name
// Step 5b: Subagent      → profile.subagents.ids 已注册
// Step 6: Config         → 扫描 {{变量}} + mcp envVar
// Step 7: References     → profile.references[].path 文件存在
// Step 8: 汇总
//
// 允许依赖：agent/*、shared/*、repos/*、skills/*、fs、child_process
// 禁止依赖：ipc/*

import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import type { AgentProfile, DependencyCheckResult, DependencyStepResult } from '@shared/types/agent'
import { extractSkillCliBins } from '../skills/metadata-extractor'
import { mcpServerRepo } from '../repos/mcp-server-repo'

const PLATFORM_SKILLS_DIR = join(homedir(), '.claude', 'skills')

export function checkDependencies(
  profile: AgentProfile,
  dirPath: string,
  opts?: {
    accountValues?: Map<string, string>
    builtinToolNames?: Set<string>
    /**
     * 已注册业务 agent_id 集合（用于校验 collaboration.subagents）。
     * 不传时跳过 subagent 检查。
     */
    registeredBusinessAgents?: Set<string>
  },
): DependencyCheckResult {
  const steps: DependencyStepResult[] = []
  const accountValues = opts?.accountValues ?? new Map<string, string>()
  const builtinToolNames =
    opts?.builtinToolNames ??
    new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'skill'])

  const skills = profile.skills ?? []
  const cli = profile.cli ?? []
  const mcpNames = profile.mcpServers ?? []
  const tools = profile.tools ?? []
  const subagentIds = profile.subagents?.ids ?? []
  const refs = profile.references ?? []

  // Step 2: Skill 检查 — 平台路径
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
      message: `缺少 Skill: ${missingSkills.join(', ')}(在 ~/.claude/skills/ 下未找到)`,
      details: missingSkills,
    })
  } else {
    steps.push({ step: 'skill', status: 'pass' })
  }

  // Step 3: CLI 仅校验存在(不自动安装)— 合并显式 cli 声明 + skill frontmatter 抽取的 bin
  const skillCliBins = extractSkillCliBins(PLATFORM_SKILLS_DIR)
  const allCliCommands = [...new Set([...cli, ...skillCliBins])]

  const missingCli: string[] = []
  for (const command of allCliCommands) {
    try {
      execSync(`command -v ${command}`, { stdio: 'pipe', timeout: 3000 })
    } catch {
      missingCli.push(command)
    }
  }

  if (missingCli.length > 0) {
    steps.push({
      step: 'cli',
      status: 'missing',
      message: `缺少 CLI: ${missingCli.join(', ')}(请手动安装到 PATH)`,
      details: missingCli,
    })
  } else {
    steps.push({ step: 'cli', status: 'pass' })
  }

  // Step 4: MCP Server 检查 — 按 name lookup mcp_servers DB,校验 envVar 已配
  const mcpIssues: string[] = []
  for (const mcpName of mcpNames) {
    const server = mcpServerRepo.getByName(mcpName)
    if (!server) {
      mcpIssues.push(`${mcpName}: 未在 Settings → MCP Servers 配置`)
      continue
    }
    // HTTP transport: auth.envVar 引用 Account
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

  // Step 5: Tool 白名单校验
  const missingTools: string[] = []
  for (const toolName of tools) {
    if (!builtinToolNames.has(toolName)) {
      missingTools.push(toolName)
    }
  }

  if (missingTools.length > 0) {
    steps.push({
      step: 'tool',
      status: 'missing',
      message: `缺少 Tool: ${missingTools.join(', ')}`,
      details: missingTools,
    })
  } else {
    steps.push({ step: 'tool', status: 'pass' })
  }

  // Step 5b: Subagent 依赖检查
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

  // Step 6: Config 检查 — 扫描 agent.json 内 {{变量}} 模板 + 累加 MCP envVar
  const missingVars: string[] = []
  const configStr = JSON.stringify(profile)
  const varMatches = configStr.matchAll(/\{\{(\w+)\}\}/g)
  for (const match of varMatches) {
    if (!accountValues.has(match[1])) {
      missingVars.push(match[1])
    }
  }
  // 累加 MCP envVar(来自 DB,因为 schema 引用化后 agent.json 不含 transport)
  for (const mcpName of mcpNames) {
    const server = mcpServerRepo.getByName(mcpName)
    if (!server) continue
    if (server.type === 'http' && server.auth?.type === 'bearer' && server.auth.token) {
      if (!accountValues.has(server.auth.token) && !missingVars.includes(server.auth.token)) {
        missingVars.push(server.auth.token)
      }
    }
  }

  if (missingVars.length > 0) {
    steps.push({
      step: 'config',
      status: 'missing',
      message: `未配置变量: ${missingVars.join(', ')}`,
      details: missingVars,
    })
  } else {
    steps.push({ step: 'config', status: 'pass' })
  }

  // Step 7: References 检查
  const missingRefs: string[] = []
  for (const r of refs) {
    const absPath = join(dirPath, r.path)
    if (!existsSync(absPath)) {
      missingRefs.push(r.path)
    }
  }

  if (missingRefs.length > 0) {
    steps.push({
      step: 'references',
      status: 'missing',
      message: `缺少引用文件: ${missingRefs.join(', ')}`,
      details: missingRefs,
    })
  } else {
    steps.push({ step: 'references', status: 'pass' })
  }

  // Step 8: 汇总
  const passed = steps.every((s) => s.status === 'pass')
  steps.push({ step: 'complete', status: passed ? 'pass' : 'fail' })

  return { passed, steps }
}
