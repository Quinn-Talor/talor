// src/main/features/types.ts — Feature 契约(main 侧)
//
// 业务以 Feature 形式融入 Talor。本契约是 main 进程半:注册工具(写/读对象)+ 可选只读 IPC
// + 可选种子 agent + 可选 MCP 依赖声明。renderer 半(ArtifactUI 注册)见 renderer/artifacts/registry.ts。
//
// 设计依据:docs/talor-feature-architecture.md §4。
// 允许依赖:better-sqlite3(type)/ ../tools/registry(type)
// 禁止依赖:任何具体业务(invest/…)—— 平台核心对业务无感知

import type { Database } from 'better-sqlite3'
import type { toolRegistry } from '../tools/registry'

/** Feature init 时平台注入的上下文。 */
export interface FeatureInitCtx {
  db: Database
  tools: typeof toolRegistry
}

/** 种子 agent 引用:repo 内的 agent 目录,启动期幂等装到 ~/.talor/agents。 */
export interface SeedAgentRef {
  id: string
  /** repo 内绝对/相对目录(含 agent.json + prompt.md)。 */
  dir: string
}

/** 业务 Feature 的 main 侧契约。 */
export interface TalorFeatureMain {
  id: string
  /** 建表 + 注册写/读工具 + 构造 store。必须在 toolRegistry.listAll() 快照前被调用。 */
  init(ctx: FeatureInitCtx): void
  /** 可选:注册 feature 自有只读 IPC(给 UI 读对象)。 */
  registerIpc?(): void
  /** 可选:声明种子 agent(平台幂等安装)。 */
  seedAgents?(): SeedAgentRef[]
  /** 可选:声明依赖的 MCP server(dep-checker 校验,缺失提示用户)。 */
  mcpDeps?(): { name: string; hint: string }[]
}
