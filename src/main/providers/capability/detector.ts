import log from 'electron-log'
import type { ModelCapability, ModelInfo } from '@shared/types/models'
import type { Provider } from '../../store/config-store'
import { DEFAULT_MODEL_CAPABILITIES } from '@shared/types/models'

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

export const REASONING_MODEL_PATTERNS: RegExp[] = [
  /claude-3[-_]?7/i,
  /claude-[4-9](\.|-|$)/i,
  /claude-(sonnet|opus|haiku|fable)-[4-9]/i,
  /gemini[-_]?2\.[5-9]/i,
  /gemini[-_]?[3-9](\.|-|$)/i,
  /^o[1-9](-(mini|pro|preview))?(-\d{4}-\d{2}-\d{2})?$/i,
  /deepseek[-_]?r[0-9]/i,
  /deepseek[-_]?reasoner/i,
  /gpt-5/i,
  /gpt-oss/i,
  /qwen[-_]?3/i,
]

function matchesAny(name: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(name))
}

export function detectModelCapabilities(model: ModelInfo): ModelCapability[] {
  const now = new Date().toISOString()
  const name = model.name

  const supportsVision = matchesAny(name, VISION_MODEL_PATTERNS)
  const supportsTools = matchesAny(name, TOOLS_MODEL_PATTERNS)
  const supportsReasoning = matchesAny(name, REASONING_MODEL_PATTERNS)

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

  if (supportsReasoning) {
    capabilities.push({
      category: 'reasoning',
      type: 'configurable_reasoning',
      supported: true,
      description: '可配置推理深度',
      source: 'auto',
      detected_at: now,
    })
  }

  return capabilities
}

/**
 * 某 provider 下的模型是否支持可配置推理(决定是否下发 reasoning 参数)。
 *
 * 优先用模型列表里已记录的 reasoning capability(含用户手动覆盖);没有记录时按
 * REASONING_MODEL_PATTERNS 匹配模型名。modelId 可带 `<type>/` 前缀(ModelInfo.id 形态)。
 */
export function modelSupportsReasoning(
  provider: Pick<Provider, 'type' | 'models'>,
  modelId: string,
): boolean {
  const prefix = `${provider.type}/`
  const bare = modelId.startsWith(prefix) ? modelId.slice(prefix.length) : modelId
  const info = provider.models?.find(
    (m) => m.id === modelId || m.id === `${prefix}${bare}` || m.name === bare,
  )
  const recorded = info?.capabilities?.find((c) => c.category === 'reasoning')
  if (recorded) return recorded.supported
  return matchesAny(info?.name ?? bare, REASONING_MODEL_PATTERNS)
}

export function getCapabilitiesWithFallback(fn: () => ModelCapability[]): ModelCapability[] {
  try {
    return fn()
  } catch (err) {
    log.warn('[CapabilityDetector] Detection failed, using fallback:', err)
    return DEFAULT_MODEL_CAPABILITIES
  }
}
