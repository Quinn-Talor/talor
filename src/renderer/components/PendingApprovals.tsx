import { useChatStore, rootSessionOf } from '../store/chatStore'
import { talorAPI } from '../api/talorAPI'
import { PendingRequestCard, ToolConfirmCard } from './PermissionsPopover'
import { describeApprovalSource } from './pending-approvals'
import type { PermissionResponse } from '@shared/types/permissions'

/**
 * 待处理的授权请求 / 高风险工具确认,有请求时常驻显示在输入框上方。
 *
 * 与 workspace 解耦(无 workspace 的会话同样需要确认),也不按当前会话过滤
 * (子 agent、工作台、后台会话的请求都要能被处理),非当前会话的请求标注来源。
 * 并行请求排队逐个展示:授权请求优先(它阻塞整条工具链),其次工具确认。
 */
export function PendingApprovals() {
  const permissionQueue = useChatStore((s) => s.permissionQueue)
  const toolConfirmQueue = useChatStore((s) => s.toolConfirmQueue)
  const removePermission = useChatStore((s) => s.removePermission)
  const removeToolConfirm = useChatStore((s) => s.removeToolConfirm)
  const sessions = useChatStore((s) => s.sessions)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

  const total = permissionQueue.length + toolConfirmQueue.length
  if (total === 0) return null

  const permission = permissionQueue[0]
  const confirm = permission ? undefined : toolConfirmQueue[0]
  const source = confirm
    ? describeApprovalSource(confirm.sessionId, rootSessionOf(confirm), currentSessionId, sessions)
    : null

  const decidePermission = (resp: Omit<PermissionResponse, 'requestId'>) => {
    if (!permission) return
    talorAPI.chat.sendPermissionResponse({ requestId: permission.requestId, ...resp })
    removePermission(permission.requestId)
  }

  const decideToolConfirm = (decision: 'approved' | 'rejected', remember?: boolean) => {
    if (!confirm) return
    talorAPI.chat.sendToolConfirmResponse({
      toolCallId: confirm.toolCallId,
      decision,
      ...(remember ? { remember: true } : {}),
    })
    removeToolConfirm(confirm.toolCallId)
  }

  return (
    <div
      className="mb-2 rounded-lg overflow-hidden"
      style={{ background: '#ffffff', border: '1px solid #fcd34d' }}
      data-testid="pending-approvals"
    >
      <div className="flex items-center gap-2 px-3 pt-2 text-[11px]">
        <span className="font-semibold text-amber-800">
          {permission ? 'Permission required' : 'Confirm tool execution'}
        </span>
        {source && <span className="truncate text-gray-500">{source}</span>}
        {total > 1 && <span className="ml-auto shrink-0 text-gray-400">1 / {total}</span>}
      </div>
      {permission && (
        <PendingRequestCard
          key={permission.requestId}
          request={permission}
          onDecide={decidePermission}
        />
      )}
      {confirm && (
        <ToolConfirmCard key={confirm.toolCallId} request={confirm} onDecide={decideToolConfirm} />
      )}
    </div>
  )
}
