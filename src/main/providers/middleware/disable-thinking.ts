// src/main/providers/middleware/disable-thinking.ts — v4 Phase 1
//
// 替代 openai-adapter.ts 内的 createDeepSeekFetch 函数 — 但形态改用"fetch wrapper",
// 因为 DeepSeek 的 `thinking: { type: 'disabled' }` 是 provider-specific 非标准字段,
// SDK 的 LanguageModelV3Middleware.transformParams 通道无法透传(SDK 会过滤未知 providerOptions)。
//
// 因此本 middleware 通过 fetch 层拦截 + 修改 body,与原 createDeepSeekFetch 等价。
// 但放在 middleware/ 目录下统一管理,避免 fetch 拦截散落在 adapter 内。
//
// 何时启用:Provider.middleware 包含 'disable-thinking' 时,createModel 把 buildDisableThinkingFetch()
// 作为 fetch 注入到 createOpenAI({ fetch })。
//
// 为何不能用 LanguageModelV3Middleware.transformParams:
//   SDK 把 providerOptions 透传给 provider 的 doGenerate/doStream,但每个 provider 实现
//   自己定义"哪些 providerOptions 字段是合法的"。DeepSeek 的 `thinking` 不在 openai
//   provider 实现的合法字段表里,SDK 会忽略。fetch 层拦截绕过 SDK 抽象直接改 raw body。

import log from 'electron-log'

/**
 * 工厂函数 — 返回一个 fetch 替代函数,在请求 body 里注入
 * `thinking: { type: 'disabled' }` 并删除 `reasoning_effort`。
 *
 * 用于 DeepSeek V3 Reasoner / V4 Flash 等强制 thinking 的 model,
 * 让 reasoning 不占用 max_output_tokens 预算。
 */
export function buildDisableThinkingFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body)
        body.thinking = { type: 'disabled' }
        delete body.reasoning_effort
        init = { ...init, body: JSON.stringify(body) }
        log.debug('[disable-thinking] injected thinking=disabled into request body')
      } catch {
        /* not JSON, pass through unchanged */
      }
    }
    return baseFetch(input, init)
  }
}
