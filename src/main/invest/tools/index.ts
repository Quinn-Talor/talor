// src/main/invest/tools/index.ts —— 业务层: invest 工具入口(14 compute + 9 card)
//
// 被 feature.init 注册进全局 toolRegistry(R4 接线)。compute=薄包纯函数,card=薄包 CardRepo(写=apply)。
// 允许依赖: ./compute-tools / ./card-tools / ../store / ../../tools/types
// 禁止依赖: ipc/* / mcp/*

import type { ToolDefinition } from '../../tools/types'
import type { CardRepo } from '../store'
import { createComputeTools } from './compute-tools'
import { createCardTools } from './card-tools'

export { createComputeTools } from './compute-tools'
export { createCardTools } from './card-tools'

/** 全部 invest 工具 = 14 compute + 9 card 工具(共 23)。 */
export function createInvestTools(deps: {
  store: CardRepo
  resolveRootSession?: (sid: string) => string
}): ToolDefinition[] {
  return [...createComputeTools(), ...createCardTools(deps.store, deps.resolveRootSession)]
}
