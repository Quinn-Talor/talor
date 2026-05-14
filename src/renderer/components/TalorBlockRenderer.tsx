// src/renderer/components/TalorBlockRenderer.tsx —— renderer 组件:
//
// 把 message text 内的 ```talor JSONC fence 替换为对应的语义化卡片。
// 5 个 V1 块类型: done / need_input / blocked / pending_confirm / warning。
//
// 用法: 在 MessageBubble 渲染前调用 splitMessageWithTalorBlocks(text)
// 切片, 然后对每个 segment 决定渲染成 markdown 还是 card。
//
// 设计原则:
//   - 即使 JSONC 解析失败也降级显示原 fence 为代码块,不阻断流式渲染
//   - 卡片仅显示 LLM 给的字段, 不调用任何 API (纯展示)
//   - 配色与 PermissionsPopover 现有 amber/red/blue 体系一致, 不引入新色系

import type {
  TalorBlock,
  DoneBlock,
  NeedInputBlock,
  BlockedBlock,
  PendingConfirmBlock,
  WarningBlock,
} from '@shared/talor-blocks/talor-block-schema'
import { parseTalorBlocks, detectStreamingTalorType } from '@shared/talor-blocks/talor-block-parser'

/** TalorBlock fence 围栏 regex —— 必须与 parser 保持一致。 */
const TALOR_FENCE_RE = /```talor[ \t]*\n[\s\S]+?\n[ \t]*```/g

/**
 * 未闭合 talor fence — 流式中 fence 还没流完时匹配。
 *
 * 用于流式骨架: text 末尾出现 ```talor + 内容 (无闭合) 时, 可以靠 type 字段提前
 * 决定骨架类型, 用户立刻看到"模型正要发什么类型的 block"。
 *
 * 限定 `$` 锚定到文本末尾 — 中段的 ```talor 必须有闭合,否则后续 fence 全部
 * 被吞掉。这是流式特性,只有最后一个开标可能未闭合。
 */
const UNCLOSED_TALOR_FENCE_RE = /```talor[ \t]*\n([\s\S]*)$/

export interface MessageSegment {
  type: 'markdown' | 'talor' | 'invalid-talor' | 'streaming-talor'
  /** type=markdown: 原始 text 片段; type=talor: 已解析的 block; type=invalid-talor: 原 fence 内容; type=streaming-talor: 仅 streamingType 有意义 */
  content: string
  block?: TalorBlock
  /** streaming-talor 专用: 已从未闭合 fence 中提取出的 type 字段 (可能为 null) */
  streamingType?: string | null
}

/**
 * 把 message text 切成 markdown 段 + talor block 段交替序列。
 *
 * - 找到所有 ```talor fence 边界
 * - fence 间的文本作为 markdown 段
 * - fence 内容尝试 parseTalorBlocks; 成功→talor 段, 失败→invalid-talor 段
 *
 * 流式中 stepText 可能含未闭合 fence — regex 不匹配未闭合, 该 fence 保留在
 * trailing markdown 段中, 渲染为半成品代码块 (用户能看到模型正在打字)。
 */
export function splitMessageWithTalorBlocks(text: string): MessageSegment[] {
  if (!text) return [{ type: 'markdown', content: '' }]

  const segments: MessageSegment[] = []
  let lastIdx = 0

  for (const match of text.matchAll(TALOR_FENCE_RE)) {
    const fenceStart = match.index ?? 0
    const fenceEnd = fenceStart + match[0].length

    // fence 前的 markdown 段
    if (fenceStart > lastIdx) {
      segments.push({ type: 'markdown', content: text.slice(lastIdx, fenceStart) })
    }

    // 解析 fence
    const fenceText = match[0]
    const { blocks } = parseTalorBlocks(fenceText)
    if (blocks.length === 1) {
      segments.push({ type: 'talor', content: fenceText, block: blocks[0] })
    } else {
      // 解析失败或不是单 block (理论上 fence 只含 1 个 block, 但保守降级)
      segments.push({ type: 'invalid-talor', content: fenceText })
    }

    lastIdx = fenceEnd
  }

  // 尾部 — 可能包含未闭合的流式 talor fence
  if (lastIdx < text.length) {
    const tail = text.slice(lastIdx)
    const unclosed = tail.match(UNCLOSED_TALOR_FENCE_RE)
    if (unclosed) {
      // 未闭合 fence 前的内容仍然是 markdown
      const beforeFence = tail.slice(0, unclosed.index ?? 0)
      if (beforeFence) {
        segments.push({ type: 'markdown', content: beforeFence })
      }
      // 提取已流出的 type 字段(可能为 null,如 type 字段还没流到)
      const streamingType = detectStreamingTalorType(unclosed[0])
      segments.push({
        type: 'streaming-talor',
        content: unclosed[0],
        streamingType,
      })
    } else {
      segments.push({ type: 'markdown', content: tail })
    }
  }
  if (segments.length === 0) {
    segments.push({ type: 'markdown', content: text })
  }
  return segments
}

// ─── 卡片组件 ──────────────────────────────────────────────────────────

interface CardProps<T extends TalorBlock> {
  block: T
}

function DoneCard({ block }: CardProps<DoneBlock>) {
  return (
    <div className="my-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-green-800">
        <span className="text-base">✓</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">Done</span>
      </div>
      <p className="mt-1 text-sm text-gray-900">{block.summary}</p>
      {block.result !== undefined && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">
            Result
          </summary>
          <pre className="mt-1 text-[11px] font-mono bg-white border border-green-200 rounded p-2 overflow-x-auto">
            {typeof block.result === 'string'
              ? block.result
              : JSON.stringify(block.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function NeedInputCard({ block }: CardProps<NeedInputBlock>) {
  return (
    <div className="my-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-blue-800">
        <span className="text-base">❓</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">Need input</span>
      </div>
      <p className="mt-1 text-sm text-gray-900">{block.question}</p>
      {block.choices && block.choices.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-sm text-gray-800">
          {block.choices.map((c, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <span className="text-xs text-blue-600">•</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      {block.reason && <p className="mt-1.5 text-[11px] text-gray-500 italic">{block.reason}</p>}
    </div>
  )
}

function BlockedCard({ block }: CardProps<BlockedBlock>) {
  return (
    <div className="my-2 rounded-lg border border-orange-300 bg-orange-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-orange-800">
        <span className="text-base">⏸</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">Blocked</span>
        {block.can_retry && (
          <span className="text-[10px] bg-orange-200 text-orange-800 px-1 py-px rounded">
            retryable
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-900">{block.reason}</p>
      {block.retry_hint && (
        <p className="mt-1.5 text-[11px] text-gray-600">
          <span className="font-medium">Hint:</span> {block.retry_hint}
        </p>
      )}
    </div>
  )
}

function PendingConfirmCard({ block }: CardProps<PendingConfirmBlock>) {
  const isDestructive = block.risk_level === 'destructive'
  const borderColor = isDestructive ? 'border-red-300' : 'border-amber-300'
  const bgColor = isDestructive ? 'bg-red-50' : 'bg-amber-50'
  const textColor = isDestructive ? 'text-red-800' : 'text-amber-800'

  return (
    <div className={`my-2 rounded-lg border ${borderColor} ${bgColor} px-3 py-2`}>
      <div className={`flex items-center gap-1.5 ${textColor}`}>
        <span className="text-base">{isDestructive ? '⚠️' : '✋'}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          {isDestructive ? 'Destructive — pending confirm' : 'Pending confirm'}
        </span>
        {block.pattern && (
          <span className="ml-auto text-[10px] font-mono opacity-70">{block.pattern}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-900">{block.summary}</p>
      {block.preview && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">
            Preview
          </summary>
          <pre className="mt-1 text-[11px] font-mono bg-gray-900 text-green-400 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
            {block.preview}
          </pre>
        </details>
      )}
    </div>
  )
}

function WarningCard({ block }: CardProps<WarningBlock>) {
  const sev = block.severity ?? 'medium'
  const styles =
    sev === 'high'
      ? { border: 'border-red-300', bg: 'bg-red-50', text: 'text-red-800' }
      : sev === 'low'
        ? { border: 'border-yellow-300', bg: 'bg-yellow-50', text: 'text-yellow-800' }
        : { border: 'border-amber-300', bg: 'bg-amber-50', text: 'text-amber-800' }
  return (
    <div className={`my-2 rounded-lg border ${styles.border} ${styles.bg} px-3 py-2`}>
      <div className={`flex items-center gap-1.5 ${styles.text}`}>
        <span className="text-base">⚠️</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">Warning ({sev})</span>
      </div>
      <p className="mt-1 text-sm text-gray-900">{block.message}</p>
    </div>
  )
}

/**
 * 流式骨架卡片 — JSONC 还没闭合时根据 streamingType 提前显示对应风格。
 *
 * 设计:
 *   - type 已知 → 显示该类型的颜色 + 占位条 + 抖动动画 (animate-pulse)
 *   - type 未知 (null) → 显示通用 talor 块占位 (灰色)
 *   - 不显示任何文字内容 — 用户已经在上方看到流式文本了, 骨架只是提示"一个 X 类型的卡片正在到达"
 */
function StreamingSkeletonCard({ streamingType }: { streamingType: string | null | undefined }) {
  const styles =
    streamingType === 'done'
      ? { border: 'border-green-200', bg: 'bg-green-50', icon: '✓', label: 'Done' }
      : streamingType === 'need_input'
        ? { border: 'border-blue-200', bg: 'bg-blue-50', icon: '❓', label: 'Need input' }
        : streamingType === 'blocked'
          ? { border: 'border-orange-200', bg: 'bg-orange-50', icon: '⏸', label: 'Blocked' }
          : streamingType === 'pending_confirm'
            ? {
                border: 'border-amber-200',
                bg: 'bg-amber-50',
                icon: '✋',
                label: 'Pending confirm',
              }
            : streamingType === 'warning'
              ? { border: 'border-amber-200', bg: 'bg-amber-50', icon: '⚠️', label: 'Warning' }
              : { border: 'border-gray-200', bg: 'bg-gray-50', icon: '◌', label: 'Talor block' }

  return (
    <div
      className={`my-2 rounded-lg border ${styles.border} ${styles.bg} px-3 py-2 animate-pulse`}
      data-streaming-talor="true"
    >
      <div className="flex items-center gap-1.5 text-gray-500">
        <span className="text-base">{styles.icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">{styles.label}</span>
        <span className="ml-1 text-[10px] opacity-60">streaming…</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="h-2 w-3/4 rounded bg-gray-300 opacity-60" />
        <div className="h-2 w-1/2 rounded bg-gray-300 opacity-60" />
      </div>
    </div>
  )
}

function InvalidTalorCard({ raw }: { raw: string }) {
  return (
    <div className="my-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-gray-600">
        <span className="text-base">⚠️</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">
          Invalid talor block
        </span>
      </div>
      <details className="mt-1.5">
        <summary className="text-[10px] text-gray-500 cursor-pointer hover:text-gray-700">
          Show raw
        </summary>
        <pre className="mt-1 text-[11px] font-mono bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
          {raw}
        </pre>
      </details>
    </div>
  )
}

/**
 * 根据 block.type 分发到对应卡片组件。
 *
 * V2 新 type (plan / diagram / checkpoint ...) 加进来时, 这里加 case 即可。
 */
export function TalorBlockCard({ block }: { block: TalorBlock }) {
  switch (block.type) {
    case 'done':
      return <DoneCard block={block} />
    case 'need_input':
      return <NeedInputCard block={block} />
    case 'blocked':
      return <BlockedCard block={block} />
    case 'pending_confirm':
      return <PendingConfirmCard block={block} />
    case 'warning':
      return <WarningCard block={block} />
    case 'plan':
      // V2 type, 暂用通用卡片渲染
      return <InvalidTalorCard raw={JSON.stringify(block, null, 2)} />
    default:
      // 类型穷尽兜底 — TS 应在 V2 加新 type 时报错提醒补 case
      return <InvalidTalorCard raw={JSON.stringify(block, null, 2)} />
  }
}

/**
 * 渲染 invalid (解析失败) 的 fence 内容。
 */
export function InvalidTalorBlockCard({ raw }: { raw: string }) {
  return <InvalidTalorCard raw={raw} />
}

/**
 * 流式骨架卡片 — 用于 streaming-talor 段。
 */
export function StreamingTalorSkeleton({
  streamingType,
}: {
  streamingType: string | null | undefined
}) {
  return <StreamingSkeletonCard streamingType={streamingType} />
}

/**
 * v3.7: 推断意图卡片 — 模型没 emit talor block, framework 用启发式推断意图后
 * 渲染对应卡片样式。比纯 markdown bubble 多一层结构化提示, 但比 talor block
 * 弱(打 "⚙️ inferred" 徽章告知用户)。
 *
 * `text` 是原始文本(模型自然语言); `inferredType` 是 inferIntent 返的类型。
 */
export function InferredIntentCard({
  text,
  inferredType,
}: {
  text: string
  inferredType: 'done' | 'need_input' | 'blocked'
}) {
  const styles =
    inferredType === 'done'
      ? {
          border: 'border-green-200',
          bg: 'bg-green-50',
          icon: '✓',
          label: 'Done',
          accent: 'text-green-700',
        }
      : inferredType === 'need_input'
        ? {
            border: 'border-blue-200',
            bg: 'bg-blue-50',
            icon: '❓',
            label: 'Need input',
            accent: 'text-blue-700',
          }
        : {
            border: 'border-orange-200',
            bg: 'bg-orange-50',
            icon: '⏸',
            label: 'Blocked',
            accent: 'text-orange-700',
          }

  return (
    <div
      className={`my-2 rounded-lg border ${styles.border} ${styles.bg} px-3 py-2`}
      data-inferred-intent={inferredType}
    >
      <div className={`flex items-center gap-1.5 ${styles.accent}`}>
        <span className="text-base">{styles.icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">{styles.label}</span>
        <span
          className="ml-1 text-[10px] opacity-60"
          title="Framework inferred this from your text — the model did not emit an explicit talor block"
        >
          ⚙️ inferred
        </span>
      </div>
      <div className="mt-1 text-sm text-gray-900 whitespace-pre-wrap break-words">{text}</div>
    </div>
  )
}
