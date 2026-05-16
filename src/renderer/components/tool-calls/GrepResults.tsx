// src/renderer/components/tool-calls/GrepResults.tsx
//
// 渲染层: grep 工具结果 — 文件分组 + 行号 + 命中片段高亮。
// Spec §10.3: 文件名 info 蓝色, 行号 subtle, hit 黄色 highlight。

interface GrepHit {
  file: string
  matches: Array<{ ln: number; text: string; hit: string }>
}

interface GrepResultsProps {
  groups: GrepHit[]
}

export function GrepResults({ groups }: GrepResultsProps) {
  return (
    <div className="grep-out">
      {groups.map((g, i) => (
        <div key={`${g.file}-${i}`}>
          <div className="grep-file">{g.file}</div>
          {g.matches.map((m, j) => (
            <div key={j} className="grep-match">
              <span className="grep-ln">{m.ln}</span>
              <span className="grep-text">{highlight(m.text, m.hit)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function highlight(text: string, hit: string) {
  const i = text.indexOf(hit)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <span className="grep-hit">{hit}</span>
      {text.slice(i + hit.length)}
    </>
  )
}
