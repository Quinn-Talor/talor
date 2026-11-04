// src/main/runtime/run-archive.ts — 业务层：引擎运行档案（~/.talor/runs.db）单例
//
// 引擎与 Trace 面板共用同一个连接；只打开档案，不启动引擎、不连接 MCP（与 getRuntime 区分）。
// engine.ts 再导出 runsDbPath / runArchive。interactive 执行环境的运行（用户的会话）不按天数清理，删除会话时
// 一起删除（引擎 deleteSession）；其他执行环境保留 30 天。引擎按会话整体判定过期。
// 引擎拒绝打开表结构版本不同的档案（不迁移）：这时把旧文件连同 -wal、-shm 改名为
// `<文件>.v<旧版本>-<时间戳>.bak` 留着，再建新档案；旧轨迹从 Trace 面板上消失，文件不删。
//
// 允许依赖: agent-engine、electron（app）、better-sqlite3（只读旧档案的版本号）、electron-log
// 禁止依赖: ipc/*、repos/*、db/*

import { existsSync, renameSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import log from 'electron-log'
import { type Archive } from 'agent-engine'
import { sqliteArchive } from 'agent-engine/adapters/sqlite'

export const ARCHIVE_RETENTION_DAYS = 30
/** 用户会话所在的执行环境（engine.ts 的 interactiveEnvironment）。 */
export const INTERACTIVE_ENVIRONMENT = 'interactive'

/** 引擎报表结构版本不一致时的报错文字（引擎没有导出错误类型）。 */
const SCHEMA_MISMATCH = '表结构版本'
const COMPANIONS = ['', '-wal', '-shm']

export function runsDbPath(): string {
  return join(app.getPath('home'), '.talor', 'runs.db')
}

/** 旧档案的表结构版本；读不出时为 unknown。 */
function storedVersion(file: string): string {
  try {
    const db = new Database(file, { readonly: true, fileMustExist: true })
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined
      return row?.value ?? 'unknown'
    } finally {
      db.close()
    }
  } catch {
    return 'unknown'
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const stampOf = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

/** 把档案与它的 -wal、-shm 改名备份，返回备份路径；同名已存在时追加 -1、-2…… */
function moveAside(file: string): string {
  const base = `${file}.v${storedVersion(file)}-${stampOf(new Date())}`
  let n = 0
  const nameOf = (i: number) => `${base}${i ? `-${i}` : ''}.bak`
  while (existsSync(nameOf(n))) n++
  const backup = nameOf(n)
  for (const suffix of COMPANIONS) {
    if (existsSync(file + suffix)) renameSync(file + suffix, backup + suffix)
  }
  return backup
}

/** 打开档案；表结构版本与引擎不同时改名备份旧文件后重建，其他错误原样抛出。 */
export function openRunArchive(file: string, open: typeof sqliteArchive = sqliteArchive): Archive {
  const opts = {
    file,
    retention: {
      defaultDays: ARCHIVE_RETENTION_DAYS,
      // 会话的前文来自档案：按天数清理会让过期的会话从空窗口重新开始
      environments: { [INTERACTIVE_ENVIRONMENT]: Number.POSITIVE_INFINITY },
    },
  }
  try {
    return open(opts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!existsSync(file) || !message.includes(SCHEMA_MISMATCH)) throw err
    const backup = moveAside(file)
    log.warn(`[run-archive] schema mismatch, moved old archive to ${backup}:`, message)
    return open(opts)
  }
}

let archive: Archive | undefined

/** 运行档案单例；第一次调用时打开（文件不存在时建文件）。 */
export function runArchive(): Archive {
  archive ??= openRunArchive(runsDbPath())
  return archive
}
