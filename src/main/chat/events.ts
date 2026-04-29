// src/main/chat/events.ts — 业务层：一次 sendChat 执行期间的事件总线
//
// 职责：子系统之间解耦的状态通知流（observer 模式）。
// 与 AbortSignal 并行：AbortSignal 负责"必须停下来"，事件总线负责"发生了什么"。
//
// 生命周期：每次 sendChat 创建一个新实例，请求结束随栈销毁，订阅无需手动注销。

import log from 'electron-log'

/**
 * 执行期事件。使用命名空间前缀（memory.* / step.* / tool.* 等）分类。
 * 新增事件类型时追加到此 union，订阅方通过 type 自动获得精确类型收窄。
 */
export type ExecutionEvent =
  | { type: 'memory.compressed'; coveredUntilMessageId: string }

export type ExecutionEventType = ExecutionEvent['type']

export class ExecutionEventBus {
  private listeners = new Map<ExecutionEventType, Set<(e: ExecutionEvent) => void>>()

  on<T extends ExecutionEventType>(
    type: T,
    listener: (event: Extract<ExecutionEvent, { type: T }>) => void,
  ): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener as (e: ExecutionEvent) => void)
  }

  emit(event: ExecutionEvent): void {
    const set = this.listeners.get(event.type)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch (err) {
        log.warn(`[EventBus] listener of "${event.type}" threw`, err)
      }
    }
  }
}
