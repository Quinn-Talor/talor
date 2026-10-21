// src/main/agent/draft-normalize.ts — 业务层:沉淀草稿入库前的格式归一
//
// 允许依赖:shared/*
// 禁止依赖:ipc/*

import type { AgentProfile } from '@shared/types/agent'

/**
 * LLM 产出的草稿常把 subagents.ids 写成 agent id 字符串数组;schema 要求 {id, required}
 * 对象。在入库前归一,避免沉淀因格式差异被 validator 拒绝。
 */
export function normalizeDraftSubagents(profile: AgentProfile): AgentProfile {
  const ids = (profile as { subagents?: { ids?: unknown } }).subagents?.ids
  if (!Array.isArray(ids) || !ids.some((x) => typeof x === 'string')) return profile
  return {
    ...profile,
    subagents: {
      ...profile.subagents,
      ids: ids.map((x) => (typeof x === 'string' ? { id: x, required: true } : x)),
    },
  } as AgentProfile
}
