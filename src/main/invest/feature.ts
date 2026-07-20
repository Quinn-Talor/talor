// src/main/invest/feature.ts —— 业务层: invest Feature(TalorFeatureMain 实现)
//
// invest 作为 Talor 第一个 Feature:init 建卡表 + 构造 store;agents() 声明 5 agent(工具按角色收窄写权限);
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

/**
 * 确保卡片有可用研究会话。卡的 origin_session 可能已被 schema 升级 drop / 用户删会话
 * 而卡仍在(悬空引用)→ 发消息会违反 messages.session_id 外键。此处若该会话不存在,就用
 * **同一 id** 重建、绑 stock-research agent(带建卡工具),使 card 引用保持有效、对话/发送同 id、
 * "更新卡片"可用。返回有效 session id;卡不存在返 null。providerId 由组合根注入(feature 不依赖 providers)。
 */
export function ensureCardSession(cardId: string, providerId: string): string | null {
  const card = investStore?.read(cardId)
  if (!card) return null
  const sid = card.head.origin_session_id
  if (sessionRepo.getById(sid)) return sid
  sessionRepo.create({
    id: sid,
    title: `投研 · ${card.head.name}`,
    provider_id: providerId,
    agent_id: 'stock-research',
    status: 'completed',
  })
  log.info('[invest] recreated dangling research session', sid, 'for card', cardId)
  return sid
}

/** 无卡发起研究:建一个绑 stock-research 的新会话(冷启动;PM 建卡前先有会话可对话)。 */
export function startResearchSession(providerId: string): string {
  const s = sessionRepo.create({
    title: '投研 · 新标的',
    provider_id: providerId,
    agent_id: 'stock-research',
    status: 'completed',
  })
  log.info('[invest] started card-less research session', s.id)
  return s.id
}

type InvestTool = ReturnType<typeof createInvestTools>[number]

/** 真相库写工具(会改 CardBundle 落盘)。读/检索/compute 不在此列,全员保留。 */
const CARD_WRITE_TOOLS = [
  'create_card',
  'set_eligibility',
  'add_facts',
  'add_thesis',
  'add_checkpoint',
  'add_decision',
  'add_review',
] as const

/**
 * 受限盒子·工具白名单(spec §7.1 + 验收「域 specialist 调不到建卡工具」):
 * 按 agent 角色收窄对**真相库的写授权**;读/检索/compute 全员保留(自发现不受影响)。
 * 返回该 agent 被禁的写工具名集合。
 */
function deniedWriteTools(agentId: string): ReadonlySet<string> {
  switch (agentId) {
    // 域 specialist + 空方·证伪官:只做分析/证伪,fan-out 交主 agent,自身零写权限(读/检索/compute 全保留)
    case 'stock-specialist':
    case 'industry-research':
    case 'macro-research':
    case 'short-thesis':
      return new Set(CARD_WRITE_TOOLS)
    // 复盘:只读历史 + 唯一写口 add_review(spec §6.3 复盘=只读历史)
    case 'review-analyst':
      return new Set(CARD_WRITE_TOOLS.filter((t) => t !== 'add_review'))
    // 主 agent(stock-research)及其它:全授权(建立编排 / 落卡 / 决策)
    default:
      return new Set()
  }
}

/** 按 agent 角色收窄工具集:滤掉被禁的真相库写工具,其余(读/检索/compute)全留。 */
function narrowTools(all: InvestTool[], agentId: string): InvestTool[] {
  const denied = deniedWriteTools(agentId)
  return all.filter((t) => !denied.has(t.name))
}

export const investFeatureMain: TalorFeatureMain = {
  id: 'invest',

  // ① 数据:建表 + 构造 store。
  init({ db }) {
    createCardTables(db)
    investStore = new CardRepo(db)
    log.info('[invest] feature initialized — card tables ready')
  },

  // ② agent:6 agent,工具按角色收窄真相库写权限(受限盒子):主 24 / 域 specialist·空方 17 / 复盘 18。
  //    create_card 经 rootSessionId 把 origin 上溯到根会话(S3)。
  agents(): FeatureAgent[] {
    if (!investStore) throw new Error('[invest] agents() called before init()')
    const all = createInvestTools({ store: investStore, resolveRootSession: rootSessionId })
    return INVEST_SEED_AGENTS.map((profile) => ({
      profile,
      tools: narrowTools(all, profile.id),
    }))
  },

  // ③ 读口:案卷按 id 取 CardBundle(artifact:read);池子按 type 列摘要(artifact:list)。写经工具,读经此。
  artifacts(): FeatureArtifact[] {
    return [
      {
        type: 'stock_card',
        read: (id: string) => investStore?.read(id) ?? null,
        list: () => investStore?.listAll() ?? [],
      },
    ]
  },

  mcpDeps: () => [
    {
      name: 'Playwright',
      hint: 'Settings → MCP: Playwright(浏览器检索权威公开页:交易所/巨潮/统计局/券商研报;数据=主路检索,key↔东财公开 JSON 接口见 docs/investment-agent/fact-keys.md)',
    },
  ],
}
