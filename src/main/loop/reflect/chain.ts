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
// 观测: 每个被评估的 reflector 记一条 guard observation (guard:<name>; capabilities.usesLlm
// 为 EVALUATOR, 否则 GUARDRAIL), reflect() 内的模型调用挂在它下面; 因 maxPerTurn 跳过的
// 记一条 DEBUG 级 guard.skipped 事件。
//
// 允许依赖: ./types, ../../observe/*, electron-log
// 禁止依赖: ipc/*

import log from 'electron-log'
import type { Reflector, ReflectContext, ReflectorOutcome, ReflectPhase } from './types'
import { withParent } from '../../observe/trace-context'
import { traceRecorder } from '../../observe/trace-recorder'

type OutcomeKind = 'none' | 'hint' | 'wrap_up' | 'internal_nudge' | 'user_output'

function outcomeKind(out: ReflectorOutcome): OutcomeKind {
  if (out.wrapUp) return 'wrap_up'
  if (out.userOutput) return 'user_output'
  if (out.internalNudge) return 'internal_nudge'
  if (out.hint) return 'hint'
  return 'none'
}

export interface ReflectorChainResult {
  kind: OutcomeKind
  from?: string
  hint?: string
  wrapUp?: ReflectorOutcome['wrapUp']
  internalNudge?: ReflectorOutcome['internalNudge']
  userOutput?: ReflectorOutcome['userOutput']
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
      traceRecorder.event({
        name: 'guard.skipped',
        level: 'DEBUG',
        metadata: { reflector: r.name, phase, used },
      })
      continue
    }

    // 注入 perTurnIndex/perTurnLimit 让 reflector 可以在 user-facing text 中
    // 标注 "Supervision check N/M" 之类的 counter, 让主 LLM 知道边界。
    const ctxWithCounter = {
      ...ctx,
      perTurnIndex: used + 1,
      perTurnLimit: r.capabilities.maxPerTurn,
    } as ReflectContext
    const guard = traceRecorder.startObservation({
      type: r.capabilities.usesLlm ? 'EVALUATOR' : 'GUARDRAIL',
      name: `guard:${r.name}`,
      metadata: { phase, per_turn_index: used + 1 },
    })
    let out: ReflectorOutcome | null
    try {
      out = await withParent(guard.ref, () => r.reflect(ctxWithCounter))
    } catch (err) {
      log.warn(`[Reflect/${r.name}] threw:`, err)
      guard.end({ level: 'ERROR', statusMessage: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (!out) {
      guard.end({ level: 'DEBUG', metadata: { outcome: 'none' } })
      continue
    }
    const kind = outcomeKind(out)
    guard.end({
      level: kind === 'wrap_up' || kind === 'user_output' ? 'WARNING' : 'DEFAULT',
      output: out.userOutput?.text ?? out.internalNudge?.text ?? out.hint ?? null,
      metadata: { outcome: kind },
    })

    perTurnCounters.set(r.name, used + 1)
    if (out.wrapUp) return { kind: 'wrap_up', from: r.name, wrapUp: out.wrapUp }
    if (out.userOutput) {
      return { kind: 'user_output', from: r.name, userOutput: out.userOutput }
    }
    if (out.internalNudge) {
      return { kind: 'internal_nudge', from: r.name, internalNudge: out.internalNudge }
    }
    if (out.hint) return { kind: 'hint', from: r.name, hint: out.hint }
  }
  return { kind: 'none' }
}
