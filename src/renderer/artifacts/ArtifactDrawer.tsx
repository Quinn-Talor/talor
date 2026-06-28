// src/renderer/artifacts/ArtifactDrawer.tsx — 平台:业务对象案卷抽屉(右侧常驻面板宿主,通用)
//
// 监听通用 window 事件 'artifact:open' {type,id},按 type 从 artifactUI 取对应 Panel 渲染。
// 平台不认识具体业务,只认 type —— 任何 Feature 的 Panel 都挂这里。

import { useEffect, useState } from 'react'
import { artifactUI } from './registry'
import { OPEN_ARTIFACT_EVENT, type OpenArtifactDetail } from './openArtifact'

export function ArtifactDrawer() {
  const [selected, setSelected] = useState<OpenArtifactDetail | null>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<OpenArtifactDetail>).detail
      if (detail?.id && detail?.type) setSelected(detail)
    }
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen)
  }, [])

  if (!selected) return null
  const Panel = artifactUI.get(selected.type)?.Panel
  if (!Panel) return null

  return (
    <div className="fixed right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="text-sm font-semibold">案卷</span>
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="rounded px-2 py-0.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="关闭"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Panel id={selected.id} />
      </div>
    </div>
  )
}
