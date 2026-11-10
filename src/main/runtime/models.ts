// src/main/runtime/models.ts — 业务层：Talor 模型库（agent-engine 的 ModelProvider）
//
// 模型引用 `talor:<providerId>/<modelId>[?reasoning=…]` 解析为转发端口：每次调用按当前 provider 配置
// 重新创建模型实例与引擎端口，用户改了 API key、headers 不需要重建引擎。调用参数（reasoning、
// provider_options、headers）与旧路径一致，交给引擎 aiSdkProvider 的 callSettings；会话覆盖的
// reasoning 编进引用。端口的 settings 取引擎端口的同名字段，供引擎算模型配置指纹。
//
// 允许依赖: agent-engine、ai（类型）、chat/provider-selector、history/context-config、providers/*、store/config-store、@shared/types
// 禁止依赖: ipc/*、repos/*、db/*

import type { LanguageModel } from 'ai'
import {
  ModelCallError,
  type ModelCapabilities,
  type ModelPort,
  type ModelProvider,
  type ModelRef,
} from 'agent-engine'
import { aiSdkProvider, type AiSdkModelConfig } from 'agent-engine/adapters/ai-sdk'
import type { ReasoningConfig } from '@shared/types/models'
import { getProviderById } from '../chat/provider-selector'
import { modelContextWindow } from '../history/context-config'
import { modelSupportsReasoning } from '../providers/capability/detector'
import { getAdapter, mergeProviderOptions, resolveStreamOptions } from '../providers/model-adapter'
import type { Provider } from '../store/config-store'

export const TALOR_MODEL_PROVIDER_ID = 'talor'

const PREFIX = `${TALOR_MODEL_PROVIDER_ID}:`
const REASONING_QUERY = '?reasoning='
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000
const DEFAULT_MAX_RETRIES = 2

type CallSettings = NonNullable<AiSdkModelConfig['callSettings']>
type SdkReasoning = NonNullable<CallSettings['reasoning']>
type Vendor = NonNullable<AiSdkModelConfig['vendor']>

const VENDOR_OF: Record<Provider['type'], Vendor> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  ollama: 'ollama',
}

const SDK_REASONING: ReadonlySet<string> = new Set<SdkReasoning>([
  'provider-default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

const isSdkReasoning = (value: unknown): value is SdkReasoning =>
  typeof value === 'string' && SDK_REASONING.has(value)

export function modelRefOf(
  providerId: string,
  modelId: string,
  reasoning?: ReasoningConfig,
): ModelRef {
  const base = `${PREFIX}${providerId}/${modelId}`
  if (!reasoning) return base
  const { enabled, effort, budgetTokens } = reasoning
  return `${base}${REASONING_QUERY}${encodeURIComponent(JSON.stringify({ enabled, effort, budgetTokens }))}`
}

export function parseModelRef(
  ref: ModelRef,
): { providerId: string; modelId: string; reasoning?: ReasoningConfig } | undefined {
  if (!ref.startsWith(PREFIX)) return undefined
  const body = ref.slice(PREFIX.length)
  const query = body.indexOf(REASONING_QUERY)
  const path = query >= 0 ? body.slice(0, query) : body
  const slash = path.indexOf('/')
  if (slash <= 0 || slash === path.length - 1) return undefined
  const target = { providerId: path.slice(0, slash), modelId: path.slice(slash + 1) }
  if (query < 0) return target
  try {
    const reasoning = JSON.parse(
      decodeURIComponent(body.slice(query + REASONING_QUERY.length)),
    ) as ReasoningConfig
    return { ...target, reasoning }
  } catch {
    return undefined
  }
}

/** 与旧路径一致的调用参数：adapter 默认值 < reasoning < provider.provider_options，加上 headers 与顶层 reasoning。 */
export function callSettingsOf(provider: Provider, modelId: string): CallSettings {
  const stream = resolveStreamOptions(getAdapter(provider.type), provider, modelId)
  // mergeProviderOptions 按 provider-key 合并，每个键下都是字段对象
  const providerOptions = mergeProviderOptions(stream, {
    providerOptions: provider.provider_options ?? {},
  }).providerOptions as Record<string, Record<string, unknown>>
  return {
    providerOptions,
    ...(provider.headers ? { headers: provider.headers } : {}),
    ...(isSdkReasoning(stream.reasoning) ? { reasoning: stream.reasoning } : {}),
  }
}

/**
 * 模型可接收的输入模态（文本恒可）。supports_vision 为真时声明图片；
 * Anthropic / Google 原生支持 PDF，额外声明 pdf，其余提供商只放行图片。
 */
function inputsOf(provider: Provider): ModelCapabilities['inputs'] {
  if (!provider.supports_vision) return []
  return provider.type === 'anthropic' || provider.type === 'google' ? ['image', 'pdf'] : ['image']
}

function capabilitiesOf(provider: Provider, modelId: string): ModelCapabilities {
  return {
    contextLimit: modelContextWindow(provider, modelId),
    maxOutputTokens: provider.max_output_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    inputs: inputsOf(provider),
    toolCalls: true,
    reasoning: modelSupportsReasoning(provider, modelId) ? 'optional' : 'none',
    systemAfterUser: true,
    parallelToolCalls: true,
  }
}

function defaultCreateModel(provider: Provider, modelId: string): LanguageModel {
  return getAdapter(provider.type).createModel(provider, modelId)
}

/**
 * 按 provider 的 request_timeout_ms 计时（与旧路径一致，只在设置了且大于 0 时生效）；
 * 到时中止底层请求，报 MODEL_TIMEOUT（可重试）。
 */
async function callWithTimeout(
  port: ModelPort,
  input: Parameters<ModelPort['call']>[0],
  opts: Parameters<ModelPort['call']>[1],
  limit: number | undefined,
): ReturnType<ModelPort['call']> {
  if (limit === undefined || limit <= 0) return port.call(input, opts)
  const controller = new AbortController()
  const forward = () => controller.abort(opts.signal.reason)
  if (opts.signal.aborted) forward()
  else opts.signal.addEventListener('abort', forward, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, limit)
  try {
    return await port.call(input, { ...opts, signal: controller.signal })
  } catch (error) {
    if (timedOut) {
      throw new ModelCallError({
        code: 'MODEL_TIMEOUT',
        message: `模型请求超过 ${limit} 毫秒`,
        retryable: true,
        attempts: [],
      })
    }
    throw error
  } finally {
    clearTimeout(timer)
    opts.signal.removeEventListener('abort', forward)
  }
}

const unavailable = (message: string) =>
  new ModelCallError({ code: 'MODEL_UNAVAILABLE', message, retryable: false, attempts: [] })

export function talorModels(
  deps: {
    getProvider?(id: string): Provider | null
    createModel?(provider: Provider, modelId: string): LanguageModel
  } = {},
): ModelProvider {
  const getProvider = deps.getProvider ?? getProviderById
  const createModel = deps.createModel ?? defaultCreateModel

  const forwardingPort = (
    ref: ModelRef,
    target: NonNullable<ReturnType<typeof parseModelRef>>,
  ): ModelPort => {
    const { providerId, modelId } = target
    const current = (): Provider => {
      const provider = getProvider(providerId)
      if (!provider) throw unavailable(`provider ${providerId} 不可用`)
      return { ...provider, reasoning: target.reasoning ?? provider.reasoning }
    }
    const enginePortOf = (provider: Provider): ModelPort => {
      const model = createModel(provider, modelId)
      if (typeof model === 'string') {
        throw unavailable(`provider ${providerId} 返回了模型 id 而不是模型实例`)
      }
      return aiSdkProvider({
        id: 'talor-call',
        maxRetries: provider.max_retries ?? DEFAULT_MAX_RETRIES,
        models: {
          main: {
            model,
            vendor: VENDOR_OF[provider.type] ?? 'other',
            capabilities: capabilitiesOf(provider, modelId),
            callSettings: callSettingsOf(provider, modelId),
          },
        },
      }).resolve('talor-call:main')!
    }
    return {
      ref,
      get capabilities() {
        return capabilitiesOf(current(), modelId)
      },
      // 模型配置指纹的输入：沿用引擎端口的算法（header 只取名字），用户改了参数下一轮就能看出来
      get settings() {
        return enginePortOf(current()).settings
      },
      async call(input, opts) {
        const provider = current()
        return callWithTimeout(enginePortOf(provider), input, opts, provider.request_timeout_ms)
      },
    }
  }

  return {
    id: TALOR_MODEL_PROVIDER_ID,
    resolve(ref) {
      const target = parseModelRef(ref)
      if (!target || !getProvider(target.providerId)) return undefined
      return forwardingPort(ref, target)
    },
  }
}
