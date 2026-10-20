// src/renderer/store/uiStore.ts — UI 偏好状态（持久化到 localStorage）
//
// 用 zustand persist middleware 把不影响数据正确性的"显示偏好"持久化：
//   - showSubSessions：subagent delegation 场景，是否在 session list 显示子 session
//   - showTraceDebug：Trace 面板是否显示 DEBUG 级 observation（无产出的守卫评估等）

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  /**
   * 是否在 session 侧栏显示子 session（parent_session_id IS NOT NULL）。
   * 默认 false：MVP 用户视角下子 session 是"实施细节"，主对话才是关心对象；
   * 调试 / 排查时打开开关查看。
   */
  showSubSessions: boolean
  toggleShowSubSessions: () => void
  setShowSubSessions: (value: boolean) => void
  /** Trace 面板是否显示 DEBUG 级 observation。默认 false：只看有产出的节点。 */
  showTraceDebug: boolean
  toggleShowTraceDebug: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      showSubSessions: false,
      toggleShowSubSessions: () => set((state) => ({ showSubSessions: !state.showSubSessions })),
      setShowSubSessions: (value) => set({ showSubSessions: value }),
      showTraceDebug: false,
      toggleShowTraceDebug: () => set((state) => ({ showTraceDebug: !state.showTraceDebug })),
    }),
    {
      name: 'talor.ui',
    },
  ),
)
