// 一轮里的辅助显示：过程文本折叠、思考折叠、"核对中"、工具步文本折叠。
// 前三者只用于带阶段标记的行与引擎的流式事件；工具步文本（StepNote）新旧路径都用。
import { useState } from 'react'
import { stepPreview } from '../lib/turn-view'
import { Prose } from './markdown/Prose'

const STEP_PREVIEW_CHARS = 80

const PREVIEW_CHARS = 60
const LIVE_REASONING_LINES = 3

/** 过程文本：默认收起成一行预览，点开以 markdown 显示全文。 */
export function ProcessNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null
  return (
    <div className="pl-[32px] mb-1" data-testid="process-note">
      <button
        className="text-mute text-[12px] hover:text-body cursor-pointer text-left truncate max-w-full block"
        onClick={() => setOpen((v) => !v)}
      >
        {open
          ? '过程 ▾'
          : `过程 · ${trimmed.slice(0, PREVIEW_CHARS)}${trimmed.length > PREVIEW_CHARS ? '…' : ''}`}
      </button>
      {open && (
        <div className="text-mute text-[13px] mt-1">
          <Prose source={trimmed} />
        </div>
      )}
    </div>
  )
}

/** 工具步文本：落库后默认收起成一行灰色预览，点开显示全文（与生成中 ToolCallLog 的展开一致）。 */
export function StepNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null
  return (
    <button
      data-testid="step-note"
      className={`text-[12px] text-mute mb-1 text-left hover:text-body cursor-pointer max-w-full block ${
        open ? 'whitespace-pre-wrap' : 'truncate'
      }`}
      onClick={() => setOpen((v) => !v)}
    >
      {open ? trimmed : stepPreview(trimmed, STEP_PREVIEW_CHARS)}
    </button>
  )
}

/** 思考：流式时展开显示最后几行；落库后默认收起，点开显示全文。 */
export function ReasoningNote({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const trimmed = text.trim()
  if (!trimmed) return null
  if (live) {
    const tail = trimmed.split('\n').slice(-LIVE_REASONING_LINES).join('\n')
    return (
      <div className="text-mute text-[12px] italic mb-1" data-testid="reasoning-live">
        <div>思考中…</div>
        <div className="whitespace-pre-wrap">{tail}</div>
      </div>
    )
  }
  return (
    <div className="pl-[32px] mb-1" data-testid="reasoning-note">
      <button
        className="text-mute text-[12px] hover:text-body cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '思考 ▾' : '思考 ▸'}
      </button>
      {open && (
        <div className="text-mute text-[12px] italic whitespace-pre-wrap mt-1">{trimmed}</div>
      )}
    </div>
  )
}

/** 交付验收期间的"核对中"。 */
export function VerifyingIndicator() {
  return (
    <div className="flex items-center gap-1.5 text-mute text-[12px]" data-testid="verifying">
      <span
        className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0"
        aria-label="verifying"
      />
      核对中…
    </div>
  )
}
