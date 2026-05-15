// src/main/loop/reflect/trajectory.ts —— 业务层: 轨迹摘要 helper
//
// 紧凑摘要最近 N 步, 控制 prompt 大小供便宜 model 消费。
// 不含 raw tool result (太大), 仅每步 1 行: text(120 char) + toolNames + err flag + finishReason
//
// 允许依赖: ../types
// 禁止依赖: ipc/*

import type { StepOutcome } from '../types'

export function summarizeTrajectory(steps: readonly StepOutcome[]): string {
  return steps
    .map((s, i) => {
      const text = s.stepText.slice(0, 120).replace(/\n/g, ' ')
      const tools = s.toolNames.length > 0 ? `tools=[${s.toolNames.join(',')}]` : 'no-tools'
      const err = s.allToolsFailed === true ? ' ALL_FAILED' : ''
      const finish = s.finishReason ?? '?'
      return `[${i}] ${text} | ${tools}${err} | finish=${finish}`
    })
    .join('\n')
}
