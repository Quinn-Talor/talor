// src/main/agent/dependency-checker.ts — 业务层：Agent 依赖检查 8 步链
//
// Step 1: minAppVersion  → semver 比较
// Step 2: Skill 安装     → installSkills（外部调用）
// Step 3: CLI 自动安装   → checkCommand → 缺失则自动安装 → 再检查
// Step 4: MCP Server     → 安装包（外部调用）
// Step 5: Tool 白名单校验
// Step 6: Config 检查    → 扫描 {{变量}}
// Step 7: Knowledge 检查 → 知识文件存在
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
import { extractSkillCliBins } from './skill-metadata'

export function checkDependencies(
  profile: AgentProfile,
  dirPath: string,
  opts?: {
    appVersion?: string
    accountValues?: Map<string, string>
    builtinToolNames?: Set<string>
  },
): DependencyCheckResult {
  const steps: DependencyStepResult[] = []
  const appVersion = opts?.appVersion ?? '0.1.0'
  const accountValues = opts?.accountValues ?? new Map<string, string>()
  const builtinToolNames = opts?.builtinToolNames ?? new Set(['read', 'write', 'edit', 'bash', 'glob', 'grep', 'ls', 'skill'])

  // Step 1: minAppVersion
  if (profile.minAppVersion) {
    if (!semverValid(profile.minAppVersion) || !semverGte(appVersion, profile.minAppVersion)) {
      steps.push({
        step: 'minAppVersion',
        status: 'fail',
        message: `需要 Talor >= ${profile.minAppVersion}，当前版本 ${appVersion}`,
      })
    } else {
      steps.push({ step: 'minAppVersion', status: 'pass' })
    }
  } else {
    steps.push({ step: 'minAppVersion', status: 'pass' })
  }

  // Step 2: Skill 检查（检查 skills 目录是否存在）
  const skillsDir = join(dirPath, 'skills')
  const missingSkills: string[] = []
  for (const group of profile.dependencies.skills) {
    for (const item of group.items) {
      const skillPath = join(skillsDir, item.name, 'SKILL.md')
      if (!existsSync(skillPath)) {
        missingSkills.push(item.name)
      }
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
  const declaredCliCommands = profile.dependencies.cli.map(c => c.command)
  const allCliCommands = [...new Set([...declaredCliCommands, ...skillCliBins])]

  const cliResults: string[] = []
  for (const command of allCliCommands) {
    const cliDep = profile.dependencies.cli.find(c => c.command === command)
    const checkCmd = cliDep?.checkCommand ?? `${command} --version`

    try {
      execSync(checkCmd, { stdio: 'pipe', timeout: 5000 })
    } catch {
      if (cliDep?.install) {
        try {
          const installCmd = cliDep.install.type === 'npm'
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
          cliResults.push(`${command}: 自动安装失败 — ${installErr instanceof Error ? installErr.message : String(installErr)}`)
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
    steps.push({ step: 'cli', status: 'missing', message: cliResults.join('; '), details: cliResults })
  } else {
    steps.push({ step: 'cli', status: 'pass' })
  }

  // Step 4: MCP Server 检查
  const mcpIssues: string[] = []
  for (const mcp of profile.dependencies.mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      const envVar = mcp.transport.auth.envVar
      if (!accountValues.has(envVar)) {
        mcpIssues.push(`${mcp.name}: 需要配置 ${envVar} → 前往账户管理`)
      }
    }
  }

  if (mcpIssues.length > 0) {
    steps.push({ step: 'mcpServer', status: 'missing', message: mcpIssues.join('; '), details: mcpIssues })
  } else {
    steps.push({ step: 'mcpServer', status: 'pass' })
  }

  // Step 5: Tool 白名单校验
  const missingTools: string[] = []
  for (const dep of profile.dependencies.tools) {
    if (dep.required && !builtinToolNames.has(dep.name)) {
      missingTools.push(dep.name)
    }
  }

  if (missingTools.length > 0) {
    steps.push({ step: 'tool', status: 'missing', message: `缺少 Tool: ${missingTools.join(', ')}`, details: missingTools })
  } else {
    steps.push({ step: 'tool', status: 'pass' })
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
  for (const mcp of profile.dependencies.mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      if (!accountValues.has(mcp.transport.auth.envVar) && !missingVars.includes(mcp.transport.auth.envVar)) {
        missingVars.push(mcp.transport.auth.envVar)
      }
    }
  }

  if (missingVars.length > 0) {
    steps.push({ step: 'config', status: 'missing', message: `未配置变量: ${missingVars.join(', ')}`, details: missingVars })
  } else {
    steps.push({ step: 'config', status: 'pass' })
  }

  // Step 7: Knowledge 检查
  const missingKnowledge: string[] = []
  for (const file of profile.knowledge.files) {
    if (file.required) {
      const absPath = join(dirPath, file.path)
      if (!existsSync(absPath)) {
        missingKnowledge.push(file.path)
      }
    }
  }

  if (missingKnowledge.length > 0) {
    steps.push({ step: 'knowledge', status: 'missing', message: `缺少知识文件: ${missingKnowledge.join(', ')}`, details: missingKnowledge })
  } else {
    steps.push({ step: 'knowledge', status: 'pass' })
  }

  // Step 8: 汇总
  const passed = steps.every(s => s.status === 'pass')
  steps.push({ step: 'complete', status: passed ? 'pass' : 'fail' })

  return { passed, steps }
}
