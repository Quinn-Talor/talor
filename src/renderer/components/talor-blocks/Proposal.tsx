// src/renderer/components/talor-blocks/Proposal.tsx
//
// 渲染层: proposal block — 用户可一键确认的动作。
// Spec §11.1 + §11A: 2px indigo 左竖线 + summary + preview + CTA + secondary_actions。
// 无 "proposal" 字。preview 用 markdown 渲染 (Prose) 因为可能含格式化文本。
//
// 用户点 CTA → onConfirm(tool, args)，由 Talor IPC 走 toolRegistry 三道安全门。
// 用户点 secondary action → onEmit(text)，把字符串当作下一条 user message 塞回 LLM。

import { Prose } from '../markdown/Prose'

interface ProposalProps {
  summary: string
  preview?: string
  action: { label: string; tool: string; args: Record<string, unknown> }
  secondary_actions?: Array<{ label: string; emit: string }>
  onConfirm: (tool: string, args: Record<string, unknown>) => void
  onEmit: (text: string) => void
}

export function Proposal({
  summary,
  preview,
  action,
  secondary_actions,
  onConfirm,
  onEmit,
}: ProposalProps) {
  return (
    <div className="prop">
      <div className="prop-summary">{summary}</div>
      {preview && (
        <div className="prop-preview">
          <Prose source={preview} />
        </div>
      )}
      <div className="prop-actions">
        <button
          type="button"
          className="prop-cta"
          onClick={() => onConfirm(action.tool, action.args)}
        >
          {action.label}
        </button>
        {secondary_actions?.map((s, i) => (
          <button
            key={`${s.label}-${i}`}
            type="button"
            className="prop-secondary"
            onClick={() => onEmit(s.emit)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
