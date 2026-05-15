// src/main/loop/reflect/agents/friendly-halt-agent.ts —— 业务层: context overflow 友好兜底 agent
//
// 场景: prompt token 估算超 context_limit, 不能继续 streamText。
// 系统硬编码 [auto-halt] 文案太机械, 用便宜 model 产出贴合用户请求的友好解释 +
// 已完成 / 待继续建议。

import { z } from 'zod'
import type { ReflectAgent } from './types'

export const FriendlyHaltSchema = z.object({
  friendlyMessage: z
    .string()
    .describe('User-facing explanation: what likely got done, what is incomplete, how to proceed'),
})

export type FriendlyHaltResult = z.infer<typeof FriendlyHaltSchema>

export interface FriendlyHaltSnapshot {
  userIntent: string
  estimatedTokens: number
  contextLimit: number
}

export const FriendlyHaltAgent: ReflectAgent<FriendlyHaltSnapshot, FriendlyHaltResult> = {
  name: 'friendly-halt',
  schema: FriendlyHaltSchema,
  systemPrompt:
    `You are explaining to a user why their AI agent had to halt mid-task. Rules:\n` +
    `1. The agent's context budget is exhausted (prompt too large for next step).\n` +
    `2. Acknowledge what the agent likely completed already (be specific if user request hints at it).\n` +
    `3. State what's still pending and why halting now (token budget, not user error).\n` +
    `4. Suggest concrete next steps (start a new session / trim history / split the request).\n` +
    `5. Be terse — 2-3 sentences total. Friendly but factual.`,
  buildUserPrompt: (s) =>
    `Original user request:\n"""\n${s.userIntent}\n"""\n\n` +
    `Token budget: ${s.estimatedTokens} / ${s.contextLimit} (` +
    `${((s.estimatedTokens / s.contextLimit) * 100).toFixed(0)}%). ` +
    `Produce friendly halt message.`,
  maxOutputTokens: 600,
  timeoutMs: 20_000,
}
