// src/main/invest/tools/card-tools.ts —— 业务层: card builtin 工具(薄包 CardRepo,写=建 CardCmd→apply)
//
// 终稿模型:create / get_card / set_eligibility / add_facts / add_thesis / add_checkpoint
//   / add_decision / add_review / get_timeline。写 = 建 CardCmd → store.apply(统一入口)。
//   create_card 从 ctx.sessionId(经 resolveRootSession 上溯根会话)取 origin。
//   CardValidationError(store 抛的不变量)→ ToolErrorEnvelope(§4.1),其余异常上抛。
//
// 允许依赖: zod / ../../tools/types / ../store
// 禁止依赖: ipc/* / mcp/*

import { z } from 'zod'
import type { ToolDefinition, ToolErrorEnvelope, ToolExecuteContext } from '../../tools/types'
import { CardRepo, CardValidationError } from '../store'
import type {
  CardBundle,
  Eligibility,
  Facts,
  ThesisSnapshot,
  Checkpoint,
  DecisionEvent,
  ReviewEvent,
} from '../../../shared/types/invest'

function jsonSchema(s: z.ZodTypeAny): Record<string, unknown> {
  return z.toJSONSchema(s) as Record<string, unknown>
}
function envelope(code: string, message: string): ToolErrorEnvelope {
  return { __talor_error: true, code, message }
}
function run(fn: () => unknown): { output: unknown } {
  try {
    return { output: fn() }
  } catch (e) {
    if (e instanceof CardValidationError) return { output: envelope(e.code, e.message) }
    throw e
  }
}

// —— Zod(结构定型;不变量校验在 store)——

// ① 事实(三维:数值/变化/结构)
const FactStructureZ = z.object({
  note: z.string(),
  quality: z.enum(['healthy', 'mixed', 'deteriorating']).optional(),
  components: z
    .array(
      z.object({
        name: z.string(),
        value: z.string().optional(),
        signal: z.enum(['good', 'bad', 'neutral']).optional(),
      }),
    )
    .optional(),
})
const FactChangeZ = z.object({
  yoy: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  momentum: z.enum(['accelerating', 'decelerating', 'reversing', 'flat']).optional(),
  trend_note: z.string().optional(),
  turnover_days: z.number().optional(),
  turnover_trend: z.string().optional(),
  percentile: z.number().optional(),
})
const FactObservationZ = z.object({
  value: z.union([z.string(), z.number()]),
  as_of: z.string().describe('必填:事实时点 ISO'),
  source: z.string().describe('必填:白名单来源'),
  tier: z.enum(['T1', 'T2', 'T3', 'compute']).optional(),
  change: FactChangeZ.optional().describe('变化维(趋势/动能/周转,可 compute 派生)'),
  structure: FactStructureZ.optional().describe('结构维(拆解+质量)'),
})
const FactZ = z.object({
  level: z.enum(['macro', 'industry', 'company']),
  label: z.string(),
  unit: z.string().nullable().optional(),
  role: z.enum(['先行', '同步', '滞后', '排雷']).optional(),
  series: z.array(FactObservationZ).describe('按 key 的观测序列(只增不改)'),
})
const FactsZ = z.record(z.string(), FactZ).describe('key → 事实序列(主轴是 key,三层 level tag)')

// ② 逻辑
const VRangeZ = z.object({ bear: z.number(), base: z.number(), bull: z.number() })
const VerifyHookZ = z.object({
  fact: z.string().describe('ref facts key'),
  at: z.string().describe('验收时点/频率:monthly/quarterly/annual/日期'),
  role: z.enum(['先行', '终验']).optional(),
})
// 估值预测参数(吸收原 Driver):每参数双向挂事实;命门=high 带 logic_anchor/falsify
const ValuationAssumptionZ = z.object({
  key: z.string().describe('参数键(可复用 fact key,或估值专用如 pe_central)'),
  label: z.string(),
  unit: z.string().optional(),
  bear: z.union([z.string(), z.number()]).describe('熊(proj_mode≠absolute 时为相对锚的推测)'),
  base: z.union([z.string(), z.number()]).describe('中性'),
  bull: z.union([z.string(), z.number()]).describe('牛'),
  proj_mode: z
    .enum(['delta', 'factor', 'absolute'])
    .optional()
    .describe('推测方式:未来=锚(from_fact最新)应用 delta(锚+值)/factor(锚×值);默认 absolute 直取'),
  from_fact: z
    .string()
    .optional()
    .describe('立足:派生自 facts key@as_of(锚=该指标最新;须已 add_facts)'),
  verify: z.array(VerifyHookZ).optional().describe('验证:对账事实(命门必填,先行+终验)'),
  sensitivity: z.enum(['high', 'mid', 'low']).optional().describe('high=命门'),
  logic_anchor: z.string().optional().describe('命门:挂哪条逻辑(空话拒)'),
  falsify: z.string().optional().describe('命门:证伪线'),
  market_implied: z.string().optional().describe('现价反推的市场隐含(预期差=base vs 此)'),
})
const ValuationZ = z.object({
  method: z.enum(['pe', 'dcf', 'pb-roe', 'ddm', 'nav']),
  method_reason: z.string().optional(),
  assumptions: z
    .array(ValuationAssumptionZ)
    .describe('全部估值预测参数(命门+支撑;每参数挂事实;compute 吃它出 V)'),
  V: VRangeZ.describe('价值区间(compute 从 assumptions 算)'),
  margin_of_safety: z.object({
    required: z.number().describe('安全边际门槛(0~1,随不确定性放大)'),
    anchor: z.enum(['bear', 'base']).optional(),
    required_basis: z.string().optional(),
  }),
})
const ThesisSnapshotZ = z.object({
  v: z.number(),
  at: z.string(),
  scope: z.enum(['建立', '校准', '重写']),
  claim: z.string().describe('论点一句话(大白话,散户决策面头条)'),
  profit_type: z.enum(['成长', '拐点', '估值修复', '周期', '分红']),
  valuation: ValuationZ,
  ref_checkpoint: z.string().optional(),
})

// ③ 时间线
const AssumptionCheckZ = z.object({
  assumption: z.string().describe('ref valuation.assumptions[].key'),
  predicted: z.union([z.string(), z.number()]).describe('取自 against_v 版该参数 base(不回溯)'),
  actual: z.union([z.string(), z.number()]).describe('取自 facts[verify.fact] 最新'),
  actual_fact: z.string().optional().describe('ref key@as_of'),
  deviation: z
    .object({
      数值: z.string().optional(),
      结构: z.string().optional(),
      变化: z.string().optional(),
    })
    .optional(),
  outcome: z
    .enum(['超预期', '兑现', '容差', '偏离', '破'])
    .describe('双向(含容差判定):超预期/兑现/容差=未破、偏离=校准、破=证伪'),
  attribution: z
    .object({ cause: z.string(), type: z.enum(['噪声', '外生', '参数错', '机制错']) })
    .optional()
    .describe('偏离/破 才需归因'),
})
const ValueNowZ = z.object({
  V: VRangeZ,
  price: z.number().optional(),
  realized_pct: z.number().optional(),
  margin_of_safety: z.object({
    to_bear: z.string().optional(),
    vs_required: z.string().optional(),
    at_buy_point: z.boolean().describe('★建/加仓硬门'),
    buy_trigger: z.number().optional().describe('买点价上限(compute 算)'),
  }),
})
const CheckpointZ = z.object({
  type: z.literal('复查'),
  at: z.string(),
  against_v: z.number().describe('锚出身版本(不回溯)'),
  validity: z
    .enum(['强化', '持有', '校准', '证伪'])
    .describe('双向验证产物(强化/持有不换版,校准/证伪出新版)'),
  conviction: z.enum(['high', 'mid', 'low']).optional().describe('确信度(强化累积↑)→ 喂仓位'),
  checks: z.array(AssumptionCheckZ),
  value_now: ValueNowZ,
  gate: z.object({
    state: z.enum(['通行', '警告', '节流', '否决']),
    reason: z.array(z.string()).optional(),
  }),
  spawned_v: z.number().nullable(),
  signal: z.object({ verdict: z.enum(['买', '等', '弃', '减']), reason: z.string() }),
})
const DecisionEventZ = z.object({
  type: z.literal('决策'),
  at: z.string(),
  trade: z.enum(['建', '加', '减', '清']),
  price: z.number().optional(),
  weight: z.number().optional().describe('仓位(compute 按 边际深度×确信度×风险预算 出)'),
  based_v: z.number().optional().describe('依据的逻辑版本(默认当前版)'),
  reason: z.string().describe('必填'),
  override: z.boolean().optional().describe('逆 gate/边际,留痕'),
})
const ReviewEventZ = z.object({
  type: z.literal('复盘'),
  at: z.string(),
  vs_benchmark: z.object({
    satellite: z.number(),
    index: z.number(),
    verdict: z.enum(['跑赢', '跑输']),
  }),
  lesson: z.string().optional(),
  ref_v: z.number().optional(),
})

const GoodBusinessZ = z.object({
  quality_gate: z.enum(['pass', 'fail']).describe('质量门(收现/FCF/扣非/商誉;数值在 facts)'),
  moat: z.object({
    type: z.string().describe('护城河类型(品牌/转换成本/网络/成本/资源/无)'),
    durability: z.enum(['长', '中', '短', '无']).describe('久期 → 喂估值久期假设'),
  }),
  grade: z.enum(['优', '良', '平庸', '不过']).describe('好生意分档 → 调安全边际门槛'),
})
const EligibilityZ = z.object({
  red_flags: z.number(),
  source_positive: z.boolean(),
  in_circle: z.boolean(),
  pass: z.boolean(),
  good_business: GoodBusinessZ.optional().describe('好生意体检(判断-only,数值在 facts)'),
})

const CreateZ = z.object({ code: z.string(), name: z.string() })
const CardIdZ = z.object({ card_id: z.string() })

function def<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  zodSchema: S,
  exec: (input: z.infer<S>, ctx: ToolExecuteContext) => { output: unknown },
): ToolDefinition {
  return {
    name,
    description,
    zodSchema,
    parameters: jsonSchema(zodSchema),
    async execute(input, ctx) {
      return exec(input as z.infer<S>, ctx)
    },
  }
}

/** 工厂:返回 9 个 card 工具(注入 store)。resolveRootSession:S3 把 ctx.sessionId 上溯根会话作 origin。 */
export function createCardTools(
  store: CardRepo,
  resolveRootSession: (sid: string) => string = (s) => s,
): ToolDefinition[] {
  const resolveCardId = (given: string, ctx: ToolExecuteContext): string | null => {
    if (store.read(given)) return given
    return store.findOpenCardId(resolveRootSession(ctx.sessionId), given)
  }
  const NOT_FOUND = (given: string): ToolErrorEnvelope =>
    envelope(
      'CARD_NOT_FOUND',
      `卡不存在:"${given}" 既非有效卡 id、也未匹配本会话未平仓标的。先 create_card,再用返回 card_id(或直接传股票代码)。`,
    )
  const summary = (b: CardBundle) => ({
    card_id: b.id,
    code: b.head.code,
    name: b.head.name,
    status: b.head.status,
    versions: b.thesis?.versions.length ?? 0,
    checkpoints: b.timeline.filter((t) => t.type === '复查').length,
  })

  /** 多数写工具同形:resolveCardId → apply → summary。 */
  const writeTool = <S extends z.ZodObject<{ card_id: z.ZodString }>>(
    name: string,
    desc: string,
    schema: S,
    toCmd: (id: string, i: z.infer<S>) => Parameters<CardRepo['apply']>[0],
  ): ToolDefinition =>
    def(name, desc, schema, (i, ctx) =>
      run(() => {
        const id = resolveCardId((i as { card_id: string }).card_id, ctx)
        if (!id) return NOT_FOUND((i as { card_id: string }).card_id)
        return summary(store.apply(toCmd(id, i)))
      }),
    )

  return [
    def(
      'create_card',
      '新建标的卡(status=watching·卫星仓)。卡归属当前会话。返回 {card_id,...};后续 add_* 用 card_id 或直接传股票代码。',
      CreateZ,
      (i, ctx) =>
        run(() =>
          summary(
            store.apply({
              kind: 'create',
              code: i.code,
              name: i.name,
              originSessionId: resolveRootSession(ctx.sessionId),
            }),
          ),
        ),
    ),
    def(
      'get_card',
      '读卡(CardBundle:卡头 + eligibility + facts + thesis + timeline)。card_id 可传卡 id 或股票代码。',
      CardIdZ,
      (i, ctx) =>
        run(() => {
          const id = resolveCardId(i.card_id, ctx)
          return id ? store.read(id)! : NOT_FOUND(i.card_id)
        }),
    ),
    writeTool(
      'set_eligibility',
      '设资格赛(8红灯数 / 正和钱 / 能力圈 / pass)+ 好生意体检 good_business(质量门 + 护城河 type/久期 + 分档 优/良/平庸/不过;数值在 facts 不复制)。pass=false=淘汰;好生意分档不入 pass(非好生意可交易但厚边际)。',
      z.object({ card_id: z.string(), eligibility: EligibilityZ }),
      (id, i) => ({ kind: 'setEligibility', id, eligibility: i.eligibility as Eligibility }),
    ),
    writeTool(
      'add_facts',
      '追加事实观测(按 key 序列·只增不改·三维:数值/变化/结构)。每条必带 source(白名单)+ as_of,否则拒。' +
        'level=macro/industry/company;关键 key(存货/应收/营收)给 structure(拆解)+ change.turnover。先行 key(月度销量/合同负债等)role=先行。',
      z.object({ card_id: z.string(), facts: FactsZ }),
      (id, i) => ({ kind: 'addFacts', id, facts: i.facts as Facts }),
    ),
    writeTool(
      'add_thesis',
      '加逻辑版本(冻结快照·建立/校准/重写)。valuation.assumptions = 全部估值预测参数(命门+支撑):每参数 key/label/三档(bear/base/bull)+ from_fact(立足事实,须已 add_facts)+ verify(验证事实,先行+终验);命门(sensitivity=high)额外带 logic_anchor + falsify。' +
        'valuation 配模式(pe/dcf/pb-roe/ddm/nav)+ V(compute 从 assumptions 算)+ 安全边际门槛。逻辑变才出新版本,基础事实须先在场。',
      z.object({ card_id: z.string(), snapshot: ThesisSnapshotZ }),
      (id, i) => ({
        kind: 'addThesisVersion',
        id,
        snapshot: i.snapshot as unknown as ThesisSnapshot,
      }),
    ),
    writeTool(
      'add_checkpoint',
      '加复查(每财报:对账预估vs实际·三维 → 兑现锁定 → 重估 V_now+安全边际 → 归因 → validity 强化/持有/校准/证伪)。' +
        'against_v 锚出身逻辑版本(不回溯);spawned_v 记是否触发新版本(强化/持有=null,校准/证伪=新版)。',
      z.object({ card_id: z.string(), checkpoint: CheckpointZ }),
      (id, i) => ({ kind: 'addCheckpoint', id, checkpoint: i.checkpoint as unknown as Checkpoint }),
    ),
    writeTool(
      'add_decision',
      '加决策(建/加/减/清)。reason 必填;**双闸**:gate=否决拒建/加·节流拒加;建/加须最近复查 at_buy_point(安全边际达标)。override=true 可逆,留痕。非荐股。',
      z.object({ card_id: z.string(), decision: DecisionEventZ }),
      (id, i) => ({ kind: 'addDecision', id, decision: i.decision as unknown as DecisionEvent }),
    ),
    writeTool(
      'add_review',
      '加复盘(vs_benchmark 对标宽基:跑输宽基=失败,赚钱也算败)+ lesson。',
      z.object({ card_id: z.string(), review: ReviewEventZ }),
      (id, i) => ({ kind: 'addReview', id, review: i.review as unknown as ReviewEvent }),
    ),
    def(
      'get_timeline',
      '读时间线(复查/决策/复盘,按 at 升序,可重放)。card_id 可传卡 id 或股票代码。',
      CardIdZ,
      (i, ctx) =>
        run(() => {
          const id = resolveCardId(i.card_id, ctx)
          if (!id) return NOT_FOUND(i.card_id)
          return store.read(id)!.timeline
        }),
    ),
  ]
}
