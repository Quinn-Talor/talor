import { useMemo, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { decodeMessageContent, isImagePart, isFilePart } from '../types/chat'
import type { Attachment } from '../types/chat'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'
import React from 'react'
import { AttachmentPreview } from './AttachmentPreview'
import { detectDraftInText } from '../lib/draft-extractor'
import {
  splitMessageWithTalorBlocks,
  TalorBlockCard,
  InvalidTalorBlockCard,
  StreamingTalorSkeleton,
  InferredIntentCard,
} from './TalorBlockRenderer'
import { inferIntent } from '@shared/ui-rendering/intent-classifier'

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
  /**
   * 'crystallize' = 渲染在 Agent Workbench 折叠区内。背景换浅紫，
   * 助手 message 末尾扫描 ```json``` 草稿块，匹配则显示"审阅"按钮。
   */
  variant?: 'normal' | 'crystallize'
  /** 仅 variant='crystallize' 且草稿识别成功时调用。 */
  onReviewDraft?: (profile: Record<string, unknown>) => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

interface CodeProps {
  node?: unknown
  inline?: boolean
  className?: string
  children?: React.ReactNode
}

function CodeBlock({ inline, className, children, ...props }: CodeProps) {
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children ?? '').replace(/\n$/, '')
  const lang = match ? match[1] : ''

  if (inline || !match) {
    return (
      <code className="bg-gray-100 text-pink-500 px-1 py-0.5 rounded text-sm font-mono" {...props}>
        {children}
      </code>
    )
  }

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden">
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
      <div className="flex flex-col bg-[#1a1b26] rounded-lg border border-gray-800">
        {lang && (
          <div className="flex items-center px-4 py-1 text-xs text-gray-400 bg-gray-800/50 border-b border-gray-800 font-mono">
            {lang}
          </div>
        )}
        <SyntaxHighlighter
          style={oneDark}
          language={lang || 'text'}
          PreTag="div"
          className="!m-0 !rounded-b-lg text-sm"
          customStyle={{ margin: 0, padding: '1rem', background: 'transparent' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

function MessageBubbleInner({
  message,
  isStreaming,
  variant = 'normal',
  onReviewDraft,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const isCrystallize = variant === 'crystallize'

  const parts = decodeMessageContent(message.content)
  const textContent = parts.map((p) => (p.type === 'text' ? p.content : '')).join('')

  // crystallize variant 下，user 消息若是 backend 注入的 S1 历史快照（含特征
  // 标记 `===== Original Conversation`）默认折叠成短 stub —— 这条 prompt 内容
  // 占大量纵向空间，用户关注点是 crystallizer 的草稿响应而非快照原文。
  // 用户消息（"rename id to xxx"等真实输入）不含此标记，正常展示。
  const isHistorySnapshot = useMemo(() => {
    if (!isCrystallize || !isUser) return false
    return textContent.includes('===== Original Conversation (')
  }, [isCrystallize, isUser, textContent])
  const [snapshotExpanded, setSnapshotExpanded] = useState(false)

  // 草稿识别仅在 crystallize variant + 助手消息 + 流结束后生效。
  // 流式中扫描会闪烁（spec §B.9.4 F2），因此 isStreaming 时禁用。
  const draftDetected = useMemo(() => {
    if (!isCrystallize || isUser || isStreaming) return null
    return detectDraftInText(textContent)
  }, [isCrystallize, isUser, isStreaming, textContent])

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

  const assistantBubbleClass = isCrystallize
    ? 'bg-purple-50 text-gray-900 shadow-sm border border-purple-200 rounded-bl-none'
    : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-none'

  // 折叠态：历史快照消息默认压缩成单行点击展开按钮
  if (isHistorySnapshot && !snapshotExpanded) {
    const msgCountMatch = textContent.match(/===== Original Conversation \((\d+) messages\) =====/)
    const msgCount = msgCountMatch ? msgCountMatch[1] : '?'
    const isUpdate = textContent.startsWith('Updated original conversation')
    return (
      <div
        className="flex w-full justify-end mb-2"
        data-variant={variant}
        data-snapshot-collapsed="true"
      >
        <button
          type="button"
          onClick={() => setSnapshotExpanded(true)}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] hover:bg-purple-100 transition-colors"
          style={{
            background: '#f5f3ff',
            border: '1px dashed #c4b5fd',
            color: '#7c3aed',
          }}
        >
          <span>📋</span>
          <span>
            {isUpdate ? '更新版历史快照' : '历史对话快照'} · {msgCount} 条对话
          </span>
          <span className="opacity-60">点击展开 ▼</span>
        </button>
      </div>
    )
  }

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-2`}
      data-variant={variant}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isHistorySnapshot && snapshotExpanded
            ? 'bg-purple-50 text-gray-800 border border-purple-200 rounded-br-none'
            : isUser
              ? 'bg-blue-600 text-white rounded-br-none'
              : assistantBubbleClass
        }`}
      >
        {!isUser && isCrystallize && (
          <div className="text-[11px] font-semibold mb-1" style={{ color: '#7c3aed' }}>
            🔮 Crystallizer
          </div>
        )}
        {isHistorySnapshot && snapshotExpanded && (
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={() => setSnapshotExpanded(false)}
              className="flex items-center gap-1 text-[11px] hover:underline"
              style={{ color: '#7c3aed' }}
            >
              ▲ 折起快照
            </button>
          </div>
        )}
        {isUser ? (
          <div className="flex flex-col gap-2">
            <div className="whitespace-pre-wrap break-words">{textContent}</div>
            {attachments.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                {attachments.map((att, i) => (
                  <AttachmentPreview
                    key={i}
                    attachment={{
                      ...att,
                      base64_data:
                        isImagePart(parts[i]) &&
                        parts[i].type === 'image' &&
                        (parts[i] as any).data.startsWith('data:')
                          ? (parts[i] as any).data
                          : undefined,
                    }}
                    compact
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="markdown-content prose prose-sm max-w-none overflow-x-auto prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-pre:p-3 prose-pre:rounded-lg prose-pre:bg-zinc-50 dark:prose-pre:bg-zinc-900 prose-headings:my-2 prose-ul:my-1.5 prose-li:my-0.5 prose-code:text-[13px] prose-code:font-medium">
            <ErrorBoundary
              fallback={
                <div className="whitespace-pre-wrap break-words text-red-500">
                  <span className="text-xs mb-1 block uppercase font-bold text-red-400">
                    Markdown Render Error
                  </span>
                  {textContent}
                </div>
              }
            >
              {(() => {
                const segments = splitMessageWithTalorBlocks(textContent || '')

                // v3.7: 如果消息已含显式 talor 收尾 block (done/need_input/blocked),按
                //   分段渲染 (显式 > 推断)。streaming 中也按分段(骨架卡走流式路径)。
                // 否则 (落库后, 无显式收尾 block, 文本可被分类) → 整段渲染为 InferredIntentCard。
                const hasExplicitTermination = segments.some(
                  (s) =>
                    s.type === 'talor' &&
                    (s.block?.type === 'done' ||
                      s.block?.type === 'need_input' ||
                      s.block?.type === 'blocked'),
                )
                const onlyMarkdown =
                  segments.length === 1 && segments[0].type === 'markdown' && !isStreaming
                if (!hasExplicitTermination && onlyMarkdown) {
                  const inferred = inferIntent(textContent || '')
                  if (inferred.type) {
                    return (
                      <InferredIntentCard text={textContent || ''} inferredType={inferred.type} />
                    )
                  }
                }

                return segments.map((seg, i) => {
                  if (seg.type === 'talor' && seg.block) {
                    return <TalorBlockCard key={i} block={seg.block} />
                  }
                  if (seg.type === 'invalid-talor') {
                    return <InvalidTalorBlockCard key={i} raw={seg.content} />
                  }
                  if (seg.type === 'streaming-talor') {
                    // 流式中未闭合 fence: 仅 isStreaming=true 时显示骨架,流结束后
                    // (按 parser 看仍是 unclosed → 是真损坏) 才降级为 invalid 卡片。
                    return isStreaming ? (
                      <StreamingTalorSkeleton key={i} streamingType={seg.streamingType} />
                    ) : (
                      <InvalidTalorBlockCard key={i} raw={seg.content} />
                    )
                  }
                  return (
                    <ReactMarkdown
                      key={i}
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: CodeBlock as Components['code'],
                        pre: ({ children }) => <>{children}</>,
                      }}
                    >
                      {seg.content}
                    </ReactMarkdown>
                  )
                })
              })()}
            </ErrorBoundary>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse align-middle" />
        )}
        {draftDetected?.detected && draftDetected.profile && onReviewDraft && (
          <button
            type="button"
            onClick={() => onReviewDraft(draftDetected.profile!)}
            className="mt-2 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-purple-200"
            style={{
              background: '#ede9fe',
              color: '#7c3aed',
              border: '1px solid #c4b5fd',
            }}
            data-testid="review-draft-button"
          >
            📦 检测到草稿 — 审阅并保存 →
          </button>
        )}
      </div>
    </div>
  )
}

// React.memo 大幅缓解 Crystallizer workbench 输入卡顿:
// 工作台 session 通常 40+ 消息(含长历史快照),输入 textarea 每按一键就让 Chat 父组件
// re-render → 所有 MessageBubble 默认会跟着重渲染(含 markdown + 代码高亮)。
// memoize 后 message reference 不变就跳过,输入响应立刻丝滑。
export const MessageBubble = React.memo(MessageBubbleInner)
