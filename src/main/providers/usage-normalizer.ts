// src/main/providers/usage-normalizer.ts —— 把 SDK usage 归一成统一 token 细分
//
// AI SDK v6 的 usage.inputTokens 已跨厂商含缓存。缓存细分散落在 providerMetadata
// 各 provider 命名空间(key 各异)。本函数扫所有命名空间取缓存 token, 从 input 减掉得
// 非缓存 input。纯函数, 无副作用, 无需知道是哪个 provider。
//
// 允许依赖: 无
// 禁止依赖: ipc/*

export interface NormalizedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

interface RawUsage {
  inputTokens?: number
  outputTokens?: number
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function extractCacheTokens(meta: Record<string, unknown> | undefined): {
  read: number
  write: number
} {
  if (!meta || typeof meta !== 'object') return { read: 0, write: 0 }
  for (const v of Object.values(meta)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const read = num(
      o.cacheReadInputTokens ?? o.cachedPromptTokens ?? o.cachedTokens ?? o.cachedContentTokenCount,
    )
    const write = num(o.cacheCreationInputTokens ?? o.cacheWriteInputTokens)
    if (read > 0 || write > 0) return { read, write }
  }
  return { read: 0, write: 0 }
}

export function normalizeUsage(
  raw: RawUsage | undefined,
  providerMetadata: Record<string, unknown> | undefined,
): NormalizedUsage {
  const inclusiveInput = num(raw?.inputTokens)
  const { read, write } = extractCacheTokens(providerMetadata)
  return {
    inputTokens: Math.max(0, inclusiveInput - read - write),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  }
}
