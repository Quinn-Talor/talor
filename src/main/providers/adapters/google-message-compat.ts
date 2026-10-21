// src/main/providers/adapters/google-message-compat.ts —— 业务层(providers): Gemini 消息形态适配
//
// Talor 的 prompt 在 current turn 之后追加 system 消息(运行时元 / reflect hint / DEGRADED 告警),
// 这是为保持 tool_use/tool_result 相邻与 Anthropic 前缀缓存刻意的排序(见 PromptPipeline)。
// @ai-sdk/google 的 convertToGoogleMessages 只接受开头的 system,遇到 user/assistant/tool 之后
// 的 system 直接抛 UnsupportedFunctionalityError。适配只在 Google 路径生效,两步:
//
//   1. middleware(transformParams):非前导 system 改写为 user 文本 `[system note] ...`,
//      与相邻 user 消息合并,不制造额外的 user 消息
//   2. fetch 拦截:请求体 contents 中相邻的 role=user 合并为一条多 part 的 user content。
//      tool 结果在 Gemini 线格式里也是 role=user(functionResponse part),其后的 note
//      在 SDK prompt 层无法并入 tool 消息,只能在线格式层合并;Gemini 对连续 user turn
//      并不保证接受,合并后与 SDK 自身"functionResponse + text 同一 content"的形态一致。
//
// 其他 provider 不经过这里,消息顺序保持原样。
//
// 允许依赖: ai(类型), electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { LanguageModelMiddleware } from 'ai'

type TransformParamsOptions = Parameters<NonNullable<LanguageModelMiddleware['transformParams']>>[0]
type ModelPrompt = TransformParamsOptions['params']['prompt']
type PromptMessage = ModelPrompt[number]
type UserMessage = Extract<PromptMessage, { role: 'user' }>
type UserPart = UserMessage['content'][number]

/** 非前导 system 改写为 user 文本时的前缀,让模型区分"系统旁注"与用户原话。 */
export const SYSTEM_NOTE_PREFIX = '[system note]'

/**
 * 保留开头连续的 system 消息;其后的 system 改写为 user 文本 part:
 * 前一条是 user 则追加到其末尾,否则开一条新 user 消息,并把紧随其后的 user 消息并入。
 * 输入不被修改。
 */
export function demoteNonLeadingSystemMessages(prompt: ModelPrompt): ModelPrompt {
  const out: PromptMessage[] = []
  // 由 note 新建的 user 消息(可被后续 user 消息并入)
  const synthetic = new Set<PromptMessage>()
  let leading = true
  let demoted = 0

  for (const msg of prompt) {
    if (msg.role === 'system' && leading) {
      out.push(msg)
      continue
    }
    leading = false
    const last = out[out.length - 1]

    if (msg.role === 'system') {
      demoted++
      const part: UserPart = { type: 'text', text: `${SYSTEM_NOTE_PREFIX} ${msg.content}` }
      if (last?.role === 'user') {
        const merged: UserMessage = { ...last, content: [...last.content, part] }
        out[out.length - 1] = merged
        if (synthetic.has(last)) {
          synthetic.delete(last)
          synthetic.add(merged)
        }
      } else {
        const created: UserMessage = { role: 'user', content: [part] }
        out.push(created)
        synthetic.add(created)
      }
      continue
    }

    if (msg.role === 'user' && last?.role === 'user' && synthetic.has(last)) {
      const merged: UserMessage = { ...msg, content: [...last.content, ...msg.content] }
      synthetic.delete(last)
      out[out.length - 1] = merged
      continue
    }

    out.push(msg)
  }

  if (demoted > 0) log.debug(`[google-compat] demoted ${demoted} non-leading system message(s)`)
  return out
}

export const googleSystemNoteMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => ({
    ...params,
    prompt: demoteNonLeadingSystemMessages(params.prompt),
  }),
}

interface GeminiContent {
  role?: string
  parts?: unknown[]
}

/** 合并 contents 中相邻的 role=user 条目(parts 依序拼接),返回新数组。 */
export function mergeAdjacentUserContents(contents: GeminiContent[]): GeminiContent[] {
  const out: GeminiContent[] = []
  for (const c of contents) {
    const last = out[out.length - 1]
    if (c.role === 'user' && last?.role === 'user') {
      out[out.length - 1] = { ...last, parts: [...(last.parts ?? []), ...(c.parts ?? [])] }
    } else {
      out.push(c)
    }
  }
  return out
}

/**
 * fetch 包装:JSON 请求体带 contents 数组时合并相邻 user content;其余请求原样透传。
 */
export function buildMergeUserTurnsFetch(
  baseFetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body) as { contents?: unknown }
        if (Array.isArray(body.contents)) {
          const merged = mergeAdjacentUserContents(body.contents as GeminiContent[])
          if (merged.length !== body.contents.length) {
            init = { ...init, body: JSON.stringify({ ...body, contents: merged }) }
          }
        }
      } catch {
        /* 非 JSON 请求体:原样透传 */
      }
    }
    return baseFetch(input, init)
  }
}
