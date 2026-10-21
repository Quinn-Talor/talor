// src/main/providers/middleware/index.ts — v4 Phase 1 middleware barrel + registry
//
// 把 Provider.middleware 字段(string[])映射到具体实现。
//
// 类型:
//   - fetch 拦截型(disable-thinking):返回 fetch 替代函数,在 adapter.createModel 内
//     传给 createOpenAI({ fetch }) 等 SDK provider 工厂
//   - SDK middleware 型(cost-tracking, request-logging):返回 LanguageModelMiddleware,
//     由本文件的 wrapModel 统一包装(traceMiddleware 在最外层,其后是这些)
//
// 因为两类机制不同,registry 分两组导出。

import log from 'electron-log'
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai'
import { buildDisableThinkingFetch } from './disable-thinking'
import { costTrackingMiddleware } from './cost-tracking'
import { requestLoggingMiddleware } from './request-logging'
import { traceMiddleware } from './trace'

export { buildDisableThinkingFetch, costTrackingMiddleware, requestLoggingMiddleware }

/**
 * SDK middleware 名 → LanguageModelMiddleware 实例 映射。
 * 这些通过 wrapLanguageModel 注入。
 */
const SDK_MIDDLEWARES: Record<string, LanguageModelMiddleware> = {
  'cost-tracking': costTrackingMiddleware,
  'request-logging': requestLoggingMiddleware,
}

/**
 * Provider.middleware 中只能出现这些名称。
 * 'disable-thinking' 走 fetch 拦截路径(单独处理),不在此表。
 */
export const KNOWN_MIDDLEWARE_NAMES = [
  'disable-thinking',
  'cost-tracking',
  'request-logging',
] as const

/**
 * 从 Provider.middleware 字段构造 SDK middleware 数组。
 * 未知名称记 warn 后忽略。
 */
export function buildSdkMiddlewares(names: string[] | undefined): LanguageModelMiddleware[] {
  if (!names || names.length === 0) return []
  const result: LanguageModelMiddleware[] = []
  for (const name of names) {
    if (name === 'disable-thinking') continue // fetch path,跳过
    const mw = SDK_MIDDLEWARES[name]
    if (!mw) {
      log.warn(`[middleware] unknown middleware "${name}", skipping`)
      continue
    }
    result.push(mw)
  }
  return result
}

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]['model']

/**
 * 所有 adapter 创建模型的唯一包装口:traceMiddleware 在最外层(每次调用尝试都经过它),
 * 其后是 provider.middleware 配置的 SDK 中间件,最内层是 adapter 自带的协议适配中间件
 * (`adapterMiddlewares`,如 Google 的 system 消息改写),紧贴底层模型生效。
 */
export function wrapModel(
  base: WrappableModel,
  middlewareNames: string[] | undefined,
  adapterMiddlewares: LanguageModelMiddleware[] = [],
): LanguageModel {
  return wrapLanguageModel({
    model: base,
    middleware: [traceMiddleware, ...buildSdkMiddlewares(middlewareNames), ...adapterMiddlewares],
  })
}

/**
 * 检查 Provider.middleware 是否启用了 'disable-thinking'。
 * adapter.createModel 据此决定要不要给 SDK provider factory 注入 fetch 拦截。
 */
export function shouldDisableThinking(names: string[] | undefined): boolean {
  return !!names?.includes('disable-thinking')
}
