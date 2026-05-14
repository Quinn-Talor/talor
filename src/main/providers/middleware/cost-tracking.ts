// src/main/providers/middleware/cost-tracking.ts — v4 Phase 1
//
// 真正的 LanguageModelV3Middleware — 通过 wrapStream/wrapGenerate hook 观察每次 LLM
// 调用的 usage,记录到 electron-log。后续 v4.1 可改为入 Ledger 形成 cost dashboard。
//
// 为什么用 middleware 而不是 streamText.onFinish:
//   - middleware 在 model 层附加,对所有 streamText/generateText/generateObject 自动生效
//   - 不需要每个调用点显式接 onFinish
//   - 适合"横切关注点"(cross-cutting concern)
//
// 当前 PR 1 仅 log;v4.1 把 usage 入 SideEffectLedger 新加的 'usage' op 类型。

import log from 'electron-log'
import type { LanguageModelMiddleware } from 'ai'

export const costTrackingMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',

  async wrapStream({ doStream, model }) {
    const start = Date.now()
    const result = await doStream()
    // SDK 的 stream 是 promise of result;result.stream 还需要消费才能拿到最终 usage。
    // 这里只能在外层(streamText 调用方)通过 onFinish 拿 usage,middleware 拿不到。
    // 改造方式:把 result.stream 套一层 transform,sniff 最后的 finish chunk。
    //
    // 简化版:仅记录 stream 启动,不拿 usage(否则需要 transform stream,复杂度高)。
    log.info(
      `[cost-tracking] stream started — model=${model.modelId} ` +
        `provider=${model.provider} (usage 待 streamText.onFinish 上报)`,
    )
    return {
      ...result,
      stream: result.stream.pipeThrough(
        new TransformStream({
          transform(chunk, controller) {
            // 仅观察 finish 部分,sniff 出 usage
            if (chunk.type === 'finish') {
              const elapsed = Date.now() - start
              const usage = (chunk as { usage?: unknown }).usage
              log.info(
                `[cost-tracking] stream finished — elapsed=${elapsed}ms ` +
                  `usage=${JSON.stringify(usage)}`,
              )
            }
            controller.enqueue(chunk)
          },
        }),
      ),
    }
  },

  async wrapGenerate({ doGenerate, model }) {
    const start = Date.now()
    const result = await doGenerate()
    const elapsed = Date.now() - start
    log.info(
      `[cost-tracking] generate done — model=${model.modelId} ` +
        `provider=${model.provider} elapsed=${elapsed}ms ` +
        `usage=${JSON.stringify(result.usage)}`,
    )
    return result
  },
}
