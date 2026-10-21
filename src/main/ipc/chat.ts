// src/main/ipc/chat.ts —— 入口层：IPC 注册 + 事件转发 + snake/camel 命名转换
//
// 职责：
//   1. 注册 chat:send / chat:abort IPC handler
//   2. 把业务层 callback 转成 webContents.send 事件
//   3. 把 requestToolConfirm 绑定 mainWindow 后作为端口注入业务层
//   4. 入口协议使用 snake_case（渲染端契约），业务层使用 camelCase，本层做双向转换
//
// 禁止：业务决策（附件校验、provider 选取、ReAct 控制等）

import { ipcMain } from 'electron'
import log from 'electron-log'
import { getMainWindow } from './window'
import { requestToolConfirm } from './tool-confirm'
import { requestPermissionFromRenderer } from './permission'
import { sendChat } from '../chat/orchestrator'
import { streamRegistry } from '../chat/stream-registry'
import { isErrorOutput } from '../loop/stream-utils'
import type { AgentManager } from '../agent/agent-manager'

/** 渲染端传入的 snake_case 参数结构。 */
interface ChatSendRawParams {
  session_id: string
  content: string
  attachments?: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

export function registerChatHandlers(agentManager: AgentManager): void {
  ipcMain.handle('chat:send', async (_event, raw: ChatSendRawParams) => {
    log.info('[chat:send] session:', raw.session_id, 'content:', raw.content.slice(0, 20))
    if (!getMainWindow()) throw new Error('No main window')

    // 发送时现取窗口:macOS 关窗不退出,轮次仍在跑;对已销毁窗口 send 会抛错并打断本轮
    const send = (channel: string, payload: unknown): void => {
      const w = getMainWindow()
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
    }
    const liveWindow = () => {
      const w = getMainWindow()
      if (!w || w.isDestroyed()) throw new Error('Main window is closed')
      return w
    }

    const sid = raw.session_id
    const { messageId } = await sendChat(
      {
        sessionId: sid,
        content: raw.content,
        attachments: raw.attachments ?? [],
      },
      {
        onTextDelta: (mid, delta, stepIdx) =>
          send('chat:stream', {
            session_id: sid,
            message_id: mid,
            delta,
            done: false,
            step_index: stepIdx,
          }),
        onToolCall: (mid, id, name, input, stepIdx, startedAt) =>
          send('chat:tool-call', {
            session_id: sid,
            message_id: mid,
            tool_call_id: id,
            tool_name: name,
            input,
            step_index: stepIdx,
            started_at: startedAt,
          }),
        onToolResult: (mid, id, name, out, durationMs) =>
          send('chat:tool-result', {
            session_id: sid,
            message_id: mid,
            tool_call_id: id,
            tool_name: name,
            result: out,
            is_error: isErrorOutput(out),
            duration_ms: durationMs,
          }),
        // v3.6: 落库即通知 renderer 立即刷新, 替代 3s polling。
        // step_index 让 renderer 清掉已落库步对应的 streamItems, 防止
        // ToolCallMessage (持久) + ToolCallLog (流式) 同时显示同一步。
        onMessagePersisted: (persistedSid, stepIdx) =>
          send('chat:message-persisted', {
            session_id: persistedSid,
            step_index: stepIdx,
          }),
        onDone: (mid, err) =>
          send('chat:stream', {
            session_id: sid,
            message_id: mid,
            delta: '',
            done: true,
            step_index: -1,
            error_code: err?.code,
            error_message: err?.message,
          }),
      },
      {
        // 子 agent 共用父轮次的 confirmTool 端口:统一补 rootSessionId,
        // 渲染端据此把子 session / 工作台的确认请求归到发起本轮的 session
        confirmTool: (payload) =>
          requestToolConfirm(liveWindow(), { ...payload, rootSessionId: sid }),
        promptPermission: (payload) =>
          requestPermissionFromRenderer(liveWindow(), { ...payload, rootSessionId: sid }),
        agentManager,
      },
    )

    // 返回值按历史协议用 snake_case
    return { message_id: messageId }
  })

  ipcMain.handle('chat:abort', (_event, sessionId: string) => {
    streamRegistry.abort(sessionId)
  })
}
