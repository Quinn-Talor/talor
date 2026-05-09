// src/main/providers/registry.ts — 业务层：默认模型 + 已注册模型枚举
//
// Schema 1.0 模型策略:
//   - DEFAULT_MODEL = 'claude-opus-4-7' (latest Claude Opus)
//   - DEFAULT_PROVIDER = 'anthropic'
//   - 业务 / 平台 agent profile 不写 preferences.modelId 时用 DEFAULT_MODEL
//   - profile.preferences.modelId 必须是已注册模型,否则 validator §12 报错
//
// 不做向后兼容: 旧模型 id (claude-3-* 等) 直接从 known list 移除,profile 写过时
// 模型会被 validator reject 加载。capability detector 仍含旧 regex 用于已存在
// session/历史记录的兼容显示。
//
// 允许依赖: Node 标准库
// 禁止依赖: ipc/*

/** 当前默认 Claude Opus 模型 (latest). 升级时直接修改此常量 + 内置 platform profile 同步. */
export const DEFAULT_MODEL = 'claude-opus-4-7'
export const DEFAULT_PROVIDER = 'anthropic'

/** Schema 1.0 已注册的模型 id 集合。validator §12 通过 ValidatorContext.knownModelIds 引用此集合. */
const REGISTERED_MODELS: ReadonlyArray<string> = [
  // Anthropic — latest only
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',

  // OpenAI — latest series (gpt-4o / gpt-5 / o1 by registry's actual catalog)
  // 项目 ConfigStore 实际维护 provider+model 列表;此处只列 schema 校验用的"已知"模型 id 子集
  // (validator 校验 profile.preferences.modelId 是否在此集合)
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-5',
  'o1',

  // Google
  'gemini-2.5-pro',
  'gemini-2.5-flash',

  // Ollama (local) — 用户自配置,保留通配
  // 校验时可选放宽 ollama:* 前缀;P0 仅列固定常用名
  'llama-3.3',
  'qwen-2.5',
]

const MODEL_SET: ReadonlySet<string> = new Set(REGISTERED_MODELS)

/** 返回已注册模型 id 列表(只读). */
export function listRegisteredModels(): readonly string[] {
  return REGISTERED_MODELS
}

/** 已注册集合,validator §12 用. */
export function getRegisteredModelSet(): ReadonlySet<string> {
  return MODEL_SET
}

/** 是否已注册模型. */
export function isRegisteredModel(id: string): boolean {
  return MODEL_SET.has(id)
}
