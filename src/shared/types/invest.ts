// src/shared/types/invest.ts —— shared 层: invest 标的卡域类型(main + renderer 共用)
//
// 终稿模型(详见 docs/investment-agent/README.md):
//   卡 = 事实(facts:按 key 序列·三维·分层) + 逻辑(thesis:冻结快照·版本化)
//        + 时间线(timeline:复查/决策/复盘)。
//   事实快变(连续 append)· 逻辑慢变(离散冻结,basis 钉时点)· 复查归因定逻辑动否。
//   价值 = driver 双线收敛聚合;买入过 gate(系统风险)+ 安全边际(估值缓冲)双闸。
// 六不变量(代码层强制):驱动挂逻辑+立足 / 事实带源+时点·只增不改 / 价值 compute 算 /
//   复查锚出身不回溯 / 决策过 gate / 建仓过安全边际。
//
// 允许依赖: 无    禁止依赖: 一切(纯类型,shared 最底层)

// ============ 通用枚举 ============
export type CardStatus = 'watching' | 'held' | 'closed'
export type FactLevel = 'macro' | 'industry' | 'company'
export type FactRole = '先行' | '同步' | '滞后' | '排雷'
export type Signal = 'good' | 'bad' | 'neutral'
export type Quality = 'healthy' | 'mixed' | 'deteriorating'
export type Trend = 'up' | 'down' | 'flat'
export type Momentum = 'accelerating' | 'decelerating' | 'reversing' | 'flat'

// ============ ① 事实 facts(按 key 序列·三维)============
/** 结构维:拆解贡献项 + 质量判定(挡"数值好看结构恶化")。 */
export interface FactStructure {
  note: string
  quality?: Quality
  components?: { name: string; value?: string; signal?: Signal }[]
}
/** 变化维:趋势/动能/周转/分位(部分由 compute_trend/turnover 派生,也可显存)。 */
export interface FactChange {
  yoy?: string
  trend?: Trend
  momentum?: Momentum
  trend_note?: string // "22%→19%"
  turnover_days?: number // 周转天数(存货/应收)
  turnover_trend?: string // "52→58·放缓"
  percentile?: number // 历史分位 0~100
}
/** 一条观测(point-in-time);三维 = value(数值) + change(变化) + structure(结构)。 */
export interface FactObservation {
  value: string | number
  as_of: string // 必填:事实时点 ISO(不晚于引用它的快照/复查)
  source: string // 必填:白名单来源(无源/非白名单=拒)
  tier?: 'T1' | 'T2' | 'T3' | 'compute'
  change?: FactChange
  structure?: FactStructure
}
/** 一个 key 的事实(序列;只增不改)。 */
export interface Fact {
  level: FactLevel
  label: string
  unit?: string | null
  role?: FactRole // 先行/同步/滞后/排雷
  series: FactObservation[] // append-only,新观测 push,旧的不改
}
/** facts = key → Fact(主轴是 key)。 */
export type Facts = Record<string, Fact>

// ============ ② 逻辑 thesis(冻结快照·版本化)============
export type ProfitType = '成长' | '拐点' | '估值修复' | '周期' | '分红'
export type ValuationMethod = 'pe' | 'dcf' | 'pb-roe' | 'ddm' | 'nav'
/** 预测方式:命门未来值 = 锚(anchor 指向的事实)应用推测。
 *  delta=锚+值(同单位,如份额 +0.5pp);factor=锚×值(倍数);absolute=直取(利率/倍数/常量)。 */
export type ForecastMode = 'delta' | 'factor' | 'absolute'
export type ChangeScope = '建立' | '校准' | '重写'

/** 价值区间(compute 从 assumptions 传导出)。 */
export interface VRange {
  bear: number
  base: number
  bull: number
}
/** 验收钩子:ref 哪条事实、何时验、先行/终验。 */
export interface VerifyHook {
  fact: string // ref facts key
  at: string // 验收时点/频率:monthly/quarterly/annual/具体日期
  role?: '先行' | '终验'
}
/** 安全边际门槛(随不确定性放大;锚保守端)。 */
export interface MarginOfSafety {
  required: number // 门槛(0~1)
  anchor?: 'bear' | 'base'
  required_basis?: string // 为何这么高
}
/** 配模式估值(method 决定根假设集;V 由 compute 从 assumptions 算)。 */
export interface Valuation {
  method: ValuationMethod
  method_reason?: string
  assumptions: ValuationAssumption[] // ★ 全部估值预测参数(单一真相);命门 = 挂 logic 的参数
  V: VRange
  margin_of_safety: MarginOfSafety
}
/** 锚:预测的起点(立论时定;facts append-only 保证基线观测不变)。 */
export interface PredictionAnchor {
  fact: string // 锚定哪条事实(facts key)
  as_of?: string // 基线时点(取该事实哪个观测;delta/factor 必填,absolute 可省)
}
/** 预测:从锚推一段时间到 horizon(三档推测量 + 怎么推 + 何时验)。 */
export interface Forecast {
  mode: ForecastMode // 怎么推:delta=锚+量 / factor=锚×倍数 / absolute=直接设定
  bear: number | string // 三档推测量(delta:增量 / factor:倍数 / absolute:绝对值)
  base: number | string
  bull: number | string
  horizon?: string // 预测兑现时点(如 '2026-annual'),到此该对账
}
/** 声明式恒等式折叠步(任何 method 适用):该参数在恒等式里的角色与算子。
 *  有 step → 入式(按 order 折叠:acc = acc op 预期值,每步产中间量,逻辑→数据→V 过程可见);
 *  无 step → 仅命门审计(定性,不入式),或交由该 method 的内置公式(dcf/pb-roe 等非线性法)。 */
export interface ForecastStep {
  order: number // 折叠序(1 = 起始项)
  op?: '×' | '÷' | '+' | '−' // 与累积量的运算(order=1 可省,作起始)
  out: string // 本步产出的中间量名(末步通常 'V')
}
/**
 * 估值预测参数(吸收原 Driver):逻辑的量化落点 + 估值的输入。
 * 锚(anchor)+ 预测(forecast)双向挂事实;命门 = 挂 logic 的参数,额外带 falsify_if。
 */
export interface ValuationAssumption {
  key: string // 参数键(可复用 fact key,如 co_share;或估值专用如 pe_central)
  label: string
  unit?: string | null
  anchor?: PredictionAnchor // 锚:预测起点(命门必有;纯常量支撑可省)
  forecast: Forecast // 预测:三档推测量 + 怎么推 + 兑现时点
  logic?: string // 命门:挂哪条逻辑(空话拒);命门 ⟺ 有 logic
  falsify_if?: string // 命门:证伪条件(出此=逻辑错)
  market_implied?: string // 现价反推的市场隐含(预期差 = forecast.base vs 此)
  verify?: VerifyHook[] // 先行指标对账(终验由 anchor.fact + forecast.horizon 隐含)
  step?: ForecastStep // 恒等式折叠里的角色(有=入式逐步算 / 无=仅命门审计或走 method 内置公式)
}
/** 逻辑快照(冻结;一次态变=一个 v)。命门 = 挂 logic 的参数。 */
export interface ThesisSnapshot {
  v: number
  at: string
  scope: ChangeScope
  claim: string // 论点一句话(大白话,散户决策面头条)
  profit_type: ProfitType // 赚什么钱 → 决定 method
  valuation: Valuation // 含 assumptions(吸收原 drivers;命门 = 挂 logic 的参数)
  ref_checkpoint?: string // 若由某次复查触发(校准/重写)
}
/** 逻辑跟踪:冻结快照序列 + 当前版指针。 */
export interface Thesis {
  versions: ThesisSnapshot[]
  current: number // 指向最新 v
}

// ============ ③ 时间线 timeline(复查/决策/复盘)============
export type AttributionType = '噪声' | '外生' | '参数错' | '机制错'
export type Verdict = '买' | '等' | '弃' | '减'
export type TradeAction = '建' | '加' | '减' | '清'
export type GateState = '通行' | '警告' | '节流' | '否决'
export type Validity = '强化' | '持有' | '校准' | '证伪' // ★ 双向验证产物(强化/持有不换版,校准/证伪出新版)
export type Conviction = 'high' | 'mid' | 'low' // ★ 确信度(强化累积↑/偏离↓)→ 喂仓位
export type CheckOutcome = '超预期' | '兑现' | '容差' | '偏离' | '破' // ★ 逐参数双向:兑现/超预期=强化、偏离=校准、破=证伪

/** 一个估值参数的对账(predicted_value = 基线锚+推测·系统算定不回溯,actual_value = facts[anchor.fact] 到期最新)。 */
export interface AssumptionCheck {
  metric: string // ref valuation.assumptions[].key
  predicted_value?: string | number // ← 基线锚(anchor.as_of)应用 forecast 的绝对预测值(系统 add_checkpoint 算定·冻结)
  actual_value: string | number // ← facts[anchor.fact] 到期最新(同一指标)
  actual_as_of?: string // 实际取自哪个时点
  deviation?: { 数值?: string; 结构?: string; 变化?: string }
  outcome: CheckOutcome // ★ 双向(含容差判定):超预期/兑现/容差=未破、偏离=校准、破=证伪
  attribution?: { cause: string; type: AttributionType } // 偏离/破 才需归因
}
/** 当前安全边际(每复查重估)。 */
export interface MarginNow {
  to_bear?: string
  vs_required?: string
  at_buy_point: boolean // ★建/加仓硬门
  buy_trigger?: number // 买点价上限(compute buyTriggerPrice 算;"等回调¥X以下"的 X)
}
/** 重估:实际灌回 → V_now + 安全边际 + 兑现度。 */
export interface ValueNow {
  V: VRange
  price?: number
  realized_pct?: number
  margin_of_safety: MarginNow
}
export interface Gate {
  state: GateState
  reason?: string[]
}
/** 复查(每财报·主力):对账+兑现+重估+归因。validity 即动作(强化/持有=不换版,校准/证伪=出新版)。 */
export interface Checkpoint {
  type: '复查'
  at: string
  against_v: number // 锚出身版本(不回溯)
  validity: Validity // ★ 双向验证产物=动作:强化/持有不换版,校准/证伪才出新版(spawned_v 非空)
  conviction?: Conviction // ★ 确信度(强化累积↑/偏离↓)→ 喂仓位
  checks: AssumptionCheck[] // 逐参数对账
  value_now: ValueNow
  gate: Gate
  spawned_v: number | null // 仅校准/证伪 → 新版本(null=逻辑没动)
  signal: { verdict: Verdict; reason: string }
}
/** 决策(实际动作;gate + 安全边际双闸)。 */
export interface DecisionEvent {
  type: '决策'
  at: string
  trade: TradeAction
  price?: number
  weight?: number
  reason: string
  based_v?: number // 决策依据的逻辑版本(缺省→由决策时点取当时 thesis.current 推导)
  override?: boolean // 逆 gate/边际,留痕
}
/** 复盘(平仓/周期):跑赢宽基 + 教训。 */
export interface ReviewEvent {
  type: '复盘'
  at: string
  vs_benchmark: { satellite: number; index: number; verdict: '跑赢' | '跑输' }
  lesson?: string
  ref_v?: number
}
export type TimelineEvent = Checkpoint | DecisionEvent | ReviewEvent
export type TimelineEventType = TimelineEvent['type']

// ============ 卡 ============
/** 好生意体检(判断-only;数值证据在 facts: ocf_ni/fcf/core_ni/goodwill/roe/roa/debt_assets/gross_margin)。 */
export type BizGrade = '优' | '良' | '平庸' | '不过'
export interface GoodBusiness {
  quality_gate: 'pass' | 'fail' // 质量门结论(收现/FCF/扣非/商誉;数值在 facts)
  moat: { type: string; durability: '长' | '中' | '短' | '无' } // 护城河判断;durability → 喂估值久期
  grade: BizGrade // 优/良/平庸/不过 → 调 margin_of_safety.required
}
export interface Eligibility {
  red_flags: number // 8红灯命中数
  source_positive: boolean // 正和钱
  in_circle: boolean // 能力圈
  pass: boolean // 汇总;false→淘汰(好生意分档不入 pass:非好生意可交易但厚边际)
  good_business?: GoodBusiness // 资格关 ⊥ 逻辑兑现;慢变量·低频复查
}
export interface CardHead {
  id: string
  code: string
  name: string
  status: CardStatus
  bucket?: 'satellite' // 卫星仓;核心仓=宽基兜底
  origin_session_id: string
  created_at: string
  updated_at: string
}
export interface CardBundle {
  id: string
  type: 'stock_card'
  head: CardHead
  eligibility: Eligibility | null
  facts: Facts // ① 事实(按 key 序列)
  thesis: Thesis | null // ② 逻辑(冻结快照序列)
  timeline: TimelineEvent[] // ③ 时间线(复查/决策/复盘)
}

// ============ 写命令(工具 → store)============
export type CardCmd =
  | { kind: 'create'; code: string; name: string; originSessionId: string }
  | { kind: 'setEligibility'; id: string; eligibility: Eligibility }
  | { kind: 'addFacts'; id: string; facts: Facts } // 合并观测(按 key append)
  | { kind: 'addThesisVersion'; id: string; snapshot: ThesisSnapshot } // 建立/校准/变更/重写
  | { kind: 'addCheckpoint'; id: string; checkpoint: Checkpoint }
  | { kind: 'addDecision'; id: string; decision: DecisionEvent }
  | { kind: 'addReview'; id: string; review: ReviewEvent }
