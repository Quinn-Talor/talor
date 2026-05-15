// src/renderer/components/tool-calls/BashOutput.tsx
//
// 渲染层: bash 工具结果 — terminal-like 输出。
// Spec §10.3: 2px 左 line 缩进；stdout 默认色，stderr 红色，summary 末尾 sans 色。

interface BashOutputProps {
  stdout?: string
  stderr?: string
  summary?: string
}

export function BashOutput({ stdout, stderr, summary }: BashOutputProps) {
  return (
    <div className="bash-out">
      {stdout && <pre className="bash-stdout">{stdout}</pre>}
      {stderr && <pre className="bash-stderr">{stderr}</pre>}
      {summary && <div className="bash-summary">{summary}</div>}
    </div>
  )
}
