// src/main/chat/stream-registry.ts —— 业务层（chat 领域）：活跃流注册表
//
// 职责：维护 sessionId → (AbortController, messageId) 映射，落实两条策略：
//   - 同 session 新请求到来时自动 abort 上一次请求（避免两条流并发写同一会话）
//   - 外部主动 abort（如用户点"停止"按钮，从 ipc/chat.ts 的 chat:abort handler 调入）
//
// 允许依赖：shared/*（无）
// 禁止依赖：ipc/* 的运行时代码
//
// 单例：模块级 Map。main 进程单实例，无并发 import 风险；进程退出时随之释放。

import log from 'electron-log'

interface ActiveStream {
  abortController: AbortController
  messageId: string
}

const activeStreams = new Map<string, ActiveStream>()

export const streamRegistry = {
  /**
   * 为指定 session 注册新的 AbortController。
   *
   * 若该 session 已有活跃流：先 abort 并从 Map 中删除旧条目，再注册新的。
   * 这样可以保证同一 session 永远只有一条并发流，消息落库顺序不会错乱。
   *
   * 返回调用方持有的 AbortController —— 调用方通过 `.signal` 传给 streamText，
   * 通过 `.abort()` 主动停止（实际上用 streamRegistry.abort 更合适）。
   */
  register(sessionId: string, messageId: string): AbortController {
    const existing = activeStreams.get(sessionId)
    if (existing) {
      existing.abortController.abort()
      activeStreams.delete(sessionId)
      log.info('[streamRegistry] Aborted previous stream for session:', sessionId)
    }
    const abortController = new AbortController()
    activeStreams.set(sessionId, { abortController, messageId })
    return abortController
  },

  /**
   * 主动中止指定 session 的活跃流。
   * 不存在时静默返回（用户可能在流已结束后才点"停止"，属于正常竞态）。
   */
  abort(sessionId: string): void {
    const stream = activeStreams.get(sessionId)
    if (!stream) return
    stream.abortController.abort()
    activeStreams.delete(sessionId)
    log.info('[streamRegistry] Aborted session:', sessionId)
  },

  /**
   * 从注册表移除条目（不触发 abort）。
   * 正常结束（流自然完成）时在 finally 中调用。幂等，重复调用安全。
   */
  cleanup(sessionId: string): void {
    activeStreams.delete(sessionId)
  },
}
