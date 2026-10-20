// src/main/observe/trace-context.ts —— 基础设施: Turn trace 的异步上下文
//
// 用 AsyncLocalStorage 保存当前 traceId、父 observation 与 generation 名称,让 LLM 中间件、
// 工具与 repo 不必层层传参就能拿到观测坐标。零依赖:repos(基础设施)与业务层都可 import。
//
// 允许依赖: node:async_hooks
// 禁止依赖: src/main 下任何模块

import { AsyncLocalStorage } from 'node:async_hooks'

/** 一条 observation 的坐标。 */
export interface ObservationRef {
  traceId: string
  observationId: string
}

export interface TraceScope {
  traceId: string
  /** 新 observation 默认挂在它下面;null 表示 trace 尚无可挂的父节点。 */
  parent: ObservationRef | null
  /** LLM 中间件给 GENERATION 取名用(如 'llm:main');未设置时用默认名。 */
  generationName?: string
}

const als = new AsyncLocalStorage<TraceScope>()

export function currentScope(): TraceScope | undefined {
  return als.getStore()
}

export function currentTraceId(): string | null {
  return als.getStore()?.traceId ?? null
}

export function currentParent(): ObservationRef | null {
  return als.getStore()?.parent ?? null
}

/** 在 scope 内执行 fn;scope 为 null(观测关闭)时直接执行。 */
export function runInScope<T>(scope: TraceScope | null, fn: () => T): T {
  return scope === null ? fn() : als.run(scope, fn)
}

/** 以 ref 为父执行 fn(换父时清掉 generationName);ref 为 null 时保持当前上下文。 */
export function withParent<T>(ref: ObservationRef | null, fn: () => T): T {
  return ref === null ? fn() : als.run({ traceId: ref.traceId, parent: ref }, fn)
}

/** 为 fn 内发起的模型调用设置 GENERATION 名称;无 scope 时直接执行。 */
export function withGenerationName<T>(name: string, fn: () => T): T {
  const scope = als.getStore()
  return scope === undefined ? fn() : als.run({ ...scope, generationName: name }, fn)
}
