// src/renderer/components/markdown/Prose.tsx
//
// 渲染层: LLM 输出 markdown 渲染 — 替换 Tailwind prose-sm。
// Spec §9: heading 6 档、list 4px 灰圆点、blockquote 2px 左竖线、表格 uppercase mute 表头。

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { CodeBlock } from './CodeBlock'

const components: Components = {
  code: CodeBlock as Components['code'],
  pre: ({ children }) => <>{children}</>,
}

// remark-gfm: GFM tables / strikethrough / task lists.
// remark-breaks: single newlines → <br>. Matches GitHub / ChatGPT chat semantics.
// Critical for LLM output: LLMs often emit pipe-separated content without proper
// table separator rows; with breaks, each line at least wraps correctly instead
// of collapsing into one giant paragraph.
const plugins = [remarkGfm, remarkBreaks]

export function Prose({ source }: { source: string }) {
  return (
    <div className="prose-talor">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
