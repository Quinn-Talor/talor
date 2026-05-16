// src/renderer/components/talor-blocks/NeedInput.tsx
//
// 渲染层: need_input block — 选项按钮。
// Spec §11.1: 2px info 左竖线 + 问题 + choices 按钮 + reason，无 "Need input" 字。

interface NeedInputProps {
  question: string
  choices?: string[]
  reason?: string
  onPick: (choice: string) => void
}

export function NeedInput({ question, choices, reason, onPick }: NeedInputProps) {
  return (
    <div className="ni">
      <div className="ni-q">{question}</div>
      {choices && choices.length > 0 && (
        <div className="ni-opts">
          {choices.map((c) => (
            <button key={c} className="ni-opt" onClick={() => onPick(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {reason && <div className="ni-reason">{reason}</div>}
    </div>
  )
}
