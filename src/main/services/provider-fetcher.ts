import log from 'electron-log'
import type { Provider } from '../store/config-store'
import type { ModelInfo } from '../types/models'
import { createBasicModelInfo } from '../types/models'

const modelCache = new Map<string, ModelInfo[]>()
export const CACHE_TTL_MS = 300_000

export function isCacheValid(lastUpdated: string | undefined): boolean {
  if (!lastUpdated) return false
  const elapsed = Date.now() - new Date(lastUpdated).getTime()
  return elapsed >= 0 && elapsed < CACHE_TTL_MS
}

export async function getProviderModels(provider: Provider, forceRefresh = false): Promise<ModelInfo[]> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = modelCache.get(provider.id)
    if (cached) {
      log.debug('[ProviderFetcher] Using cached models for', provider.id, 'count:', cached.length)
      return cached
    }
  }

  try {
    const baseUrl = provider.base_url.replace(/\/$/, '')
    const url =
      provider.type === 'ollama'
        ? `${baseUrl}/api/tags`
        : `${baseUrl}/v1/models`

    log.info('[ProviderFetcher] Fetching models for', provider.id, 'from:', url)
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) }) // 10s timeout
    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 200)}`)
    }

    const data = await res.json() as Record<string, unknown>
    const models = extractModelInfos(provider, data)

    // Cache the results
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

function extractModelInfos(provider: Provider, data: Record<string, unknown>): ModelInfo[] {
  const models: ModelInfo[] = []

  if (provider.type === 'ollama') {
    const ollamaModels = (data as { models?: { name?: string; details?: { families?: string[] } }[] }).models ?? []
    for (const model of ollamaModels) {
      if (!model.name) continue
      
      const modelId = `${provider.type}/${model.name}`
      const displayName = formatDisplayName(model.name)
      const description = `Ollama model: ${model.name}`
      
      models.push(createBasicModelInfo(
        modelId,
        model.name,
        provider.id,
        displayName,
        description
      ))
    }
  } else if (provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google') {
    const apiModels = (data as { data?: { id?: string; object?: string; owned_by?: string }[] }).data ?? []
    for (const model of apiModels) {
      if (!model.id) continue
      
      const modelId = `${provider.type}/${model.id}`
      const displayName = formatDisplayName(model.id)
      const description = model.owned_by ? `Owned by ${model.owned_by}` : `${provider.type} model`
      
      models.push(createBasicModelInfo(
        modelId,
        model.id,
        provider.id,
        displayName,
        description
      ))
    }
  }

  return models
}

function formatDisplayName(modelName: string): string {
  // Simple formatting: capitalize first letter, replace separators with spaces
  return modelName
    .replace(/[:_-]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim()
}

export function clearProviderModelCache(): void {
  log.info('[ProviderFetcher] Clearing model cache')
  modelCache.clear()
}

export function getCachedModels(providerId: string): ModelInfo[] | undefined {
  return modelCache.get(providerId)
}
