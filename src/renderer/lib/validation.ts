import type { ProviderType } from '../types/config'

export interface ValidationError {
  field: string
  message: string
}

const URL_REGEX = /^https?:\/\//

export function validateProviderName(name: string, existingNames: string[], selfId?: string): ValidationError | null {
  if (!name.trim()) {
    return { field: 'name', message: '名称不能为空' }
  }
  const others = existingNames.filter((n) => n !== selfId)
  if (others.includes(name.trim())) {
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

export function validateApiKeyRequired(type: ProviderType, apiKey: string): ValidationError | null {
  const requiresKey = type === 'openai' || type === 'anthropic' || type === 'google'
  if (requiresKey && !apiKey.trim()) {
    return { field: 'api_key', message: 'API Key 为必填项' }
  }
  return null
}

export function validateProviderForm(
  name: string,
  type: ProviderType,
  baseUrl: string,
  apiKey: string,
  existingNames: string[],
  selfId?: string
): ValidationError[] {
  const errors: ValidationError[] = []

  const nameErr = validateProviderName(name, existingNames, selfId)
  if (nameErr) errors.push(nameErr)

  const urlErr = validateBaseUrl(baseUrl)
  if (urlErr) errors.push(urlErr)

  const keyErr = validateApiKeyRequired(type, apiKey)
  if (keyErr) errors.push(keyErr)

  return errors
}
