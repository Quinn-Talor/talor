// src/renderer/components/tool-calls/DiffView.tsx
//
// 渲染层: 内联 diff 视图 (用于 edit / write 工具结果)。
// Spec §10.3: 1px line border + 10px radius；绿/红行底色 + 行号 mute。

interface DiffLine {
  kind: '+' | '-' | ' '
  ln?: number
  text: string
}

interface DiffViewProps {
  file: string
  added: number
  removed: number
  lines: DiffLine[]
}

export function DiffView({ file, added, removed, lines }: DiffViewProps) {
  return (
    <div className="diff">
      <div className="diff-head">
        <span>{file}</span>
        <span>
          +{added} / −{removed}
        </span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`diff-row ${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''}`}>
          <span className="diff-sign">{l.kind}</span>
          <span className="diff-ln">{l.ln ?? ''}</span>
          <span className="diff-text">{l.text}</span>
        </div>
      ))}
    </div>
  )
}
