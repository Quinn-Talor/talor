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
    const win = getMainWindow()
    if (!win) throw new Error('No main window')

    const sid = raw.session_id
    const { messageId } = await sendChat(
      {
        sessionId: sid,
        content: raw.content,
        attachments: raw.attachments ?? [],
      },
      {
        onTextDelta:  (mid, delta)           => win.webContents.send('chat:stream',      { session_id: sid, message_id: mid, delta, done: false }),
        onToolCall:   (mid, id, name, input) => win.webContents.send('chat:tool-call',   { session_id: sid, message_id: mid, tool_call_id: id, tool_name: name, input }),
        onToolResult: (mid, id, name, out)   => win.webContents.send('chat:tool-result', { session_id: sid, message_id: mid, tool_call_id: id, tool_name: name, result: out }),
        onDone:       (mid, err)             => win.webContents.send('chat:stream',      { session_id: sid, message_id: mid, delta: '', done: true, error_code: err?.code, error_message: err?.message }),
      },
      {
        confirmTool: (payload) => requestToolConfirm(win, payload),
        promptPermission: (payload) => requestPermissionFromRenderer(win, payload),
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
