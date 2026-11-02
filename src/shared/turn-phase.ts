// src/shared/turn-phase.ts — 主进程与渲染端共用：一步文本的显示身份（过程 / 答复）与运行状态
//
// 引擎路径落库时，在文本片段与 tool-call 片段的 `providerOptions.talor.phase` 标阶段；旧路径写的行
// 没有标记，渲染端据此保持旧显示。reasoning 片段的 providerOptions 是厂商回放数据，不标。
//
// 无 Node / DOM 依赖。

export type TurnPhase = 'process' | 'answer'
export type RunStatus = 'verifying' | 'idle'

export function phaseMarker(phase: TurnPhase): { talor: { phase: TurnPhase } } {
  return { talor: { phase } }
}

/** 第一个带合法阶段标记的文本或 tool-call 片段的阶段；没有则 null（旧路径写的行）。 */
export function phaseOfParts(parts: unknown[]): TurnPhase | null {
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const { type, providerOptions } = part as { type?: unknown; providerOptions?: unknown }
    if (type !== 'text' && type !== 'tool-call') continue
    const phase = (providerOptions as { talor?: { phase?: unknown } } | null | undefined)?.talor
      ?.phase
    if (phase === 'process' || phase === 'answer') return phase
  }
  return null
}
