// src/main/prompt/plugins/MessagePlugin.ts — 业务层(prompt): Layer 7 Current Focus
//
// 独立注入 DB 中最末那一条消息到 prompt 末尾——权重最高的位置。
// 配合 MemoryPlugin 的"pop 末尾"逻辑:
//   - Memory 处理 allMessages[0..-2] (压缩/锚点/recent)
//   - Message 注入 allMessages[-1] (裸注入)
// 两者拼接后:
//   - SDK 看到的配对依然完整 (tool_use 在 Memory 末尾 ↔ tool_result 在 Message)
//   - 模型不会看到同一条消息两次
//   - 压缩判定不受当前 turn 影响

import log from 'electron-log'
import { messageRepo } from '../../repos/session-repo'
import { messagesToCoreMessages, estimateMessage } from '../../memory/types'
import type { PromptPlugin, PipelineContext, PluginResult } from '../types'

export class MessagePlugin implements PromptPlugin {
  name = 'MessagePlugin'

  async build(ctx: PipelineContext): Promise<PluginResult> {
    const all = messageRepo.listBySession(ctx.sessionId)
    if (all.length === 0) {
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    const last = all[all.length - 1]
    const coreMessages = messagesToCoreMessages([last])

    if (coreMessages.length === 0) {
      // messagesToCoreMessages 若返回空说明 last 消息无法转换(格式异常),保守跳过。
      log.warn(`[MessagePlugin] last message (id=${last.id}, role=${last.role}) converted to empty; skipping`)
      return { messages: [], tools: [], tokenEstimate: 0 }
    }

    return {
      messages: coreMessages,
      tools: [],
      tokenEstimate: estimateMessage(last),
    }
  }
}
