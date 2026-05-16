// src/renderer/components/MessageBubble.tsx
//
// 渲染层: 消息渲染 — Phase 8 重构为 chromeless turn rail。
//
// 设计原则 (spec §8):
//   - 不再有"气泡"容器；user 和 assistant 都共享 turn rail 布局
//   - 22×22 avatar + 32px padding-left + 1px 垂直 rail
//   - assistant 用 Prose 渲染 markdown
//   - Talor block 用新组件 (DonePill / NeedInput / BlockedRow / WarningRow / Proposal)
//   - 流式中: 末尾光标 + spinner (Phase 11 完善)
//
// 保留向后兼容的 props (message / isStreaming / variant / onReviewDraft)，
// crystallize variant 不再做特殊视觉处理 (spec §11.5 改为 dashed 分隔)；
// history snapshot 折叠保留。

import { useMemo, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { decodeMessageContent, isImagePart, isFilePart } from '../types/chat'
import type { Attachment } from '../types/chat'
import React from 'react'
import { AttachmentPreview } from './AttachmentPreview'
import { detectDraftInText } from '../lib/draft-extractor'
import { splitMessageWithTalorBlocks } from './TalorBlockRenderer'
import { Prose } from './markdown/Prose'
import { DonePill, NeedInput, BlockedRow, WarningRow, Proposal } from './talor-blocks'

class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }
    return this.props.children
  }
}

interface MessageBubbleProps {
  message: ChatMessage | { role: 'assistant'; content: string }
  isStreaming?: boolean
  variant?: 'normal' | 'crystallize'
  onReviewDraft?: (profile: Record<string, unknown>) => void
  /** When user clicks a need_input choice, this fires with the choice text.
   *  Caller should send it back to the LLM as the next user message. */
  onPickChoice?: (text: string) => void
  /** When user clicks a proposal CTA. Wired via Phase 8.3 IPC. */
  onConfirmProposal?: (tool: string, args: Record<string, unknown>) => void
  /** When user clicks a proposal secondary action's emit string. */
  onEmit?: (text: string) => void
}

function MessageBubbleInner({
  message,
  isStreaming,
  variant = 'normal',
  onReviewDraft,
  onPickChoice,
  onConfirmProposal,
  onEmit,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isCrystallize = variant === 'crystallize'

  const parts = decodeMessageContent(message.content)
  const textContent = parts.map((p) => (p.type === 'text' ? p.content : '')).join('')

  // History snapshot folding (preserved from previous impl)
  const isHistorySnapshot = useMemo(() => {
    if (!isCrystallize || !isUser) return false
    return textContent.includes('===== Original Conversation (')
  }, [isCrystallize, isUser, textContent])
  const [snapshotExpanded, setSnapshotExpanded] = useState(false)

  // Draft detection (legacy — still useful for crystallize workbench profile extraction)
  const draftDetected = useMemo(() => {
    if (!isCrystallize || isUser || isStreaming) return null
    return detectDraftInText(textContent)
  }, [isCrystallize, isUser, isStreaming, textContent])

  // Collect attachments
  const attachments: Attachment[] = []
  parts.forEach((p) => {
    if (isImagePart(p)) {
      attachments.push({
        path: p.data,
        mime_type: p.mime_type,
        filename: p.filename || 'image',
        size_bytes: 0,
      })
    } else if (isFilePart(p)) {
      attachments.push({
        path: p.path,
        mime_type: p.mime_type,
        filename: p.filename,
        size_bytes: p.size_bytes,
      })
    }
  })

  // Folded history snapshot — minimal dashed pill
  if (isHistorySnapshot && !snapshotExpanded) {
    const msgCountMatch = textContent.match(/===== Original Conversation \((\d+) messages\) =====/)
    const msgCount = msgCountMatch ? msgCountMatch[1] : '?'
    const isUpdate = textContent.startsWith('Updated original conversation')
    return (
      <div
        className="flex w-full justify-start mb-2"
        data-variant={variant}
        data-snapshot-collapsed="true"
      >
        <button
          type="button"
          onClick={() => setSnapshotExpanded(true)}
          className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] text-mute hover:bg-surface transition-colors border border-dashed border-line"
        >
          <span>
            {isUpdate ? '更新版历史快照' : '历史对话快照'} · {msgCount} 条对话
          </span>
          <span className="text-subtle">点击展开 ▼</span>
        </button>
      </div>
    )
  }

  // Turn rail wrapper
  return (
    <div className="turn" data-variant={variant}>
      <div className={`turn-av ${isUser ? 'av-user' : 'av-bot'}`}>{isUser ? 'Q' : 'T'}</div>
      <div className="turn-body">
        {isHistorySnapshot && snapshotExpanded && (
          <button
            type="button"
            onClick={() => setSnapshotExpanded(false)}
            className="flex items-center gap-1 text-[11px] text-indigo hover:underline mb-2"
          >
            ▲ 折起快照
          </button>
        )}

        {isUser ? (
          <div className="user-msg whitespace-pre-wrap break-words">
            {textContent}
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                {attachments.map((att, i) => (
                  <AttachmentPreview
                    key={i}
                    attachment={{
                      ...att,
                      base64_data:
                        isImagePart(parts[i]) &&
                        parts[i].type === 'image' &&
                        (parts[i] as { data?: string }).data?.startsWith('data:')
                          ? (parts[i] as { data: string }).data
                          : undefined,
                    }}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <ErrorBoundary
            fallback={
              <div className="whitespace-pre-wrap break-words text-err">
                <span className="text-xs mb-1 block uppercase font-semibold text-err">
                  Markdown Render Error
                </span>
                {textContent}
              </div>
            }
          >
            {renderAssistantSegments(
              textContent,
              isStreaming === true,
              onPickChoice,
              onConfirmProposal,
              onEmit,
            )}
          </ErrorBoundary>
        )}

        {isStreaming && <span className="streaming-cursor" />}

        {draftDetected?.detected && draftDetected.profile && onReviewDraft && (
          <button
            type="button"
            onClick={() => onReviewDraft(draftDetected.profile!)}
            className="mt-2 inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-indigo hover:bg-surface transition-colors border border-line"
            data-testid="review-draft-button"
          >
            检测到草稿 — 审阅并保存 →
          </button>
        )}
      </div>
    </div>
  )
}

function renderAssistantSegments(
  text: string,
  isStreaming: boolean,
  onPickChoice?: (text: string) => void,
  onConfirmProposal?: (tool: string, args: Record<string, unknown>) => void,
  onEmit?: (text: string) => void,
): React.ReactNode {
  const segments = splitMessageWithTalorBlocks(text || '')

  return segments.map((seg, i) => {
    if (seg.type === 'talor' && seg.block) {
      const block = seg.block
      switch (block.type) {
        case 'done':
          return <DonePill key={i} summary={block.summary} />
        case 'need_input':
          return (
            <NeedInput
              key={i}
              question={block.question}
              choices={block.choices}
              reason={block.reason}
              onPick={(c) => onPickChoice?.(c)}
            />
          )
        case 'blocked':
          return <BlockedRow key={i} reason={block.reason} retry_hint={block.retry_hint} />
        case 'warning':
          return <WarningRow key={i} message={block.message} severity={block.severity} />
        case 'proposal':
          return (
            <Proposal
              key={i}
              summary={block.summary}
              preview={block.preview}
              action={block.action}
              secondary_actions={block.secondary_actions}
              onConfirm={(tool, args) => onConfirmProposal?.(tool, args)}
              onEmit={(t) => onEmit?.(t)}
            />
          )
        default:
          return null
      }
    }
    if (seg.type === 'invalid-talor') {
      // Spec §11.3: don't render in UI; could route to dev log
      return null
    }
    if (seg.type === 'streaming-talor') {
      // Spec §12.1: during streaming, container should already be rendered.
      // Since we don't have partial-field parsing yet, fall back to invisible
      // until block completes. This is consistent (no skeleton→card flip).
      return null
    }
    return <Prose key={i} source={seg.content} />
  })
}

// React.memo:工作台 session 通常 40+ 消息,输入 textarea 每按一键都让父组件
// re-render → 全部 message 默认会重渲染(含 markdown + syntax-highlighter)。
// memoize 后 message reference 不变就跳过,输入响应丝滑。
export const MessageBubble = React.memo(MessageBubbleInner)
