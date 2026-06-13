// src/main/features/install.ts — 启动期 Feature 融合循环(main 侧)
//
// 对每个 Feature 调 init(注册工具/建表)+ registerIpc,聚合 seedAgents 返回给调用方安装。
// 纯函数(不碰 fs/electron):seedAgents 的实际安装(拷贝到 ~/.talor/agents)由调用方处理,
// 保持本函数可单测。必须在 toolRegistry.listAll() 快照前调用(方案3:feature 工具进 builtin)。
//
// 允许依赖:./types
// 禁止依赖:任何具体业务

import type { FeatureInitCtx, SeedAgentRef, TalorFeatureMain } from './types'

/**
 * 融合所有 main 侧 Feature:逐个 init + registerIpc。
 * @returns 聚合的种子 agent 列表(调用方负责幂等安装到 ~/.talor/agents)。
 */
export function installFeatures(features: TalorFeatureMain[], ctx: FeatureInitCtx): SeedAgentRef[] {
  const seeds: SeedAgentRef[] = []
  for (const f of features) {
    f.init(ctx)
    f.registerIpc?.()
    seeds.push(...(f.seedAgents?.() ?? []))
  }
  return seeds
}
