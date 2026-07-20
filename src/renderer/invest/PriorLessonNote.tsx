// src/renderer/invest/PriorLessonNote.tsx —— 回程边可视:建卡/立论时露出同 code 卡的上轮教训
export interface PriorLesson {
  ref_v?: number
  lesson?: string
  at: string
}

export function PriorLessonNote({ lessons }: { lessons: PriorLesson[] }) {
  const withText = lessons.filter((l) => l.lesson)
  if (withText.length === 0) return null
  return (
    <div className="priorlesson">
      <div className="pl-h">↩ 上轮教训</div>
      {withText.map((l, i) => (
        <div key={i} className="pl-item">
          · {l.lesson}
          <span className="pl-at">{l.at}</span>
        </div>
      ))}
    </div>
  )
}
