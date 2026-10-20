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

/** "输入 = 非缓存 + 缓存读 + 缓存写,输出 = 文本 + 推理"(列表行与头部的合计口径)。 */
export function usageInOut(u: UsageTotals): { input: number; output: number } {
  return {
    input: u.input + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    output: u.output + u.output_reasoning_tokens,
  }
}

/** trace 总耗时;未结束为 running。 */
export function formatTraceDuration(timestamp: string, endTime: string | null): string {
  if (endTime === null) return 'running'
  const ms = Date.parse(endTime) - Date.parse(timestamp)
  return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '—'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export interface PromptRef {
  hash: string
  bytes: number
}

/** GENERATION input 的索引形状(见 traceRecorder.serializePrompt)。 */
export interface PromptIndex {
  messages: Array<PromptRef & { role: string }>
  tools?: PromptRef & { count: number }
}

function isRef(v: unknown): v is PromptRef {
  return (
    v !== null &&
    typeof v === 'object' &&
    typeof (v as PromptRef).hash === 'string' &&
    typeof (v as PromptRef).bytes === 'number'
  )
}

/** 解析 GENERATION input 为索引;不是索引形状(普通 input / 非 JSON)返回 null。 */
export function parsePromptIndex(input: string | null): PromptIndex | null {
  if (input === null) return null
  let v: unknown
  try {
    v = JSON.parse(input)
  } catch {
    // 非 JSON 的 input 不是索引
    return null
  }
  const raw = (v as { messages?: unknown; tools?: unknown } | null) ?? {}
  if (!Array.isArray(raw.messages)) return null
  const messages = raw.messages.filter(
    (m): m is PromptRef & { role: string } =>
      isRef(m) && typeof (m as { role?: unknown }).role === 'string',
  )
  const tools = raw.tools
  return isRef(tools) && typeof (tools as { count?: unknown }).count === 'number'
    ? { messages, tools: tools as PromptRef & { count: number } }
    : { messages }
}

export interface PromptPart {
  kind: 'message' | 'tools'
  label: string
  hash: string
  bytes: number
  /** 占本次模型输入(消息 + 工具定义)总字节的比例,0–1 */
  share: number
}

/** 模型输入构成:逐条消息 + 工具定义,各自字节与占比(工具定义常是大头)。 */
export function promptComposition(index: PromptIndex): PromptPart[] {
  const parts: Array<Omit<PromptPart, 'share'>> = index.messages.map((m) => ({
    kind: 'message',
    label: m.role,
    hash: m.hash,
    bytes: m.bytes,
  }))
  if (index.tools) {
    parts.push({
      kind: 'tools',
      label: `tools ×${index.tools.count}`,
      hash: index.tools.hash,
      bytes: index.tools.bytes,
    })
  }
  const total = parts.reduce((sum, p) => sum + p.bytes, 0)
  return parts.map((p) => ({ ...p, share: total > 0 ? p.bytes / total : 0 }))
}

/** 工具定义 blob → 每个工具定义的字节数,大的在前(看哪些工具最占 token)。 */
export function toolDefinitionSizes(content: string): Array<{ name: string; bytes: number }> {
  let v: unknown
  try {
    v = JSON.parse(content)
  } catch {
    // 截断或损坏的 blob 不展示明细
    return []
  }
  if (!Array.isArray(v)) return []
  const encoder = new TextEncoder()
  return v
    .filter(
      (d): d is { name: string } =>
        d !== null && typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string',
    )
    .map((d) => ({ name: d.name, bytes: encoder.encode(JSON.stringify(d)).length }))
    .sort((a, b) => b.bytes - a.bytes)
}

/** 展示 payload:JSON 字符串值按原文(去引号、真换行),对象 / 数组缩进,非 JSON 原样。 */
export function prettyPayload(raw: string | null): string {
  if (raw === null) return ''
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    // 非 JSON 文本原样展示
    return raw
  }
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
}

/** GENERATION 行上的 token 徽标:输入含缓存,输出含推理;其余类型或无用量时 null。 */
export function generationTokens(o: ObservationRecord): { input: number; output: number } | null {
  if (o.type !== 'GENERATION' || o.usage_details === null) return null
  const u = o.usage_details
  return usageInOut({
    input: u.input ?? 0,
    output: u.output ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    output_reasoning_tokens: u.output_reasoning_tokens ?? 0,
  })
}
