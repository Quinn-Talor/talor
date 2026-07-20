// src/renderer/invest/ChallengeCard.tsx —— 红蓝对抗:空方证伪(红)+ PM 裁决(中性/蓝)
// 数据来自 CardBundle 的 thesis.challenge / checkpoint.challenge(不从聊天渲染,子 agent turn 取不到)。
import type { ThesisChallenge } from '@shared/types/invest'

const VERDICT_LABEL: Record<string, string> = { accept: '采纳', reject: '驳回', revise: '改判' }

export function ChallengeCard({ challenge }: { challenge?: ThesisChallenge }) {
  if (!challenge?.output) return null
  const { output: o, adjudication: a } = challenge
  return (
    <div className="challenge">
      <div className="ch-short">
        <span className="ch-tag ch-tag-bear">空方 · {o.severity}</span>
        <b>最弱命门:{o.weakest_assumption}</b>
        <div className="ch-body">{o.refutation}</div>
        <div className="ch-sug">空方建议:{o.suggested_verdict}</div>
      </div>
      <div className="ch-pm">
        <span className="ch-tag ch-tag-pm">
          主理人裁决 · {VERDICT_LABEL[a.verdict] ?? a.verdict}
        </span>
        <div className="ch-body">{a.note}</div>
      </div>
    </div>
  )
}
