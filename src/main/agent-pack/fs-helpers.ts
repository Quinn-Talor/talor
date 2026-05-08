// src/main/agent-pack/fs-helpers.ts — 业务层(基础设施扩展)：文件系统辅助
//
// Pack 模块共享的小函数。
//
// 允许依赖：fs / path
// 禁止依赖：ipc/*

import { readdirSync, statSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'

/** 递归列出 rootDir 下所有普通文件的绝对路径（不含目录、不跟随符号链接）。 */
export function* walkAllFiles(rootDir: string): Generator<string> {
  const entries = readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      yield* walkAllFiles(fullPath)
    } else if (entry.isFile()) {
      yield fullPath
    }
    // 符号链接 / 设备文件等跳过
  }
}

/** 递归计算目录大小（bytes）。 */
export function dirSize(rootDir: string): number {
  let total = 0
  for (const filePath of walkAllFiles(rootDir)) {
    total += statSync(filePath).size
  }
  return total
}

/** 复制 srcDir 整个目录到 destDir，递归创建必要的父目录。 */
export function copyDirRecursive(srcDir: string, destDir: string): void {
  for (const srcFile of walkAllFiles(srcDir)) {
    const rel = srcFile.slice(srcDir.length + 1) // strip srcDir prefix
    const destFile = join(destDir, rel)
    mkdirSync(dirname(destFile), { recursive: true })
    copyFileSync(srcFile, destFile)
  }
}

/**
 * 校验 zip entry 路径是否安全（防 zip slip）。
 * 允许的相对路径必须不含 '..' 段，且不以 '/' 或 'C:\' 等绝对前缀开头。
 */
export function isSafePackEntryPath(rel: string): boolean {
  if (!rel) return false
  if (rel.startsWith('/') || rel.startsWith('\\')) return false
  if (/^[a-zA-Z]:[\\/]/.test(rel)) return false // Windows 绝对路径
  const parts = rel.split(/[\\/]+/)
  for (const p of parts) {
    if (p === '..') return false
    if (p === '.') continue
  }
  return true
}
