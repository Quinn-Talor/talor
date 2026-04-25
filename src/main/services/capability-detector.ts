import log from 'electron-log'
import type { ModelCapability, ModelInfo } from '../types/models'
import { DEFAULT_MODEL_CAPABILITIES } from '../types/models'

export const VISION_MODEL_PATTERNS: RegExp[] = [
  /gpt-4[-_]?(o|vision|turbo|mini)/i,
  /gpt-4\.1/i,
  /claude-3/i,
  /claude-[3-9]/i,
  /gemini[-_]?(pro|ultra|flash|1\.5|2)/i,
  /llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm[-_]?v/i,
  /qwen[-_]?(vl|2[-_]?vl|omni)/i,
  /internvl/i,
  /deepseek[-_]?vl/i,
]

export const TOOLS_MODEL_PATTERNS: RegExp[] = [
  /gpt-4/i,
  /gpt-3\.5[-_]turbo/i,
  /claude-3/i,
  /claude-[3-9]/i,
  /gemini[-_]?(pro|ultra|flash|1\.5|2)/i,
  /mistral[-_]?(large|medium|small|nemo)/i,
  /mixtral/i,
  /qwen[-_]?(2\.5|3|coder)/i,
  /deepseek[-_]?(v[2-9]|coder|r[0-9])/i,
  /llama[-_]?3\.[1-9]/i,
]

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(name))
}

export function detectModelCapabilities(model: ModelInfo): ModelCapability[] {
  const now = new Date().toISOString()
  const name = model.name

  const supportsVision = matchesAny(name, VISION_MODEL_PATTERNS)
  const supportsTools = matchesAny(name, TOOLS_MODEL_PATTERNS)

  const capabilities: ModelCapability[] = [
    {
      category: 'text',
      type: 'text_generation',
      supported: true,
      description: '文本生成',
      source: 'default',
    },
  ]

  if (supportsVision) {
    capabilities.push({
      category: 'vision',
      type: 'image_understanding',
      supported: true,
      description: '图片内容理解和描述',
      source: 'auto',
      detected_at: now,
    })
  }

  if (supportsTools) {
    capabilities.push({
      category: 'tools',
      type: 'function_calling',
      supported: true,
      description: '工具调用和函数执行',
      source: 'auto',
      detected_at: now,
    })
  }

  return capabilities
}

export function getCapabilitiesWithFallback(
  fn: () => ModelCapability[]
): ModelCapability[] {
  try {
    return fn()
  } catch (err) {
    log.warn('[CapabilityDetector] Detection failed, using fallback:', err)
    return DEFAULT_MODEL_CAPABILITIES
  }
}
