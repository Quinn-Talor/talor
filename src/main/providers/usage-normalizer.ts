// src/main/providers/usage-normalizer.ts —— 把 SDK usage 归一成统一 token 细分
//
// AI SDK v7 在 usage.inputTokenDetails 上统一暴露了跨厂商的缓存细分
// ({ noCacheTokens, cacheReadTokens, cacheWriteTokens }),含 deepseek/openai/google/
// anthropic。优先读它;若该结构缺失(provider 偶发不填),回退到扫 providerMetadata
// 各命名空间(老路径,兜底)。纯函数,无副作用,无需知道是哪个 provider。
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
  /** v7 统一缓存细分;字段可空(provider 未填时回退 providerMetadata)。 */
  inputTokenDetails?: {
    noCacheTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

// 兜底:v7 统一字段缺失时,扫 providerMetadata 各命名空间取缓存 token。
function extractCacheTokens(meta: Record<string, unknown> | undefined): {
  read: number
  write: number
} {
  if (!meta || typeof meta !== 'object') return { read: 0, write: 0 }
  for (const v of Object.values(meta)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const read = num(
      o.cacheReadInputTokens ??
        o.cachedPromptTokens ??
        o.cachedTokens ??
        o.cachedContentTokenCount ??
        o.promptCacheHitTokens, // deepseek
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
  const det = raw?.inputTokenDetails
  const detRead = num(det?.cacheReadTokens)
  const detWrite = num(det?.cacheWriteTokens)

  // 主路径:v7 统一 inputTokenDetails(有任一字段填了就采信)
  if (det && (det.noCacheTokens != null || detRead > 0 || detWrite > 0)) {
    const nonCached =
      det.noCacheTokens != null
        ? num(det.noCacheTokens)
        : Math.max(0, num(raw?.inputTokens) - detRead - detWrite)
    return {
      inputTokens: nonCached,
      outputTokens: num(raw?.outputTokens),
      cacheReadTokens: detRead,
      cacheWriteTokens: detWrite,
    }
  }

  // 兜底:providerMetadata 扫描(inputTokens 视为含缓存,减去得非缓存)
  const { read, write } = extractCacheTokens(providerMetadata)
  return {
    inputTokens: Math.max(0, num(raw?.inputTokens) - read - write),
    outputTokens: num(raw?.outputTokens),
    cacheReadTokens: read,
    cacheWriteTokens: write,
  }
}
