// src/main/skills/loader.ts — 基础设施层: SKILL.md 文件加载器
//
// ─── 信任边界 (TRUST BOUNDARY,与 SystemPlugin Principle 6 配套) ─────────
//
// Skill 内容会作为 trust="skill-content" tool output 注入到 LLM 上下文,
// 在 prompt-injection 防御之外被视为"执行契约"。这条豁免依赖以下不变量:
//
//   1. 单一加载点:仅 loadSkillsFromDir(skillsDir) 一个函数入口。
//   2. 启动期加载:由 main/index.ts / agent-manager.ts / ipc/agents.ts 在
//      app boot 或 agent 注册时同步调用,加载完成后 registry 即冻结。
//      运行时(react-loop / 工具执行链)没有任何路径会重新调用本文件。
//   3. 受信目录来源:目录路径来自代码层硬编码或 agent profile 声明,
//      具体两个合法来源:
//        - ~/.talor/skills/                    (用户本机管控的全局 skill)
//        - <agentDir>/skills/                   (agent profile 包内 skill)
//      不接受 tool output / 网络 / 第三方输入派生的目录。
//   4. 无运行时注入:本文件不导出"运行时追加 skill"API,SkillRegistry 也
//      仅有 fromDir 静态构造一次,不暴露 add/inject 方法。
//
// 若未来要支持"运行时从市场下载 skill"等动态来源,必须:
//   - 把那条路径明确剥离到独立模块,且不复用本 loader
//   - 重新审视 SystemPlugin Principle 6 的信任声明,加入沙箱/审计层
//
// ──────────────────────────────────────────────────────────────────────
//
// 允许依赖:fs / yaml / electron-log / ./types
// 禁止依赖:ipc/* (这是基础设施,被业务层调用)

import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import log from 'electron-log'
import type { SkillMetadata, ParsedSkill } from './types'

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseSkillMd(filePath: string): ParsedSkill | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const match = raw.match(FRONTMATTER_REGEX)

    if (!match) {
      log.warn('[SkillLoader] SKILL.md has no frontmatter, skipping:', filePath)
      return null
    }

    const [, frontmatterStr, content] = match

    let parsed: Record<string, unknown>
    try {
      parsed = parseYaml(frontmatterStr) as Record<string, unknown>
    } catch (yamlErr) {
      log.warn('[SkillLoader] Failed to parse YAML frontmatter:', filePath, yamlErr)
      return null
    }

    const name = parsed.name as string | undefined
    const description = parsed.description as string | undefined

    if (!name || !description) {
      log.warn('[SkillLoader] SKILL.md missing name or description:', filePath)
      return null
    }

    const meta = parsed.metadata as Record<string, unknown> | undefined

    // when_to_use 是 Anthropic 官方 skill spec 的顶层字段,不放在 metadata 下。
    // 与 name/description 平级,便于与 Claude Code skill 目录互通。
    const rawWhenToUse = parsed.when_to_use
    const when_to_use =
      typeof rawWhenToUse === 'string' && rawWhenToUse.trim().length > 0
        ? rawWhenToUse.trim()
        : undefined

    const metadata: SkillMetadata = {
      name,
      description,
      version: parsed.version as string | undefined,
      when_to_use,
      requires: meta?.requires as { bins?: string[] } | undefined,
      cliHelp: meta?.cliHelp as string | undefined,
    }

    return { metadata, content: content.trimStart(), filePath }
  } catch (err) {
    log.warn('[SkillLoader] Failed to read SKILL.md:', filePath, err)
    return null
  }
}

export function loadSkillsFromDir(skillsDir: string): ParsedSkill[] {
  if (!existsSync(skillsDir)) {
    return []
  }

  const entries = readdirSync(skillsDir)
  const skills: ParsedSkill[] = []

  for (const entry of entries) {
    const entryPath = join(skillsDir, entry)
    if (!statSync(entryPath).isDirectory()) continue

    const skillMdPath = join(entryPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    const parsed = parseSkillMd(skillMdPath)
    if (parsed) {
      skills.push(parsed)
    }
  }

  return skills
}
