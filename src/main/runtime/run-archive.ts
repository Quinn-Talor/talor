// src/main/runtime/run-archive.ts — 业务层：引擎运行档案（~/.talor/runs.db）单例
//
// 引擎与 Trace 面板共用同一个连接；只打开档案，不启动引擎、不连接 MCP（与 getRuntime 区分）。
// engine.ts 再导出 runsDbPath / runArchive。保留 30 天。
//
// 允许依赖: agent-engine、electron（app）
// 禁止依赖: ipc/*、repos/*、db/*

import { join } from 'path'
import { app } from 'electron'
import { type Archive } from 'agent-engine'
import { sqliteArchive } from 'agent-engine/adapters/sqlite'

export const ARCHIVE_RETENTION_DAYS = 30

export function runsDbPath(): string {
  return join(app.getPath('home'), '.talor', 'runs.db')
}

let archive: Archive | undefined

/** 运行档案单例；第一次调用时打开（文件不存在时建文件）。 */
export function runArchive(): Archive {
  archive ??= sqliteArchive({
    file: runsDbPath(),
    retention: { defaultDays: ARCHIVE_RETENTION_DAYS },
  })
  return archive
}
