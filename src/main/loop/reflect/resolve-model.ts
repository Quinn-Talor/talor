// src/main/loop/reflect/resolve-model.ts —— 业务层: 解析 reflect 用的便宜 model
//
// 优先级:
//   1. agent.profile.preferences.reflectModelId (per-agent 显式锁定)
//   2. provider.reflect_model_id (provider 级默认)
//   3. null → L2 LLM reflector 不实例化, 退化到 L1 reflector + 硬编码兜底
//
// 允许依赖: ../../providers/model-adapter, ../../agent/agent (类型), ../../store/config-store (类型)
// 禁止依赖: ipc/*

import type { LanguageModel } from 'ai'
import { getAdapter } from '../../providers/model-adapter'
import type { Agent } from '../../agent/agent'
import type { Provider } from '../../store/config-store'

export function resolveReflectModel(agent: Agent, provider: Provider): LanguageModel | null {
  const reflectId =
    agent?.profile?.preferences?.reflectModelId ?? provider?.reflect_model_id ?? null
  if (!reflectId) return null
  try {
    const adapter = getAdapter(provider.type)
    return adapter.createModel(provider, reflectId)
  } catch {
    return null
  }
}
