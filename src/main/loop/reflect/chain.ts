// src/main/loop/reflect/chain.ts —— 业务层: 三 phase 通用 reflector 调度器
//
// 主循环三处调用同一 runReflectorChain (phase 不同, reflectors 数组同):
//   pre-step:   runReflectorChain('pre-step', reflectors, preCtx, counters)
//   post-step:  runReflectorChain('post-step', reflectors, midCtx, counters)
//   turn-end:   runReflectorChain('turn-end', reflectors, endCtx, counters)
//
// Capability 驱动调度:
//   - phases 过滤: 不声明 phase 的 reflector 跳过
//   - maxPerTurn 检查: perTurnCounters 跟踪本 turn 已触发次数
//   - priority 排序: 数字小先跑 (默认 100)
//
// 第一个非 null 输出 wins, 后续 reflector 本次调用跳过 (返回结果带 from 标识)。
//
// 允许依赖: ./types, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectContext, ReflectorOutcome, ReflectPhase } from './types'

export interface ReflectorChainResult {
  kind: 'none' | 'hint' | 'wrap_up' | 'direct_output'
  from?: string
  hint?: string
  wrapUp?: ReflectorOutcome['wrapUp']
  directOutput?: ReflectorOutcome['directOutput']
}

export async function runReflectorChain(
  phase: ReflectPhase,
  reflectors: readonly Reflector[],
  ctx: ReflectContext,
  perTurnCounters: Map<string, number>,
): Promise<ReflectorChainResult> {
  const candidates = reflectors
    .filter((r) => r.capabilities.phases.includes(phase))
    .sort((a, b) => (a.capabilities.priority ?? 100) - (b.capabilities.priority ?? 100))

  for (const r of candidates) {
    const used = perTurnCounters.get(r.name) ?? 0
    if (r.capabilities.maxPerTurn !== undefined && used >= r.capabilities.maxPerTurn) {
      continue
    }

    const out = await r.reflect(ctx).catch((err) => {
      log.warn(`[Reflect/${r.name}] threw:`, err)
      return null
    })
    if (!out) continue

    perTurnCounters.set(r.name, used + 1)
    if (out.wrapUp) return { kind: 'wrap_up', from: r.name, wrapUp: out.wrapUp }
    if (out.directOutput) {
      return { kind: 'direct_output', from: r.name, directOutput: out.directOutput }
    }
    if (out.hint) return { kind: 'hint', from: r.name, hint: out.hint }
  }
  return { kind: 'none' }
}
