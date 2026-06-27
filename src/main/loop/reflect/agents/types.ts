// src/main/loop/reflect/agents/types.ts —— 业务层: Reflect Agent 接口 + 调用包装
//
// 参考 src/main/memory/ShortTermMemory.ts 的压缩 agent 模式:
//   - 独立 system prompt (按场景细化规则)
//   - Zod schema 强制结构化输出
//   - generateText + 手动 JSON 解析 (跨 provider 兼容; 不依赖 response_format 特性 —
//     DeepSeek 等 provider 不支持 json_schema 模式, 用 generateObject 会失败)
//   - timeout + abortSignal 双重保护
//   - 失败静默 (返 null) 不阻塞主流程
//
// 每个 reflect 场景一个 ReflectAgent 实例 (judge / correction / periodic / ...),
// 调用方 Reflector 仅负责"触发条件 + snapshot 构造 + outcome 消费"。
//
// 允许依赖: ai, zod, electron-log
// 禁止依赖: ipc/*

import { generateText, type LanguageModel } from 'ai'
import type { z } from 'zod'
import log from 'electron-log'
import { recordUsage } from '../../../providers/usage-recorder'

/**
 * 反思 agent 接口 — 每场景一个实现。
 *
 * @typeParam SNAPSHOT  输入数据 (Reflector 构造的轨迹快照, 视场景而定)
 * @typeParam RESULT    结构化输出 (Zod schema 类型)
 */
export interface ReflectAgent<SNAPSHOT, RESULT> {
  /** Agent 标识 (e.g. 'judge-completion'), 用于日志 / ledger */
  readonly name: string
  /** Zod schema, 决定 RESULT 类型 */
  readonly schema: z.ZodSchema<RESULT>
  /** System prompt — 详细 rules 教 model 做这件事 */
  readonly systemPrompt: string
  /** 从 snapshot 构造 user prompt */
  buildUserPrompt(snapshot: SNAPSHOT): string
  /** 输出 tokens 上限 */
  readonly maxOutputTokens: number
  /** Timeout ms (默认 30s) */
  readonly timeoutMs?: number
}

const JSON_INSTRUCTION =
  '\n\nRespond ONLY with a valid JSON object matching the required schema. ' +
  'No markdown code fences. No prose before or after. Output starts with { and ends with }.'

/**
 * 通用 agent 调用包装 — generateText + 手动 JSON 解析 + Zod 校验。
 *
 * 任何调用方失败 (网络 / schema 不通过 / JSON 解析失败) 回退到 null, 调用方
 * 应据此降级 (不阻塞主 turn)。
 */
export async function runReflectAgent<SNAPSHOT, RESULT>(
  agent: ReflectAgent<SNAPSHOT, RESULT>,
  snapshot: SNAPSHOT,
  model: LanguageModel,
  abortSignal: AbortSignal,
  sessionId?: string,
): Promise<RESULT | null> {
  const timeoutMs = agent.timeoutMs ?? 30_000
  const combinedSignal = AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)])
  try {
    const res = await generateText({
      model,
      messages: [
        { role: 'system', content: agent.systemPrompt + JSON_INSTRUCTION },
        { role: 'user', content: agent.buildUserPrompt(snapshot) },
      ],
      maxOutputTokens: agent.maxOutputTokens,
      abortSignal: combinedSignal,
    })
    if (sessionId) {
      recordUsage(sessionId, res.usage, res.providerMetadata as Record<string, unknown> | undefined)
    }
    const text = res.text
    const cleaned = stripJsonFence(text)
    let parsed: unknown
    try {
      parsed = JSON.parse(cleaned)
    } catch (err) {
      log.warn(`[ReflectAgent/${agent.name}] JSON parse failed:`, err, 'raw:', text.slice(0, 200))
      return null
    }
    const validated = agent.schema.safeParse(parsed)
    if (!validated.success) {
      log.warn(`[ReflectAgent/${agent.name}] schema validation failed:`, validated.error.issues)
      return null
    }
    log.info(`[ReflectAgent/${agent.name}] succeeded`)
    return validated.data
  } catch (err) {
    log.warn(`[ReflectAgent/${agent.name}] failed:`, err)
    return null
  }
}

/**
 * 剥离可能存在的 markdown JSON 代码围栏 (```json ... ``` 或 ``` ... ```)。
 * Provider 即使被指示不要 fence, 中文 / reasoning 模型仍可能输出。
 */
function stripJsonFence(text: string): string {
  let s = text.trim()
  // 开头 fence
  s = s.replace(/^```(?:json)?\s*\n?/i, '')
  // 结尾 fence
  s = s.replace(/\n?```\s*$/, '')
  return s.trim()
}
