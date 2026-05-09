// src/main/agent/dependency-checker.ts — 业务层：Agent 依赖检查 8 步链 (Schema 1.0)
//
// Step 1: minAppVersion  → semver 比较 (从 profile.identity.minAppVersion)
// Step 2: Skill 安装     → installSkills (从 profile.method.skills)
// Step 3: CLI 自动安装   → checkCommand (从 profile.method.cli)
// Step 4: MCP Server     → 安装包 (从 profile.method.mcpServers)
// Step 5: Tool 白名单校验 (从 profile.method.tools，过滤 !disabled)
// Step 5b: Subagent 依赖 (从 profile.method.collaboration?.subagents)
// Step 6: Config 检查    → 扫描 {{变量}}
// Step 7: Knowledge 检查 → 知识文件存在 (从 profile.method.knowledge filter type='file')
// Step 8: 汇总
//
// 允许依赖：agent/*、shared/*、semver、fs、child_process
// 禁止依赖：ipc/*

import { existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { gte as semverGte, valid as semverValid } from 'semver'
import log from 'electron-log'
import type { AgentProfile, DependencyCheckResult, DependencyStepResult } from '@shared/types/agent'
import { extractSkillCliBins } from '../skills/metadata-extractor'

export function checkDependencies(
  profile: AgentProfile,
  dirPath: string,
  opts?: {
    appVersion?: string
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
  const appVersion = opts?.appVersion ?? '0.1.0'
  const accountValues = opts?.accountValues ?? new Map<string, string>()
  const builtinToolNames =
    opts?.builtinToolNames ??
    new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'skill'])

  const minAppVersion = profile.identity.minAppVersion
  const skills = profile.method.skills ?? []
  const cli = profile.method.cli ?? []
  const mcpServers = profile.method.mcpServers ?? []
  const tools = profile.method.tools ?? []
  const subagents = profile.method.collaboration?.subagents ?? []
  const knowledge = profile.method.knowledge ?? []

  // Step 1: minAppVersion
  if (minAppVersion) {
    if (!semverValid(minAppVersion) || !semverGte(appVersion, minAppVersion)) {
      steps.push({
        step: 'minAppVersion',
        status: 'fail',
        message: `需要 Talor >= ${minAppVersion}，当前版本 ${appVersion}`,
      })
    } else {
      steps.push({ step: 'minAppVersion', status: 'pass' })
    }
  } else {
    steps.push({ step: 'minAppVersion', status: 'pass' })
  }

  // Step 2: Skill 检查（v8.1 SkillItem 是 flat: { name, required, purpose? }）
  const skillsDir = join(dirPath, 'skills')
  const missingSkills: string[] = []
  for (const item of skills) {
    const skillPath = join(skillsDir, item.name, 'SKILL.md')
    if (!existsSync(skillPath)) {
      missingSkills.push(item.name)
    }
  }

  if (missingSkills.length > 0) {
    steps.push({
      step: 'skill',
      status: 'missing',
      message: `缺少 Skill: ${missingSkills.join(', ')}`,
      details: missingSkills,
    })
  } else {
    steps.push({ step: 'skill', status: 'pass' })
  }

  // Step 3: CLI 检查
  const skillCliBins = extractSkillCliBins(skillsDir)
  const declaredCliCommands = cli.map((c) => c.command)
  const allCliCommands = [...new Set([...declaredCliCommands, ...skillCliBins])]

  const cliResults: string[] = []
  for (const command of allCliCommands) {
    const cliDep = cli.find((c) => c.command === command)
    const checkCmd = cliDep?.checkCommand ?? `${command} --version`

    try {
      execSync(checkCmd, { stdio: 'pipe', timeout: 5000 })
    } catch {
      if (cliDep?.install) {
        try {
          const installCmd =
            cliDep.install.type === 'npm'
              ? `npm install -g ${cliDep.install.package}`
              : cliDep.install.type === 'brew'
                ? `brew install ${cliDep.install.formula}`
                : `curl -fsSL ${(cliDep.install as { url: string }).url} | sh`

          log.info('[dep-checker] Auto-installing CLI:', command, '→', installCmd)
          execSync(installCmd, { stdio: 'pipe', timeout: 60000 })

          try {
            execSync(checkCmd, { stdio: 'pipe', timeout: 5000 })
          } catch {
            cliResults.push(`${command}: 安装后仍然不可用`)
          }
        } catch (installErr) {
          cliResults.push(
            `${command}: 自动安装失败 — ${installErr instanceof Error ? installErr.message : String(installErr)}`,
          )
        }
      } else {
        const source = skillCliBins.includes(command)
          ? `Skill 需要 ${command}，但 agent 未声明安装方式`
          : `${command} 未安装`
        cliResults.push(source)
      }
    }
  }

  if (cliResults.length > 0) {
    steps.push({
      step: 'cli',
      status: 'missing',
      message: cliResults.join('; '),
      details: cliResults,
    })
  } else {
    steps.push({ step: 'cli', status: 'pass' })
  }

  // Step 4: MCP Server 检查
  const mcpIssues: string[] = []
  for (const mcp of mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      const envVar = mcp.transport.auth.envVar
      if (!accountValues.has(envVar)) {
        mcpIssues.push(`${mcp.name}: 需要配置 ${envVar} → 前往账户管理`)
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

  // Step 5: Tool 白名单校验（required 且未 disabled 且不在 builtin 集合 → missing）
  const missingTools: string[] = []
  for (const dep of tools) {
    if (dep.required && !dep.disabled && !builtinToolNames.has(dep.name)) {
      missingTools.push(dep.name)
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
    for (const dep of subagents) {
      if (dep.required && !opts.registeredBusinessAgents.has(dep.id)) {
        missingSubagents.push(dep.id)
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

  // Step 6: Config 检查
  const missingVars: string[] = []
  const configStr = JSON.stringify(profile)
  const varMatches = configStr.matchAll(/\{\{(\w+)\}\}/g)
  for (const match of varMatches) {
    if (!accountValues.has(match[1])) {
      missingVars.push(match[1])
    }
  }

  // Also check MCP auth envVars
  for (const mcp of mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      if (
        !accountValues.has(mcp.transport.auth.envVar) &&
        !missingVars.includes(mcp.transport.auth.envVar)
      ) {
        missingVars.push(mcp.transport.auth.envVar)
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

  // Step 7: Knowledge 检查（仅 type='file' 且 required）
  const missingKnowledge: string[] = []
  for (const k of knowledge) {
    if (k.type === 'file' && k.required) {
      const absPath = join(dirPath, k.path)
      if (!existsSync(absPath)) {
        missingKnowledge.push(k.path)
      }
    }
  }

  if (missingKnowledge.length > 0) {
    steps.push({
      step: 'knowledge',
      status: 'missing',
      message: `缺少知识文件: ${missingKnowledge.join(', ')}`,
      details: missingKnowledge,
    })
  } else {
    steps.push({ step: 'knowledge', status: 'pass' })
  }

  // Step 8: 汇总
  const passed = steps.every((s) => s.status === 'pass')
  steps.push({ step: 'complete', status: passed ? 'pass' : 'fail' })

  return { passed, steps }
}
