import { useEffect } from 'react'
import { useChatStore } from '../store/chatStore'
import { talorAPI } from '../api/talorAPI'
import type { ToolConfirmRequest } from '@shared/types/message'
import type { PermissionRequest } from '@shared/types/permissions'

/**
 * 卡片失效时长,与主进程等待回复的超时一致(ipc/tool-confirm.ts 30s、
 * ipc/permission.ts 5min):超时后主进程已按拒绝处理,卡片不应再留在队列里。
 */
export const TOOL_CONFIRM_TTL_MS = 30_000
export const PERMISSION_TTL_MS = 5 * 60 * 1000

/**
 * 在 App 层订阅工具确认 / 授权请求并写入 chatStore 队列。
 *
 * 必须挂在不会随页面切换卸载的位置:请求在用户停留设置页时也会到达,
 * 订阅随聊天页卸载会让请求无人接收直至超时被拒。
 * 不按当前会话过滤 —— 子 agent、工作台、后台会话的请求都需要用户处理,
 * 来源由展示层标注。
 */
export function usePendingApprovals(): void {
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const expireLater = (ms: number, expire: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t)
        expire()
      }, ms)
      timers.add(t)
    }

    const offConfirm = talorAPI.chat.onToolConfirm((req: ToolConfirmRequest) => {
      useChatStore.getState().enqueueToolConfirm(req)
      expireLater(TOOL_CONFIRM_TTL_MS, () =>
        useChatStore.getState().removeToolConfirm(req.toolCallId),
      )
    })

    const offPermission = talorAPI.chat.onPermissionRequest((req: PermissionRequest) => {
      useChatStore.getState().enqueuePermission(req)
      expireLater(PERMISSION_TTL_MS, () => useChatStore.getState().removePermission(req.requestId))
    })

    // 轮次结束(chat:stream done 只以发起 session 发出)后,该轮挂起的确认已无人等待
    const offStream = talorAPI.chat.onStream((event) => {
      if (event.done || event.error_code) {
        useChatStore.getState().takeToolConfirmsForRoot(event.session_id)
      }
    })

    return () => {
      offConfirm()
      offPermission()
      offStream()
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }, [])
}
