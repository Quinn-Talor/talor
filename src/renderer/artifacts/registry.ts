// src/renderer/artifacts/registry.ts — 业务对象渲染端口 + 注册表(renderer 侧)
//
// 三抽象之三(渲染)。feature 按 type 注册 ArtifactUI(Inline chip + Panel);平台两处挂载点
// (MessageBubble 调 Inline / 案卷面板调 Panel)按 type 派发。平台不认识具体业务,只认 type 字符串。
//
// 设计依据:docs/talor-feature-architecture.md §3 / §4(renderer 半契约)。
// 类型 import 均 type-only(运行时仅 registry 类),可在 node-vitest 下测。

import type { ReactNode } from 'react'
import type { ChatMessage } from '../types/chat'

/** 业务对象的渲染端口:对话流 chip(Inline)+ 案卷/面板(Panel)。组件经 feature 自有 IPC 取数。 */
export interface ArtifactUI {
  type: string
  /** 对话流:从一条消息自识别本类对象并渲 chip;无则返 null。点击 onSelect(id) 选中到面板。 */
  Inline?(props: { message: ChatMessage; onSelect: (id: string) => void }): ReactNode
  /** 面板:渲选中对象的完整态。 */
  Panel?(props: { id: string }): ReactNode
}

/** Feature 的 renderer 侧契约:贡献一组 ArtifactUI。 */
export interface TalorFeatureRenderer {
  id: string
  ui(): ArtifactUI[]
}

/** 按 type 注册 / 查找 ArtifactUI。 */
export class ArtifactUIRegistry {
  private readonly map = new Map<string, ArtifactUI>()

  register(ui: ArtifactUI): void {
    if (this.map.has(ui.type)) throw new Error(`ArtifactUI already registered: ${ui.type}`)
    this.map.set(ui.type, ui)
  }

  get(type: string): ArtifactUI | undefined {
    return this.map.get(type)
  }

  all(): ArtifactUI[] {
    return [...this.map.values()]
  }
}

/** 全局单例(renderer bootstrap 把各 feature 的 ui() 注册进来)。 */
export const artifactUI = new ArtifactUIRegistry()
