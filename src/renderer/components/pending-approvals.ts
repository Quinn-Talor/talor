// 待处理确认卡片的来源标注:请求不按当前会话过滤,来自其它会话 / 子 agent /
// 沉淀工作台的请求需要让用户知道是谁在请求。

import type { ChatSession } from '../types/chat'

function sessionTitle(sessions: ChatSession[], id: string): string | undefined {
  return sessions.find((s) => s.id === id)?.title || undefined
}

/**
 * 返回卡片上的来源说明;请求就来自当前会话本身时返回 null(无需标注)。
 *
 * @param sessionId     发起工具调用的 session(子 agent 时为子 session)
 * @param rootSessionId 本轮 chat:send 的 session
 */
export function describeApprovalSource(
  sessionId: string,
  rootSessionId: string,
  currentSessionId: string | null,
  sessions: ChatSession[],
): string | null {
  const parts: string[] = []
  if (sessionId !== rootSessionId) {
    parts.push(`子 agent「${sessionTitle(sessions, sessionId) ?? sessionId.slice(0, 8)}」`)
  }
  if (rootSessionId !== currentSessionId) {
    const root = sessions.find((s) => s.id === rootSessionId)
    if (root?.agent_id === '__crystallizer__') parts.push('沉淀工作台')
    else parts.push(`会话「${root?.title || rootSessionId.slice(0, 8)}」`)
  }
  return parts.length > 0 ? `来自 ${parts.join(' · ')}` : null
}
