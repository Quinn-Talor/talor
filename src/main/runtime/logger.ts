// src/main/runtime/logger.ts — 业务层：引擎诊断日志写到 electron-log
//
// 允许依赖: agent-engine（类型）、electron-log
// 禁止依赖: ipc/*、repos/*、db/*

import log from 'electron-log'
import type { Logger } from '@talor/agent-engine'

/** 引擎诊断日志写到 electron-log，前缀 `[engine]`。 */
export function electronLogger(): Logger {
  return {
    log(entry) {
      const args = entry.detail === undefined ? [entry.message] : [entry.message, entry.detail]
      log[entry.level]('[engine]', ...args)
    },
  }
}
