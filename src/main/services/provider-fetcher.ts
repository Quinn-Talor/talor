import log from 'electron-log'
import type { Provider } from '../store/config-store'
import type { ModelInfo } from '../types/models'
import { getAdapter } from '../providers/model-adapter'

const modelCache = new Map<string, ModelInfo[]>()
export const CACHE_TTL_MS = 300_000

export function isCacheValid(lastUpdated: string | undefined): boolean {
  if (!lastUpdated) return false
  const elapsed = Date.now() - new Date(lastUpdated).getTime()
  return elapsed >= 0 && elapsed < CACHE_TTL_MS
}

export async function getProviderModels(
  provider: Provider,
  forceRefresh = false,
): Promise<ModelInfo[]> {
  if (!forceRefresh) {
    const cached = modelCache.get(provider.id)
    if (cached) {
      log.debug('[ProviderFetcher] Using cached models for', provider.id, 'count:', cached.length)
      return cached
    }
  }

  try {
    log.info('[ProviderFetcher] Fetching models for', provider.id)
    const adapter = getAdapter(provider.type)
    const models = await adapter.fetchModels(provider)

    modelCache.set(provider.id, models)
    setTimeout(() => {
      log.debug('[ProviderFetcher] Cache expired for', provider.id)
      modelCache.delete(provider.id)
    }, CACHE_TTL_MS)

    log.info('[ProviderFetcher] Fetched models for', provider.id, 'count:', models.length)
    return models
  } catch (err) {
    log.warn('[ProviderFetcher] Failed to fetch models for', provider.id, ':', err)
    throw new Error(`Failed to fetch models: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function clearProviderModelCache(): void {
  log.info('[ProviderFetcher] Clearing model cache')
  modelCache.clear()
}

export function getCachedModels(providerId: string): ModelInfo[] | undefined {
  return modelCache.get(providerId)
}
