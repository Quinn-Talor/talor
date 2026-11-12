// src/renderer/components/IntentCard.tsx — 引擎意图调用（ask_user / propose / report_blocked）的卡片
// finish 卡片只用于显示旧运行记录：引擎已去掉 finish 意图。
//
// 复用旧 talor 块的卡片样式（DonePill、NeedInput、BlockedRow、Proposal 的 .prop 样式）与 Prose；
// 卡片上的选择经 onReply 作为下一条用户消息发出（C2 TASK-2）。
import type { JSX } from 'react'
import { Prose } from './markdown/Prose'
import { BlockedRow, DonePill, NeedInput } from './talor-blocks'
import { proposalReply, type IntentView } from '../lib/intent-view'

export function IntentCard({
  view,
  onReply,
}: {
  view: IntentView
  onReply: (text: string) => void
}): JSX.Element {
  const lead = view.text ? <Prose source={view.text} /> : null
  switch (view.kind) {
    case 'finish':
      return view.text ? (
        <>
          {lead}
          <DonePill summary={view.summary} />
        </>
      ) : (
        <Prose source={view.summary} />
      )
    case 'ask_user':
      return (
        <>
          {lead}
          <NeedInput question={view.question} choices={view.options} onPick={onReply} />
        </>
      )
    case 'propose':
      return (
        <>
          {lead}
          <div className="prop">
            <div className="prop-summary">{view.summary}</div>
            {view.preview && (
              <div className="prop-preview">
                <pre className="whitespace-pre-wrap break-words">{view.preview}</pre>
              </div>
            )}
            {view.actions.length > 0 && (
              <ol className="text-[12px] text-mute mb-2 list-decimal pl-5">
                {view.actions.map((a, i) => (
                  <li key={i} className="break-all">
                    <span className="font-medium">{a.tool}</span>{' '}
                    <code>{JSON.stringify(a.input)}</code>
                  </li>
                ))}
              </ol>
            )}
            <div className="prop-actions">
              <button
                type="button"
                className="prop-cta"
                onClick={() => onReply(proposalReply(view, true))}
              >
                确认执行
              </button>
              <button
                type="button"
                className="prop-secondary"
                onClick={() => onReply(proposalReply(view, false))}
              >
                不执行
              </button>
            </div>
          </div>
        </>
      )
    case 'report_blocked':
      return (
        <>
          {lead}
          <BlockedRow reason={view.reason} />
        </>
      )
  }
}
