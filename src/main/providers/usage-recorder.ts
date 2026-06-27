// src/main/providers/usage-recorder.ts —— 业务层: 归一 SDK usage 后累加到 session
//
// 调用点(react-loop / runReflectAgent / ShortTermMemory)拿到 SDK 的 usage +
// providerMetadata 后调本函数。sessionId 由调用点直接传。fail-open。
//
// 允许依赖: ./usage-normalizer, ../repos/session-repo, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import { normalizeUsage } from './usage-normalizer'
import { sessionRepo } from '../repos/session-repo'

export function recordUsage(
  sessionId: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  providerMetadata: Record<string, unknown> | undefined,
): void {
  try {
    if (!usage) return
    const n = normalizeUsage(usage, providerMetadata)
    if (
      n.inputTokens === 0 &&
      n.outputTokens === 0 &&
      n.cacheReadTokens === 0 &&
      n.cacheWriteTokens === 0
    ) {
      return
    }
    sessionRepo.addUsage(sessionId, n)
  } catch (err) {
    log.warn('[usage-recorder] recordUsage failed:', err)
  }
}
