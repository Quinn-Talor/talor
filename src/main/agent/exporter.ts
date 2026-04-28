// src/main/agent/exporter.ts — 业务层：Agent 导出（zip 打包）
//
// 将 agent 目录打包为 .agent.zip（使用 Node.js 内置 zlib + tar-like 逻辑）。
// 简化实现：用 child_process 调用系统 zip 命令。
//
// 允许依赖：fs、child_process、path
// 禁止依赖：ipc/*

import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import log from 'electron-log'

export function exportAgent(dirPath: string): Buffer {
  if (!existsSync(dirPath)) {
    throw new Error(`Agent directory not found: ${dirPath}`)
  }

  const agentJsonPath = join(dirPath, 'agent.json')
  if (!existsSync(agentJsonPath)) {
    throw new Error(`agent.json not found in: ${dirPath}`)
  }

  const dirName = basename(dirPath)
  const parentDir = join(dirPath, '..')
  const zipName = `${dirName}.agent.zip`
  const zipPath = join(parentDir, zipName)

  try {
    execSync(`cd "${parentDir}" && zip -r "${zipName}" "${dirName}" -x "*.DS_Store"`, {
      stdio: 'pipe',
      timeout: 30000,
    })

    const buffer = readFileSync(zipPath)
    execSync(`rm -f "${zipPath}"`, { stdio: 'pipe' })

    log.info('[exporter] Exported agent:', dirPath, 'size:', buffer.length)
    return buffer
  } catch (err) {
    throw new Error(`Failed to export agent: ${err instanceof Error ? err.message : String(err)}`)
  }
}
