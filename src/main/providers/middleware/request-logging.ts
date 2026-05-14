// src/main/providers/middleware/request-logging.ts — v4 Phase 1
//
// dev mode 详细日志 — 通过 LanguageModelV3Middleware.transformParams 在每次请求前 log
// 调用参数(model / temperature / maxOutputTokens / messages 数 / tool 数 等)。
//
// 仅 NODE_ENV !== 'production' 时启用,避免生产环境日志膨胀。
//
// 用途:开发期排查 provider 调用参数 / max_tokens 配置 / system prompt 内容。

import log from 'electron-log'
import type { LanguageModelMiddleware } from 'ai'

const isDev = process.env.NODE_ENV !== 'production'

export const requestLoggingMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  async transformParams({ type, params, model }) {
    if (!isDev) return params

    const messageCount = Array.isArray(params.prompt) ? params.prompt.length : 0
    const toolCount = params.tools?.length ?? 0
    const maxTokens = params.maxOutputTokens ?? '?'
    const temperature = params.temperature ?? 'default'

    log.debug(
      `[request-logging] ${type} call: ` +
        `model=${model.modelId} provider=${model.provider} ` +
        `messages=${messageCount} tools=${toolCount} ` +
        `maxOutputTokens=${maxTokens} temperature=${temperature}`,
    )
    return params
  },
}
