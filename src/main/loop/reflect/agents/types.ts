// src/main/loop/reflect/agents/types.ts —— 业务层: Reflect Agent 接口 + 调用包装
//
// 参考 src/main/memory/ShortTermMemory.ts 的压缩 agent 模式:
//   - 独立 system prompt (按场景细化规则)
//   - Zod schema 强制结构化输出
//   - generateObject 调用便宜 model
//   - timeout + abortSignal 双重保护
//   - 失败静默 (返 null) 不阻塞主流程
//
// 每个 reflect 场景一个 ReflectAgent 实例 (judge / correction / periodic / ...),
// 调用方 Reflector 仅负责"触发条件 + snapshot 构造 + outcome 消费"。
//
// 允许依赖: ai, zod, electron-log
// 禁止依赖: ipc/*

import { generateObject, type LanguageModel } from 'ai'
import type { z } from 'zod'
import log from 'electron-log'

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

/**
 * 通用 agent 调用包装 — generateObject + system/user prompt + timeout 三件套。
 *
 * 任何调用方失败回退到 null, 调用方应据此降级 (不阻塞主 turn)。
 */
export async function runReflectAgent<SNAPSHOT, RESULT>(
  agent: ReflectAgent<SNAPSHOT, RESULT>,
  snapshot: SNAPSHOT,
  model: LanguageModel,
  abortSignal: AbortSignal,
): Promise<RESULT | null> {
  const timeoutMs = agent.timeoutMs ?? 30_000
  const combinedSignal = AbortSignal.any([abortSignal, AbortSignal.timeout(timeoutMs)])
  try {
    const { object } = await generateObject({
      model,
      schema: agent.schema,
      messages: [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: agent.buildUserPrompt(snapshot) },
      ],
      maxOutputTokens: agent.maxOutputTokens,
      abortSignal: combinedSignal,
    })
    log.info(`[ReflectAgent/${agent.name}] succeeded`)
    return object
  } catch (err) {
    log.warn(`[ReflectAgent/${agent.name}] failed:`, err)
    return null
  }
}
