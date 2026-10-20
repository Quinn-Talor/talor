// src/renderer/components/trace/trace-tree.ts — 渲染层纯逻辑: observation 列表 → 树
//
// TracePanel / TraceTree 共用;无 React 依赖,便于单测。

import type { ObservationRecord, TraceSummary } from '@shared/types/trace'

export interface ObservationNode {
  observation: ObservationRecord
  children: ObservationNode[]
  /** end_time - start_time(ms);未结束为 null */
  durationMs: number | null
}

/** 用量五桶,与 trace 列表行的 usage 同形。 */
export type UsageTotals = TraceSummary['usage']

function durationOf(o: ObservationRecord): number | null {
  if (o.end_time === null) return null
  const ms = Date.parse(o.end_time) - Date.parse(o.start_time)
  return Number.isFinite(ms) ? ms : null
}

/** 以 parent_observation_id 建树;父不存在的节点作为根;同级按 start_time 升序。 */
export function buildObservationTree(observations: ObservationRecord[]): ObservationNode[] {
  const nodes = new Map<string, ObservationNode>()
  for (const o of observations) {
    nodes.set(o.id, { observation: o, children: [], durationMs: durationOf(o) })
  }
  const roots: ObservationNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.observation.parent_observation_id
    const parent = parentId === null ? undefined : nodes.get(parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const byStart = (a: ObservationNode, b: ObservationNode): number =>
    a.observation.start_time.localeCompare(b.observation.start_time)
  const sortDeep = (list: ObservationNode[]): void => {
    list.sort(byStart)
    for (const n of list) sortDeep(n.children)
  }
  sortDeep(roots)
  return roots
}

/** 展示用节点:可见子节点 + 是否作为灰显的上下文行。 */
export interface DisplayNode {
  observation: ObservationRecord
  durationMs: number | null
  children: DisplayNode[]
  /** 本身是 DEBUG,但有可见后代而保留(隐藏 DEBUG 时作为上下文行灰显) */
  dimmed: boolean
}

/**
 * 按"显示 DEBUG"开关过滤树。隐藏 DEBUG 时只藏 DEBUG 节点本身:它若有可见后代
 * (如 DEBUG 守卫下的模型调用)则保留为灰显上下文行,不连带藏掉后代。
 */
export function visibleTree(roots: ObservationNode[], showDebug: boolean): DisplayNode[] {
  const result: DisplayNode[] = []
  for (const node of roots) {
    const children = visibleTree(node.children, showDebug)
    const isDebug = node.observation.level === 'DEBUG'
    if (showDebug || !isDebug || children.length > 0) {
      result.push({
        observation: node.observation,
        durationMs: node.durationMs,
        children,
        dimmed: !showDebug && isDebug,
      })
    }
  }
  return result
}

/** 行标题:react.step 按 metadata.step_index 编号(1 起),其余原名。 */
export function displayName(o: ObservationRecord): string {
  const index = o.metadata.step_index
  return o.name === 'react.step' && typeof index === 'number' ? `${o.name} #${index + 1}` : o.name
}

/** 全部 GENERATION 的用量五桶之和(trace 面板头部展示)。 */
export function usageTotals(observations: ObservationRecord[]): UsageTotals {
  const totals: UsageTotals = {
    input: 0,
    output: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_reasoning_tokens: 0,
  }
  for (const o of observations) {
    if (o.type !== 'GENERATION' || o.usage_details === null) continue
    for (const key of Object.keys(totals) as Array<keyof UsageTotals>) {
      totals[key] += o.usage_details[key] ?? 0
    }
  }
  return totals
}
