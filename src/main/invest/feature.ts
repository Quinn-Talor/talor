// src/main/invest/feature.ts —— 业务层: invest Feature(TalorFeatureMain 实现)
//
// invest 作为 Talor 第一个 Feature:init 建卡表 + 构造 store;agents() 声明 5 agent(连 23 工具);
// artifacts() 声明 stock_card 读口(平台通用 artifact:read 路由,供案卷面板取数);mcpDeps 声明 Playwright。
// 只**声明**贡献,平台经 installFeatures 注册;本文件不碰平台内部、不开 IPC。
// 设计依据: docs/talor-feature-architecture.md(TalorFeatureMain 契约)。
//
// 允许依赖: ../features/types / ../repos/session-repo / ./store / ./tools / ./agents
// 禁止依赖: ipc/* / mcp/* / electron

import log from 'electron-log'
import type { FeatureAgent, FeatureArtifact, TalorFeatureMain } from '../features/types'
import { sessionRepo } from '../repos/session-repo'
import { CardRepo, createCardTables } from './store'
import { createInvestTools } from './tools'
import { INVEST_SEED_AGENTS } from './agents'

/** S3:沿 parent_session 链上溯到根会话(委托子会话建的卡归用户主会话)。 */
function rootSessionId(sid: string): string {
  let cur = sid
  for (let i = 0; i < 64; i++) {
    const s = sessionRepo.getById(cur)
    if (!s?.parent_session_id) return cur
    cur = s.parent_session_id
  }
  return cur
}

/** 模块级 store(init 时构造,agents() / artifacts() 引用)。 */
let investStore: CardRepo | null = null

/** 供测试/外部读取当前 store(未 init 返 null)。 */
export function getInvestStore(): CardRepo | null {
  return investStore
}

export const investFeatureMain: TalorFeatureMain = {
  id: 'invest',

  // ① 数据:建表 + 构造 store。
  init({ db }) {
    createCardTables(db)
    investStore = new CardRepo(db)
    log.info('[invest] feature initialized — card tables ready')
  },

  // ② agent:5 agent,各带全部 23 invest 工具(14 compute + 9 card)。
  //    create_card 经 rootSessionId 把 origin 上溯到根会话(S3)。
  agents(): FeatureAgent[] {
    if (!investStore) throw new Error('[invest] agents() called before init()')
    const tools = createInvestTools({ store: investStore, resolveRootSession: rootSessionId })
    return INVEST_SEED_AGENTS.map((profile) => ({ profile, tools }))
  },

  // ③ 读口:案卷面板按 id 取 CardBundle(平台通用 artifact:read 路由;写经工具,读经此)。
  artifacts(): FeatureArtifact[] {
    return [{ type: 'stock_card', read: (id: string) => investStore?.read(id) ?? null }]
  },

  mcpDeps: () => [
    {
      name: 'Playwright',
      hint: 'Settings → MCP: Playwright(浏览器检索权威公开页:交易所/巨潮/统计局/券商研报;数据=主路检索,key↔东财公开 JSON 接口见 docs/investment-agent/fact-keys.md)',
    },
  ],
}
