// src/main/features/types.ts — Feature 契约(main 侧)
//
// 业务以 Feature 形式融入 Talor。**一个 Feature = 一类业务的完全封装**:数据 + agent + tool +
// mcp 依赖 + IPC + UI(渲染半见 renderer/artifacts/registry.ts)。
// 平台只依赖本接口,对具体业务无感知 —— 面向接口编程,业务从外部插入。
//
// 设计依据:docs/talor-feature-architecture.md。
// 允许依赖:better-sqlite3(type)/ ../tools/types(type)/ ../../shared/types/agent(type)
// 禁止依赖:任何具体业务(invest/…)—— 平台核心对业务无感知

import type { Database } from 'better-sqlite3'
import type { ToolDefinition } from '../tools/types'
import type { AgentProfile } from '../../shared/types/agent'

/** init 时平台注入的上下文(建数据用)。 */
export interface FeatureInitCtx {
  db: Database
}

/** Feature 声明的一个 agent + 它的工具(内聚:agent 与其工具一体声明,不再两结构按 id 重接)。 */
export interface FeatureAgent {
  profile: AgentProfile
  /** 该 agent 的 feature 工具(per-agent 作用域,平台注入为 agentTools,不进全局 builtin)。 */
  tools?: ToolDefinition[]
}

/** Feature 声明的一个业务对象读口(按 type;平台通用 artifact:read IPC 据此路由给 UI 取数)。 */
export interface FeatureArtifact {
  type: string
  read(id: string): unknown
}

/**
 * 业务 Feature 的 main 侧契约 —— 一个 Feature = 一类业务的完全封装。
 * feature 只**声明**贡献(纯数据 / 读口),**平台拥有注册**(installFeatures 编排):
 *   init(建数据) → agents(声明 agent+工具) → artifacts(声明读口) → registerIpc → mcpDeps(校验)。
 */
export interface TalorFeatureMain {
  id: string
  /** ① 建表 + 构造 store(只数据,不碰 agent)。 */
  init(ctx: FeatureInitCtx): void
  /** ② 声明本业务 agent(连工具);平台注册进 AgentManager(origin=feature,内存,不落盘)。 */
  agents?(): FeatureAgent[]
  /** ③ 声明业务对象读口(按 type);平台经通用 artifact:read IPC 暴露给 UI。 */
  artifacts?(): FeatureArtifact[]
  /** 可选:其他自有只读 IPC(读口走 artifacts() 时可省)。 */
  registerIpc?(): void
  /** 可选:声明依赖的 MCP server(installFeatures 校验配置,缺失提示用户)。 */
  mcpDeps?(): { name: string; hint: string }[]
  /** 预留:停用 Feature 时注销(注销 agent / 读口 / IPC)。暂未实现。 */
  dispose?(): void
}

/** 平台注入给 installFeatures 的注册端口(平台内部动作;feature 看不到,保持只声明)。 */
export interface FeaturePorts {
  registerAgent(agent: FeatureAgent): void
  registerArtifactReader(artifact: FeatureArtifact): void
  isMcpConfigured(serverName: string): boolean
}
