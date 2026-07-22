// src/main/invest/tools/index.ts —— 业务层: invest 工具入口(14 compute + 10 card + 1 fetch)
//
// 被 feature.init 注册进全局 toolRegistry(R4 接线)。compute=薄包纯函数,card=薄包 CardRepo(写=apply),
// fetch_metric=从权威机构源程序化取数(fetchJson 默认真 east-money;callMcp 缺省=tushare 未装)。
// 允许依赖: ./compute-tools / ./card-tools / ../fetch/fetch-metric / ../store / ../../tools/types
// 禁止依赖: ipc/* / mcp/*

import type { ToolDefinition } from '../../tools/types'
import type { CardRepo } from '../store'
import { createComputeTools } from './compute-tools'
import { createCardTools } from './card-tools'
import {
  createFetchMetricTool,
  realFetchJson,
  type FetchJson,
  type CallMcp,
} from '../fetch/fetch-metric'

export { createComputeTools } from './compute-tools'
export { createCardTools } from './card-tools'

/** 全部 invest 工具 = 14 compute + 10 card + 1 fetch_metric(共 25)。 */
export function createInvestTools(deps: {
  store: CardRepo
  resolveRootSession?: (sid: string) => string
  fetchJson?: FetchJson // 默认真 east-money;测试可注入 mock
  callMcp?: CallMcp // 金融 MCP(tushare 类);缺省=未装,fetch_metric 回落 json
}): ToolDefinition[] {
  return [
    ...createComputeTools(),
    ...createCardTools(deps.store, deps.resolveRootSession),
    createFetchMetricTool({ fetchJson: deps.fetchJson ?? realFetchJson, callMcp: deps.callMcp }),
  ]
}
