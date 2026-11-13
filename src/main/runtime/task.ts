// src/main/runtime/task.ts — 业务层：会话的一轮组装成 agent-engine 的任务
//
// 本轮输入（前置输入在前、用户输入在最后一段）、易变信息（日期、操作系统、工作区）、作业范围、会话 id 与
// 步数上限组装成任务。前文不在任务里：
// 每一轮带上会话 id 开始，带入的窗口由引擎从会话日志推导（会话方案 §6）。
//
// 允许依赖: agent-engine、ai（类型）
// 禁止依赖: ipc/*、repos/*、db/*

import type { UserContent } from 'ai'
import { defineTask, type ContentPart, type Segment, type Task } from '@talor/agent-engine'

type Part = Record<string, unknown>

const isPart = (value: unknown): value is Part =>
  value !== null && typeof value === 'object' && typeof (value as Part).type === 'string'

const partsOf = (content: unknown): Part[] => (Array.isArray(content) ? content.filter(isPart) : [])

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

export function userPartsOf(content: UserContent): ContentPart[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return partsOf(content).flatMap((part): ContentPart[] => {
    if (part.type === 'text') return [{ type: 'text', text: str(part.text) }]
    if (part.type === 'image' && typeof part.image === 'string') {
      return [
        {
          type: 'image',
          image: part.image,
          ...(typeof part.mediaType === 'string' ? { mediaType: part.mediaType } : {}),
        },
      ]
    }
    if (part.type === 'file' && typeof part.data === 'string') {
      return [
        {
          type: 'file',
          data: part.data,
          mediaType: str(part.mediaType),
          ...(typeof part.filename === 'string' ? { filename: part.filename } : {}),
        },
      ]
    }
    return []
  })
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 本会话上一轮之后权限规则变了（例如插件 hook 启用或停用）时附在尾部的说明。 */
export const RULES_CHANGED_NOTE =
  'Permission rules have changed since the previous turn of this session (for example a plugin hook was enabled or disabled). Actions that were denied earlier may now be allowed: if the user asks for one again, try it.'

export function volatileOf(workspace: string, now: Date, rulesChanged = false): Segment[] {
  const text = [
    `Current date: ${localDate(now)}`,
    `Operating system: ${process.platform}`,
    `Workspace: ${workspace || '(not set)'}`,
    ...(rulesChanged ? [RULES_CHANGED_NOTE] : []),
  ].join('\n')
  return [{ role: 'system', parts: [{ type: 'text', text }] }]
}

export function taskFor(input: {
  sessionId: string
  workspace: string
  userContent: UserContent
  /** 前置输入：每条成为一段 user 输入，排在用户输入之前（例如提炼工作台的源对话快照）。 */
  preface?: readonly string[]
  maxSteps?: number
  now: Date
  /** 本会话上一轮之后权限规则变了。 */
  rulesChanged?: boolean
}): Task {
  const { sessionId, workspace, maxSteps } = input
  return defineTask({
    input: [
      ...(input.preface ?? []).map((text) => ({
        role: 'user' as const,
        parts: [{ type: 'text' as const, text }],
      })),
      { role: 'user', parts: userPartsOf(input.userContent) },
    ],
    volatile: volatileOf(workspace, input.now, input.rulesChanged ?? false),
    ...(workspace ? { scope: { workspace } } : {}),
    subject: sessionId,
    ...(maxSteps !== undefined && maxSteps > 0 ? { budget: { maxSteps } } : {}),
  })
}
