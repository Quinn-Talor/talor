// src/main/loop/turn-end-policies/explicit-termination.ts — P1: 显式终止 block 优先
//
// LLM 通过 talor block 主声明终止意图 (done / need_input / blocked),
// 这是 J-SHOULD-2 协作矩阵中"LLM 自陈"的高优先级信号 — 系统直接信任,
// 不再进 judge 二审。
//
// 允许依赖: ./types, ../../../shared/talor-blocks/*
// 禁止依赖: ipc/*

import { parseTalorBlocks } from '@shared/talor-blocks/talor-block-parser'
import type { TalorBlockType } from '@shared/talor-blocks/talor-block-schema'
import type { PolicyContext, TurnEndDecision, TurnEndPolicy } from './types'
import type { StepOutcome } from '../types'

const TERMINAL_TYPES: ReadonlySet<TalorBlockType> = new Set(['done', 'need_input', 'blocked'])

export class ExplicitTerminationBlockPolicy implements TurnEndPolicy {
  readonly name = 'explicit-termination'

  async evaluate(outcome: StepOutcome, _ctx: PolicyContext): Promise<TurnEndDecision> {
    const { blocks } = parseTalorBlocks(outcome.stepText)
    const terminal = blocks.find((b) => TERMINAL_TYPES.has(b.type))
    if (!terminal) {
      return { action: 'no-opinion', reason: 'no terminal block (done/need_input/blocked)' }
    }
    return {
      action: 'final',
      exitReason: 'declared_final',
      reason: `LLM emitted ${terminal.type} block`,
    }
  }
}
