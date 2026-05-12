// src/main/ipc/tool-confirm.ts —— 入口层：高风险工具确认端点 + 端口类型
//
// 允许依赖：shared/*
// 业务层（tools/build-tools.ts）只依赖 ToolConfirmPort 类型，不依赖 requestToolConfirm 实现，
// 以此满足"业务不 import 入口"的分层约束。

import { BrowserWindow, ipcMain } from 'electron'
import type { ToolConfirmRequest } from '@shared/types/message'

/**
 * 向渲染进程发起一次高风险工具的确认弹窗请求，返回用户是否同意执行。
 *
 * 协议：
 *   - main → renderer：`chat:tool-confirm` 发送 ToolConfirmRequest
 *   - renderer → main：`chat:tool-confirm-response` 回 `{ toolCallId, decision }`
 *     只有 `toolCallId` 匹配的响应才被本次 Promise 消费（防止串流）
 *
 * 30 秒超时自动 reject 为"未同意"，避免卡死 ReAct 循环。
 */
export async function requestToolConfirm(
  mainWindow: BrowserWindow,
  req: ToolConfirmRequest,
): Promise<{ approved: boolean; remember: boolean }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve({ approved: false, remember: false })
    }, 30_000)

    const handler = (
      _event: Electron.IpcMainEvent,
      response: { toolCallId: string; decision: string; remember?: boolean },
    ) => {
      if (response.toolCallId !== req.toolCallId) return
      clearTimeout(timeout)
      ipcMain.removeListener('chat:tool-confirm-response', handler)
      resolve({
        approved: response.decision === 'approved',
        remember: !!response.remember,
      })
    }

    ipcMain.on('chat:tool-confirm-response', handler)
    mainWindow.webContents.send('chat:tool-confirm', req)
  })
}

/**
 * 给高风险工具构造用户可读的"输入摘要"供 UI 确认弹窗展示。
 * 纯格式化，长度上限 500，不抛错。
 * 按 toolName 裁剪显示：bash 只显示命令；write/edit 显示路径 + 片段；其它 JSON 原样截断。
 */
export function buildInputSummary(toolName: string, input: unknown): string {
  const MAX = 500
  const obj = input as Record<string, unknown>
  if (toolName === 'bash') {
    return String(obj.command ?? '').slice(0, MAX)
  }
  if (toolName === 'write') {
    const lines = String(obj.content ?? '')
      .split('\n')
      .slice(0, 20)
      .map((l) => l.slice(0, 80))
    return `文件: ${obj.path}\n\n${lines.join('\n')}`.slice(0, MAX)
  }
  if (toolName === 'edit') {
    const lines = String(obj.old_str ?? '')
      .split('\n')
      .slice(0, 10)
      .map((l) => l.slice(0, 80))
    return `文件: ${obj.path}\n旧内容:\n${lines.join('\n')}`.slice(0, MAX)
  }
  return JSON.stringify(input).slice(0, MAX)
}

/**
 * 工具确认端口 (v3.6 扩展)。
 *
 * 业务层 (tools/build-tools.ts, tools/risk-gate.ts) 只依赖此签名。
 *
 * 返回值兼容两种形态:
 *   - boolean (legacy: bash/write/edit 现有路径)
 *   - { approved, remember } (v3.6 RiskGate 新路径, 带 remember 信号)
 *
 * 入口层 ipc/chat.ts 注入绑定 mainWindow 的实现:
 *   { confirmTool: (payload) => requestToolConfirm(mainWindow, payload) }
 */
export type ToolConfirmPort = (
  payload: ToolConfirmRequest,
) => Promise<boolean | { approved: boolean; remember?: boolean }>
