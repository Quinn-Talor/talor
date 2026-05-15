// src/renderer/components/markdown/Prose.tsx
//
// 渲染层: LLM 输出 markdown 渲染 — 替换 Tailwind prose-sm。
// Spec §9: heading 6 档、list 4px 灰圆点、blockquote 2px 左竖线、表格 uppercase mute 表头。

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

const components: Components = {
  code: CodeBlock as Components['code'],
  pre: ({ children }) => <>{children}</>,
}

export function Prose({ source }: { source: string }) {
  return (
    <div className="prose-talor">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
