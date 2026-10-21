// Chat 页的纯逻辑:会话选择、错误文案、消息可见性、输入法组合态判断。
// 与组件分离以便单测。

import type { ChatMessage, ChatSession } from '../../types/chat'

/** 自动选中的默认会话:最近的顶层会话,跳过沉淀工作台与 delegate_agent 子会话 */
export function pickDefaultSession(sessions: ChatSession[]): ChatSession | undefined {
  return sessions.find((s) => s.agent_id !== '__crystallizer__' && s.parent_session_id == null)
}

const CHAT_ERROR_TEXT: Record<string, string> = {
  FILE_TOO_LARGE: '文件大小超过限制（最大 50MB）',
  UNSUPPORTED_FILE_TYPE: '不支持的文件类型',
  FILE_NOT_FOUND: '文件不存在或无法访问',
  PROVIDER_NO_VISION: '当前模型不支持图片识别',
  AUTH_FAILED: '模型服务鉴权失败，请检查 API Key',
  RATE_LIMITED: '请求过于频繁，已被模型服务限流，请稍后再试',
  LLM_CONNECTION_FAILED: '无法连接模型服务，请检查网络或服务地址',
  NETWORK_OFFLINE: '网络不可用',
  LLM_TIMEOUT: '模型响应超时',
  LLM_ERROR: '模型调用失败',
}

/** 流错误码 → 用户可读提示;未知错误码返回 null,由调用方展示原始信息 */
export function friendlyChatError(code: string): string | null {
  return CHAT_ERROR_TEXT[code] ?? null
}

/** 已落库的用户消息条数(渲染端乐观插入的 temp- 消息不计) */
export function countPersistedUserMessages(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === 'user' && !m.id.startsWith('temp-')).length
}

/**
 * 不在聊天流里展示的消息。role=system 的持久化消息是 reflect 写给主 LLM 的
 * 内部纠偏指令(internalNudge),不是对话内容;面向用户的 reflect 输出以
 * assistant 落库,不受影响。tool 消息由前一条 assistant 的工具卡片合并渲染。
 */
export function isHiddenChatMessage(msg: Pick<ChatMessage, 'role'>): boolean {
  return msg.role === 'system' || msg.role === 'tool'
}

/** 输入法组合中的按键(中文选词回车等)不应触发发送 / 提交 */
export function isImeComposing(e: {
  nativeEvent: { isComposing?: boolean }
  keyCode?: number
}): boolean {
  return !!e.nativeEvent.isComposing || e.keyCode === 229
}
