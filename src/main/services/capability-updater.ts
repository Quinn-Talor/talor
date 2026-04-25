import type { ModelCapability } from '../types/models'

export function applyManualCapabilities(capabilities: ModelCapability[]): ModelCapability[] {
  const now = new Date().toISOString()
  return capabilities.map(cap => ({ ...cap, source: 'manual' as const, detected_at: now }))
}
