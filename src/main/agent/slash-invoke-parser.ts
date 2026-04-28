// src/main/agent/slash-invoke-parser.ts — 业务层：/agent名 指令 解析
//
// 允许依赖：agent/*
// 禁止依赖：ipc/*

import type { AgentEntry } from '@shared/types/agent'
import type { AgentLoader } from './loader'

export interface SlashInvokeResult {
  entry: AgentEntry
  remainingText: string
}

export function parseSlashInvoke(
  text: string,
  loader: AgentLoader,
): SlashInvokeResult | null {
  if (!text.startsWith('/')) return null

  const trimmed = text.slice(1)
  const spaceIndex = trimmed.indexOf(' ')
  const agentName = spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed
  const remainingText = spaceIndex >= 0 ? trimmed.slice(spaceIndex + 1).trim() : ''

  if (!agentName) return null

  const entry = loader.getByName(agentName)
  if (!entry) return null

  return { entry, remainingText }
}
