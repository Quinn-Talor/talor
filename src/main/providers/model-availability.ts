import type { ModelInfo } from '@shared/types/models'

export interface ModelAvailabilityResult {
  available: boolean
  model?: ModelInfo
}

export function checkModelAvailability(
  modelId: string | undefined,
  providerModels: ModelInfo[],
): ModelAvailabilityResult {
  if (!modelId) return { available: false }
  const model = providerModels.find((m) => m.id === modelId)
  return model ? { available: true, model } : { available: false }
}
