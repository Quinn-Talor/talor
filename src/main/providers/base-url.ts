// src/main/providers/base-url.ts —— 业务层(providers): provider base_url 规范化
//
// 用户填的 base_url 可能带或不带版本段(https://api.openai.com 与 https://api.openai.com/v1
// 都常见)。对话(SDK createXxx 的 baseURL)、拉模型列表、连接测试三处必须用同一规则拼接,
// 否则会出现 /v1/v1/models 或缺 /v1 的 404。这里统一产出"带版本段的 API 根",对已带
// 版本段的输入幂等。
//
// 允许依赖: 无
// 禁止依赖: ipc/*

export type ProviderKind = 'ollama' | 'openai' | 'anthropic' | 'google'

/** base_url 为空时的默认 API 根(带版本段)。 */
const DEFAULT_API_BASE: Record<ProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434/v1',
}

/** 路径末尾的版本段:/v1、/v4、/v1beta、/v1alpha2 等。 */
const VERSION_SEGMENT = /\/v\d+(?:alpha|beta)?\d*$/i

function trimUrl(url: string | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

function toKind(type: string): ProviderKind {
  return type === 'anthropic' || type === 'google' || type === 'ollama' ? type : 'openai'
}

/**
 * Ollama 服务根地址(不含 /v1)。原生接口(/api/tags)挂在根下,OpenAI 兼容接口挂在 /v1 下。
 */
export function ollamaRootUrl(url: string | undefined): string {
  const trimmed = trimUrl(url).replace(/\/v1$/i, '')
  return trimmed || DEFAULT_API_BASE.ollama.replace(/\/v1$/, '')
}

/**
 * 规范化为带版本段的 API 根,供 SDK baseURL 与 `${base}/models` 等端点拼接:
 *   - openai / anthropic:无版本段时补 /v1(兼容端点自带 /v4 等版本段时保持原样)
 *   - google:无版本段时补 /v1beta
 *   - ollama:根地址 + /v1(输入带不带 /v1 均可)
 * 空 base_url 返回该类型的官方默认地址。未知类型按 openai 兼容处理。
 */
export function normalizeBaseUrl(type: string, url: string | undefined): string {
  const kind = toKind(type)
  if (kind === 'ollama') return `${ollamaRootUrl(url)}/v1`
  const trimmed = trimUrl(url)
  if (!trimmed) return DEFAULT_API_BASE[kind]
  if (VERSION_SEGMENT.test(trimmed)) return trimmed
  return `${trimmed}${kind === 'google' ? '/v1beta' : '/v1'}`
}

/** Anthropic API 的版本头;拉模型与连接测试都需要。 */
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * 各 provider 列模型接口的鉴权头:
 *   openai / ollama → Authorization: Bearer
 *   anthropic       → x-api-key + anthropic-version
 *   google          → x-goog-api-key(不把 key 放进 URL query)
 */
export function buildAuthHeaders(
  type: string,
  apiKey: string | null | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  const kind = toKind(type)
  if (kind === 'anthropic') headers['anthropic-version'] = ANTHROPIC_VERSION
  if (!apiKey) return headers
  if (kind === 'anthropic') headers['x-api-key'] = apiKey
  else if (kind === 'google') headers['x-goog-api-key'] = apiKey
  else headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

/** 列模型接口地址(连接测试与 fetchModels 共用)。 */
export function modelsEndpoint(type: string, url: string | undefined): string {
  if (toKind(type) === 'ollama') return `${ollamaRootUrl(url)}/api/tags`
  return `${normalizeBaseUrl(type, url)}/models`
}
