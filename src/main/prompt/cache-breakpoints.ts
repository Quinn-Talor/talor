// src/main/prompt/cache-breakpoints.ts — 业务层(prompt): Anthropic 前缀缓存断点
//
// Anthropic 不像 deepseek/openai/gemini 那样自动缓存前缀,必须用 cacheControl 显式
// 标"断点":服务端缓存"从请求头到该断点"的整段前缀,后续请求命中该前缀只按
// cache-read 计费(约 0.1x)。前提是前缀字节稳定 —— 这正是 append-only 分层
// (buildLayered)保证的:稳定层(system/agent/tools/history)连续在前、跨 build
// 字节一致,volatile(当前 turn / 运行时元 / hint)在尾。
//
// 在 Anthropic 请求里,内容顺序是 tools → system → messages。所以把断点标在最后一条
// "静态/稳定" message 上,会把它之前的一切(含 tools 定义)纳入缓存前缀。
//
// 标两个断点(Anthropic 上限 4 个):
//   1. static 边界(system/agent 末条 message):整段会话最稳定的部分 + tools 定义。
//      即便 history 被压缩重写(epoch / 上下文整理),该前缀仍命中。
//   2. history 边界(history 末条 message):随对话 append-only 增长;每轮在既有前缀
//      之上增量 cache-write,而 cache-read 命中上一轮的前缀。断点落在"当前 turn"
//      (volatile)之前 —— 当前 turn 每轮变,不该进缓存前缀。
//
// 仅 anthropic provider 调用;其他 provider 自动缓存,providerOptions.anthropic 会被
// 它们忽略,但为零歧义直接不标。

import type { ModelMessage } from 'ai'
import type { StabilityLayer } from './types'

/** 进入可缓存前缀的层。volatile 永远不标(每轮变)。 */
const STABLE_LAYERS: ReadonlySet<StabilityLayer> = new Set(['system', 'agent', 'tools', 'history'])
/** 整段会话静态的层(不含随对话增长的 history)。 */
const STATIC_LAYERS: ReadonlySet<StabilityLayer> = new Set(['system', 'agent', 'tools'])

type Segment = { layer: StabilityLayer; messages: ModelMessage[] }

/** 找最后一个 layer 命中 set 且非空的 segment 下标;无则 -1。 */
function lastSegmentIndexIn(segments: Segment[], layers: ReadonlySet<StabilityLayer>): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (layers.has(segments[i].layer) && segments[i].messages.length > 0) return i
  }
  return -1
}

/** 在 segment 末条 message 上打 Anthropic ephemeral 断点(合并已有 providerOptions)。 */
function markLastMessage(seg: Segment): void {
  const msg = seg.messages[seg.messages.length - 1]
  if (!msg) return
  const existing = (msg.providerOptions ?? {}) as Record<string, unknown>
  const existingAnthropic = (existing.anthropic ?? {}) as Record<string, unknown>
  msg.providerOptions = {
    ...existing,
    anthropic: {
      ...existingAnthropic,
      cacheControl: { type: 'ephemeral' },
    },
  }
}

/**
 * 给分层 segments 标 Anthropic 缓存断点(原地修改末条 message 的 providerOptions)。
 *
 * 断点 1:最后一个 static segment(system/agent)末条 —— 缓存 tools + 静态 system/agent。
 * 断点 2:最后一个 stable segment(含 history)末条 —— 缓存到对话历史末尾。
 * 两者同段(无 history)时只标一个,避免重复断点浪费配额。
 */
export function applyAnthropicCacheBreakpoints(segments: Segment[]): void {
  const staticIdx = lastSegmentIndexIn(segments, STATIC_LAYERS)
  const stableIdx = lastSegmentIndexIn(segments, STABLE_LAYERS)
  if (staticIdx >= 0) markLastMessage(segments[staticIdx])
  if (stableIdx >= 0 && stableIdx !== staticIdx) markLastMessage(segments[stableIdx])
}
