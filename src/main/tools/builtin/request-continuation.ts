// src/main/tools/builtin/request-continuation.ts — v4 Phase 4a virtual tool
//
// 替代 v3.7.3 引入的 pending_continuation talor block。
//
// 设计:
//   LLM 想表达"我承诺还要做某事但本 step 暂未动手"时,调用本工具。
//   SDK 视为有 tool call → 自动续 loop (无需特殊 Policy 消费 talor block fence)。
//
// 与 v3.7.3 pending_continuation block 的等价性:
//   v3.7.3:  text 内 emit ```talor {"type":"pending_continuation"} ```
//            → parseTalorBlocks → PendingContinuationBlockPolicy → continue loop
//   v4 :     调用 request_continuation tool
//            → SDK 视为 tool call,自然续 loop
//            → tool execute 仅返 ack,不做实际工作
//
// 防滥用: SDK 内置 stopWhen stepCountIs + 已有的 ToolOnlyLoopDetector
// (连续 N 步纯工具不输出文本) 替代旧 ContinuationChainDetector。
//
// 见 docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md §4.2

import { z } from 'zod'
import log from 'electron-log'
import { toolRegistry } from '../registry'
import type { ToolExecuteContext } from '../types'

const RequestContinuationInput = z.object({
  reason: z
    .string()
    .optional()
    .describe(
      'Optional one-line reason for the continuation, for UI display and audit. ' +
        'Example: "data collected, ready to persist".',
    ),
})
type RequestContinuationInputT = z.infer<typeof RequestContinuationInput>

const requestContinuationTool = {
  name: 'request_continuation',
  description:
    'Signal that you intend to perform an action in the NEXT step (not in this turn). ' +
    'Call this when you want the framework to continue the loop after a planning/' +
    'summary step that has NO concrete tool call yet. ' +
    "The framework will call you again in the next step where you should execute the action you'd deferred. " +
    'Use sparingly — prefer executing tools directly in the current step when possible.',
  zodSchema: RequestContinuationInput,
  parameters: z.toJSONSchema(RequestContinuationInput) as Record<string, unknown>,
  riskLevel: 'LOW' as const,

  execute: async (input: unknown, _ctx: ToolExecuteContext) => {
    const { reason } = input as RequestContinuationInputT
    log.info(`[request_continuation] LLM signaled continuation${reason ? `: ${reason}` : ''}`)
    return {
      output: {
        acknowledged: true,
        reason: reason ?? null,
        note: 'Framework will continue the loop. Execute the deferred action in the next step.',
      },
    }
  },
}

export function registerBuiltinTools(): void {
  toolRegistry.register(requestContinuationTool)
}
