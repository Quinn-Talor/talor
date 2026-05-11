// src/main/agent/importer.ts — 业务层：Agent 导入（解压 + 校验 + 同名检测）
//
// 允许依赖：fs、child_process、path、agent/validator
// 禁止依赖：ipc/*

import { execSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  cpSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import log from 'electron-log'
import { validateProfile } from './validator'
import type { AgentProfile } from '@shared/types/agent'

export interface ImportResult {
  profile: AgentProfile
  dirPath: string
  overwritten: boolean
}

export function importAgent(zipBuffer: Buffer, agentsDir: string): ImportResult {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-import-'))

  try {
    const zipPath = join(tempDir, 'agent.zip')
    writeFileSync(zipPath, zipBuffer)

    execSync(`unzip -o "${zipPath}" -d "${tempDir}"`, { stdio: 'pipe', timeout: 30000 })

    const entries = readdirSync(tempDir).filter((name: string) => {
      if (name === 'agent.zip') return false
      try {
        return statSync(join(tempDir, name)).isDirectory()
      } catch {
        return false
      }
    })

    if (entries.length === 0) {
      throw new Error('No agent directory found in zip')
    }

    const agentDirName = entries[0]
    const extractedDir = join(tempDir, agentDirName)
    const agentJsonPath = join(extractedDir, 'agent.json')

    if (!existsSync(agentJsonPath)) {
      throw new Error('agent.json not found in zip')
    }

    const raw = readFileSync(agentJsonPath, 'utf-8')
    const json = JSON.parse(raw)
    const result = validateProfile(json)

    if (!result.valid) {
      const errMsg = result.errors.map((e) => `[rule ${e.rule}] ${e.path}: ${e.message}`).join('; ')
      throw new Error(`Invalid agent.json: ${errMsg}`)
    }

    const targetDir = join(agentsDir, agentDirName)
    const overwritten = existsSync(targetDir)

    if (overwritten) {
      rmSync(targetDir, { recursive: true, force: true })
    }

    if (!existsSync(agentsDir)) {
      mkdirSync(agentsDir, { recursive: true })
    }

    cpSync(extractedDir, targetDir, { recursive: true })

    log.info(
      '[importer] Imported agent:',
      result.profile.id,
      'to',
      targetDir,
      overwritten ? '(overwritten)' : '',
    )

    return {
      profile: result.profile,
      dirPath: targetDir,
      overwritten,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}
