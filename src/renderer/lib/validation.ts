import type { ProviderType } from '../types/config'

export interface ValidationError {
  field: string
  message: string
}

const URL_REGEX = /^https?:\/\//

/** otherNames:除正在编辑的 provider 自身之外的已有名称 */
export function validateProviderName(name: string, otherNames: string[]): ValidationError | null {
  if (!name.trim()) {
    return { field: 'name', message: '名称不能为空' }
  }
  if (otherNames.includes(name.trim())) {
    return { field: 'name', message: '该名称已存在，请使用其他名称' }
  }
  return null
}

export function validateBaseUrl(url: string): ValidationError | null {
  if (!url.trim()) {
    return { field: 'base_url', message: 'base_url 不能为空' }
  }
  if (!URL_REGEX.test(url.trim())) {
    return { field: 'base_url', message: 'URL 格式无效，请以 http:// 或 https:// 开头' }
  }
  return null
}

/** hasStoredKey:编辑已有 provider 时 key 已存于主进程,留空表示保持不变 */
export function validateApiKeyRequired(
  type: ProviderType,
  apiKey: string,
  hasStoredKey = false,
): ValidationError | null {
  const requiresKey = type === 'openai' || type === 'anthropic' || type === 'google'
  if (requiresKey && !hasStoredKey && !apiKey.trim()) {
    return { field: 'api_key', message: 'API Key 为必填项' }
  }
  return null
}

export function validateProviderForm(
  name: string,
  type: ProviderType,
  baseUrl: string,
  apiKey: string,
  otherNames: string[],
  hasStoredKey = false,
): ValidationError[] {
  const errors: ValidationError[] = []

  const nameErr = validateProviderName(name, otherNames)
  if (nameErr) errors.push(nameErr)

  const urlErr = validateBaseUrl(baseUrl)
  if (urlErr) errors.push(urlErr)

  const keyErr = validateApiKeyRequired(type, apiKey, hasStoredKey)
  if (keyErr) errors.push(keyErr)

  return errors
}
