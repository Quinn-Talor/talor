// src/main/features/install.ts — 启动期 Feature 融合(main 侧)
//
// **平台拥有注册**:对每个 Feature 依次 init(建数据) → agents(声明,逐个 registerAgent) →
// artifacts(声明读口,逐个 registerArtifactReader) → registerIpc → mcpDeps(校验缺失,告警)。
// feature 只声明贡献;注册动作经 ports 由平台执行 —— 加新业务平台核心零改动。
//
// 允许依赖:./types / electron-log
// 禁止依赖:任何具体业务

import log from 'electron-log'
import type { FeatureInitCtx, FeaturePorts, TalorFeatureMain } from './types'

/** 融合所有 main 侧 Feature。平台经 ports 注册各 Feature 声明的 agent / 读口,并校验 mcp 依赖。 */
export function installFeatures(
  features: TalorFeatureMain[],
  ctx: FeatureInitCtx,
  ports: FeaturePorts,
): void {
  for (const f of features) {
    f.init(ctx)
    for (const agent of f.agents?.() ?? []) ports.registerAgent(agent)
    for (const artifact of f.artifacts?.() ?? []) ports.registerArtifactReader(artifact)
    f.registerIpc?.()
    for (const dep of f.mcpDeps?.() ?? []) {
      if (!ports.isMcpConfigured(dep.name)) {
        log.warn(`[features] ${f.id} 需要 MCP server "${dep.name}" 未配置 — ${dep.hint}`)
      }
    }
  }
}
