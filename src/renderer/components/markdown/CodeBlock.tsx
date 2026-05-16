// src/renderer/components/markdown/CodeBlock.tsx
//
// 渲染层: markdown 代码块 + inline code。
// Spec §9.5: 浅色容器 (#fcfcfc) + 1px line border + 10px radius，不再黑底嵌白卡。
// Inline code 用 line-2 底 + 主文字色，不再 pink-on-gray。

import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

interface CodeBlockProps {
  inline?: boolean
  className?: string
  children?: React.ReactNode
}

export function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children ?? '').replace(/\n$/, '')

  if (inline || !match) {
    return <code className="inline-code">{children}</code>
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{match[1]}</span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        style={oneLight}
        language={match[1] || 'text'}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: '12px 14px',
          background: 'transparent',
          fontSize: '12.5px',
          lineHeight: '1.6',
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="code-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* clipboard denied — silent */
        }
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}
