// src/main/chat/types.ts — 聊天用例的入参、UI 回调与端口类型（旧编排与引擎路径共用）
//
// 从 chat/orchestrator.ts 移来：阶段 D 删除旧编排后，引擎路径仍从这里引用。只放类型。
//
// 允许依赖: ipc/error-codes、ipc/tool-confirm、permissions/port、agent/agent-manager（均为 type import）、@shared/*
// 禁止依赖: 任何运行时 import

import type { RunStatus } from '@shared/turn-phase'
import type { ChatErrorCode } from '../ipc/error-codes'
import type { ToolConfirmPort } from '../ipc/tool-confirm'

/** chat:send 业务入参（camelCase；入口层负责 snake_case ↔ camelCase 转换）。 */
export interface ChatSendParams {
  sessionId: string
  content: string
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

/**
 * UI 事件回调。入口层把每个回调桥接到 `webContents.send('chat:xxx', ...)`。
 *
 * 设计：单一出口 `onDone` 表示流结束；err 非空代表这次请求没能正常完成，
 * 前端通过 `err.code` 做差异化提示（如"API key 无效"），不需要额外的 error 事件。
 */
export interface ChatCallbacks {
  onTextDelta(messageId: string, delta: string, stepIndex: number): void
  onToolCall(
    messageId: string,
    toolCallId: string,
    toolName: string,
    input: unknown,
    stepIndex: number,
    startedAt: number,
  ): void
  onToolResult(
    messageId: string,
    toolCallId: string,
    toolName: string,
    output: unknown,
    durationMs: number,
  ): void
  /**
   * v3.6: 主进程一条消息落库后触发。入口层桥接到
   * `webContents.send('chat:message-persisted', { sessionId, stepIndex })`,
   * renderer 收到事件立即调 loadMessages, 替代 3s polling。
   *
   * stepIndex 用于 renderer 清理 streamItems 中 step <= 该值的项, 避免
   * 已落库 message 与 streaming UI 同时显示同一步工具调用(1:1 视觉重复)。
   */
  onMessagePersisted?(sessionId: string, stepIndex: number): void
  /** 引擎路径：推理模型的思考增量（旧路径不调用）。 */
  onReasoningDelta?(messageId: string, delta: string, stepIndex: number): void
  /** 引擎路径：交付验收期间为 verifying，结束回到 idle（旧路径不调用）。 */
  onRunStatus?(messageId: string, status: RunStatus): void
  onDone(messageId: string, err?: { code: ChatErrorCode; message: string }): void
}

/**
 * 端口注入：业务层声明"需要什么能力"，具体实现由入口层提供。
 * confirmTool 绑定了 mainWindow 的 `requestToolConfirm` 调用。
 * promptPermission 用于跨 workspace 路径/命令的用户授权（PR #5）。
 */
export interface ChatPorts {
  confirmTool: ToolConfirmPort
  promptPermission?: import('../permissions/port').PermissionUIPrompt
  agentManager: import('../agent/agent-manager').AgentManager
}
