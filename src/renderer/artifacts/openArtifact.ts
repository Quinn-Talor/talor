// src/renderer/artifacts/openArtifact.ts — 平台:通用"打开业务对象案卷"动作(by type)
//
// chip 等处调用 openArtifact({type,id}) → 派 window 事件;平台 ArtifactDrawer 监听 → 按 type 渲 Panel。
// 低耦合:不穿 props 链;任何 Feature 的 chip 都用同一动作,平台只认 type。

export interface OpenArtifactDetail {
  type: string
  id: string
}

export const OPEN_ARTIFACT_EVENT = 'artifact:open'

export function openArtifact(detail: OpenArtifactDetail): void {
  window.dispatchEvent(new CustomEvent(OPEN_ARTIFACT_EVENT, { detail }))
}
