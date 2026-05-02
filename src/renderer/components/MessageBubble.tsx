import { useState } from 'react'
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

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  const parts = decodeMessageContent(message.content)
  const textContent = parts.map((p) => (p.type === 'text' ? p.content : '')).join('')

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

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-none'
            : 'bg-white text-gray-900 shadow-sm border border-gray-100 rounded-bl-none'
        }`}
      >
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
          <div className="markdown-content prose prose-sm max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-pre:my-2 prose-pre:p-3 prose-pre:rounded-lg prose-pre:bg-zinc-50 dark:prose-pre:bg-zinc-900 prose-headings:my-2 prose-ul:my-1.5 prose-li:my-0.5 prose-code:text-[13px] prose-code:font-medium">
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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code: CodeBlock as Components['code'],
                  pre: ({ children }) => <>{children}</>,
                }}
              >
                {textContent || ''}
              </ReactMarkdown>
            </ErrorBoundary>
          </div>
        )}
        {isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse align-middle" />
        )}
      </div>
    </div>
  )
}
