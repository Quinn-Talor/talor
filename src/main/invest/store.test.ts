import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { CardRepo, createCardTables, CardValidationError } from './store'
import { buyTriggerPrice } from './compute'
import type {
  Eligibility,
  Facts,
  ThesisSnapshot,
  ValuationAssumption,
  Checkpoint,
  DecisionEvent,
  ReviewEvent,
} from '../../shared/types/invest'

// —— 工厂(新 schema:价值链严谨化)——
const facts = (over: Facts = {}): Facts => ({
  ev_pen: {
    level: 'industry',
    label: '渗透率',
    unit: '%',
    series: [{ value: '42%', as_of: '2026-03', source: '中汽协', tier: 'T1' }],
  },
  co_share: {
    level: 'company',
    label: '份额',
    unit: '%',
    series: [{ value: '16%', as_of: '2025-12', source: '乘联会', tier: 'T1' }],
  },
  ...over,
})

// 命门估值参数(挂 logic/falsify_if;锚 anchor + 预测 forecast;先行 verify)
const assumption = (over: Partial<ValuationAssumption> = {}): ValuationAssumption => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  anchor: { fact: 'co_share', as_of: '2025-12' },
  // 命门基于事实推导(delta:锚 16% ± 增量 → 15/16/17);单位与锚事实(co_share %)一致
  forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026-annual' },
  verify: [{ fact: 'co_share', at: 'quarterly', role: '终验' }],
  logic: '成本护城河',
  falsify_if: '连2季<14%',
  ...over,
})

const snapshot = (over: Partial<ThesisSnapshot> = {}): ThesisSnapshot => ({
  v: 1,
  at: '2026-03-31',
  scope: '建立',
  claim: '政策驱动+护城河,EPS CAGR 20%',
  profit_type: '成长',
  valuation: {
    method: 'pe',
    // 极简可算卡(测试用):命门 co_share 声明 step → 引擎折叠出 V(灭黑盒要求可算;V 值不被任何断言依赖)
    assumptions: [assumption({ step: { order: 1, out: 'V' } })],
    V: { bear: 210, base: 290, bull: 380 },
    margin_of_safety: { required: 0.2, anchor: 'bear' },
  },
  ...over,
})

/** 用给定 assumptions 造快照(测校验)。 */
const snapWith = (assumps: ValuationAssumption[]): ThesisSnapshot =>
  snapshot({
    valuation: {
      method: 'pe',
      assumptions: assumps,
      V: { bear: 210, base: 290, bull: 380 },
      margin_of_safety: { required: 0.2, anchor: 'bear' },
    },
  })

const checkpoint = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  type: '复查',
  at: '2026-04-30',
  against_v: 1,
  validity: '持有',
  conviction: 'mid',
  checks: [
    {
      metric: 'co_share',
      predicted_value: '16%',
      actual_value: '15%',
      outcome: '容差',
    },
  ],
  value_now: {
    V: { bear: 210, base: 265, bull: 350 },
    price: 255,
    margin_of_safety: { at_buy_point: true },
  },
  gate: { state: '通行' },
  spawned_v: null,
  signal: { verdict: '等', reason: 'r' },
  ...over,
})

const review = (over: Partial<ReviewEvent> = {}): ReviewEvent => ({
  type: '复盘',
  at: '2026-06-30',
  vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
  lesson: 'l',
  ref_v: 1,
  ...over,
})

const elig = (over: Partial<Eligibility> = {}): Eligibility => ({
  red_flags: 0,
  source_positive: true,
  in_circle: true,
  pass: true,
  ...over,
})

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
    throw new Error('should have thrown')
  } catch (e) {
    expect(e).toBeInstanceOf(CardValidationError)
    expect((e as CardValidationError).code).toBe(code)
  }
}

function newRepo(): CardRepo {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  createCardTables(db)
  return new CardRepo(db)
}

describe('createCardTables migration', () => {
  it('旧版 stock_cards(无 facts 列)→ DROP 重建', () => {
    const db = new Database(':memory:')
    db.exec(
      `CREATE TABLE stock_cards (id TEXT PRIMARY KEY, code TEXT, name TEXT, status TEXT, created_at TEXT, updated_at TEXT);`,
    )
    db.prepare('INSERT INTO stock_cards VALUES (?,?,?,?,?,?)').run(
      'old',
      '1',
      'x',
      'watching',
      't',
      't',
    )
    createCardTables(db)
    const cols = (
      db.prepare('PRAGMA table_info(stock_cards)').all() as Array<{ name: string }>
    ).map((c) => c.name)
    expect(cols).toContain('facts')
    expect(cols).toContain('thesis')
    const repo = new CardRepo(db)
    const b = repo.apply({ kind: 'create', code: '300750', name: '宁德', originSessionId: 's1' })
    expect(repo.read(b.id)?.head.origin_session_id).toBe('s1')
  })
})

describe('CardRepo (价值链严谨化 schema)', () => {
  let repo: CardRepo
  beforeEach(() => {
    repo = newRepo()
  })

  it('create: watching + 卫星仓 + 强标识;read 往返', () => {
    expect(repo.read('nope')).toBeNull()
    const b = repo.apply({ kind: 'create', code: '002594', name: '比亚迪', originSessionId: 's1' })
    expect(b.head.status).toBe('watching')
    expect(b.head.bucket).toBe('satellite')
    expect(b.id).toMatch(/^002594-\d{8}-[0-9a-f]{8}$/)
    expect(b.thesis).toBeNull()
    expect(b.timeline).toHaveLength(0)
  })

  it('P3 幂等: 同 session 同 code 复用;跨 session 新建;归一化', () => {
    const a1 = repo.apply({ kind: 'create', code: '601899', name: '紫金', originSessionId: 's1' })
    const a2 = repo.apply({
      kind: 'create',
      code: '601899.SH',
      name: '紫金',
      originSessionId: 's1',
    })
    expect(a2.id).toBe(a1.id)
    const b = repo.apply({ kind: 'create', code: '601899', name: '紫金', originSessionId: 's2' })
    expect(b.id).not.toBe(a1.id)
  })

  it('findOpenCardId: 去后缀归一匹配;跨会话不串', () => {
    const b = repo.apply({ kind: 'create', code: '601899.SH', name: '紫金', originSessionId: 's1' })
    expect(repo.findOpenCardId('s1', '601899')).toBe(b.id)
    expect(repo.findOpenCardId('s2', '601899')).toBeNull()
  })

  it('setEligibility 落库', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    const r = repo.apply({ kind: 'setEligibility', id: c.id, eligibility: elig({ pass: false }) })
    expect(r.eligibility?.pass).toBe(false)
  })

  // U2:池子摘要 —— 带当前逻辑一句话 + 最新有效性
  it('listAll: 摘要含 claim/validity,建卡有 thesis+复查的卡回填', () => {
    // 卡 A:全链(建卡→事实→逻辑→复查),有 claim + validity
    const a = repo.apply({ kind: 'create', code: '600519', name: '茅台', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: a.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: a.id, snapshot: snapshot({ claim: '护城河' }) })
    repo.apply({ kind: 'addCheckpoint', id: a.id, checkpoint: checkpoint({ validity: '持有' }) })
    // 卡 B:仅建卡,无 thesis / 无复查 → claim/validity 皆 undefined
    repo.apply({ kind: 'create', code: '000001', name: '平安', originSessionId: 's' })

    const all = repo.listAll()
    expect(all).toHaveLength(2)
    const byCode = new Map(all.map((s) => [s.code, s]))
    expect(byCode.get('600519')?.claim).toBe('护城河')
    expect(byCode.get('600519')?.validity).toBe('持有')
    expect(byCode.get('600519')?.profit_type).toBe('成长')
    expect(byCode.get('600519')?.origin_session_id).toBe('s') // 供"分析过程"拉会话
    expect(byCode.get('000001')?.claim).toBeUndefined()
    expect(byCode.get('000001')?.validity).toBeUndefined()
  })

  // L3:买点价由 compute 算(不变量⑥ —— 价值 compute 算,不手填)
  it('addCheckpoint: buy_trigger 由 buyTriggerPrice 系统算(覆盖手填)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    const cp = checkpoint()
    cp.value_now.margin_of_safety.buy_trigger = 99999 // 手填假值,应被系统算覆盖
    const r = repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: cp })
    const saved = r.timeline.find((e) => e.type === '复查') as Checkpoint
    const v = saved.value_now.V
    const expected = buyTriggerPrice({
      bear: v.bear,
      base: v.base,
      required: 0.2,
      anchor: 'bear',
    }).trigger
    expect(saved.value_now.margin_of_safety.buy_trigger).toBe(expected)
    expect(saved.value_now.margin_of_safety.buy_trigger).not.toBe(99999)
  })

  // L2:复盘守规矩(verdict 一致 + ref_v 真版本)
  it('addReview: verdict 与 卫星/宽基 不符 → REVIEW_VERDICT_MISMATCH', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () =>
        repo.apply({
          kind: 'addReview',
          id: c.id,
          review: review({ vs_benchmark: { satellite: 5, index: 10, verdict: '跑赢' } }),
        }),
      'REVIEW_VERDICT_MISMATCH',
    )
  })

  it('addReview: ref_v 不存在 → REVIEW_REF_VERSION_MISSING', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () => repo.apply({ kind: 'addReview', id: c.id, review: review({ ref_v: 99 }) }),
      'REVIEW_REF_VERSION_MISSING',
    )
  })

  it('addReview: 一致 verdict + 有效 ref_v → 落库', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    const r = repo.apply({ kind: 'addReview', id: c.id, review: review() })
    expect(r.timeline.some((e) => e.type === '复盘')).toBe(true)
  })

  // ② 事实:白名单 + as_of + 只增不改
  it('addFacts: 白名单源放行 + 同 key append(只增不改)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    const r = repo.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '15%', as_of: '2026-04', source: '乘联会' }],
        },
      },
    })
    expect(r.facts.co_share.series).toHaveLength(2) // append,旧的没丢
    expect(r.facts.co_share.series[0].value).toBe('16%')
  })

  it('FACT_NO_SOURCE / FACT_SOURCE_UNTRUSTED / FACT_NO_ASOF', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    const f = (obs: Record<string, unknown>): Facts => ({
      k: { level: 'company', label: 'k', series: [obs as never] },
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addFacts',
          id: c.id,
          facts: f({ value: '1', as_of: '2026-03', source: '' }),
        }),
      'FACT_NO_SOURCE',
    )
    expectCode(
      () =>
        repo.apply({
          kind: 'addFacts',
          id: c.id,
          facts: f({ value: '1', as_of: '2026-03', source: '雪球大V' }),
        }),
      'FACT_SOURCE_UNTRUSTED',
    )
    expectCode(
      () => repo.apply({ kind: 'addFacts', id: c.id, facts: f({ value: '1', source: '中汽协' }) }),
      'FACT_NO_ASOF',
    )
  })

  // ①③⑦ 逻辑:命门挂逻辑/验证 + 每参数挂事实(anchor)、估值齐
  it('addThesis: 合法落库 + versions/current', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    const r = repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expect(r.thesis?.versions).toHaveLength(1)
    expect(r.thesis?.current).toBe(1)
    expect(r.thesis?.versions[0].valuation.assumptions[0].key).toBe('co_share')
    // 校准:加 v2
    const r2 = repo.apply({
      kind: 'addThesisVersion',
      id: c.id,
      snapshot: snapshot({ v: 2, scope: '校准' }),
    })
    expect(r2.thesis?.versions).toHaveLength(2)
    expect(r2.thesis?.current).toBe(2)
  })

  it('addThesisVersion 冻结引擎 V:参数齐 → 覆盖手填(不变量③ 价值由 compute 算)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    // facts() 含 ev_pen(@2026-03)/ co_share(@2025-12);命门挂锚,支撑 absolute 无锚
    const af = (o: Partial<ValuationAssumption>): ValuationAssumption => ({
      key: 'x',
      label: 'x',
      unit: '%',
      forecast: { mode: 'absolute', bear: 0, base: 0, bull: 0 },
      ...o,
    })
    const full: ValuationAssumption[] = [
      af({
        key: 'ev_pen',
        label: '渗透',
        anchor: { fact: 'ev_pen', as_of: '2026-03' },
        forecast: { mode: 'delta', bear: 3, base: 8, bull: 13 }, // 命门:锚 42% + 增量 → 45/50/55
        verify: [{ fact: 'ev_pen', at: 'annual' }],
        logic: '政策',
        falsify_if: '<45%',
      }),
      af({
        key: 'mkt_capacity',
        label: '容量',
        unit: '万辆',
        forecast: { mode: 'absolute', bear: 2826, base: 2826, bull: 2826 },
      }),
      af({
        key: 'co_share',
        label: '份额',
        anchor: { fact: 'co_share', as_of: '2025-12' },
        forecast: { mode: 'delta', bear: -2.5, base: -1.5, bull: -0.5 }, // 命门:锚 16% + 增量 → 13.5/14.5/15.5
        verify: [{ fact: 'co_share', at: 'q' }],
        logic: '成本',
        falsify_if: '<13%',
      }),
      af({
        key: 'asp',
        label: '单价',
        unit: '万元',
        forecast: { mode: 'absolute', bear: 16.5, base: 16.5, bull: 16.5 },
      }),
      af({
        key: 'net_margin',
        label: '净利率',
        forecast: { mode: 'absolute', bear: 9, base: 9, bull: 9 },
      }),
      af({
        key: 'shares',
        label: '股本',
        unit: '亿股',
        forecast: { mode: 'absolute', bear: 29, base: 29, bull: 29 },
      }),
      af({
        key: 'pe_central',
        label: 'PE',
        unit: 'x',
        forecast: { mode: 'absolute', bear: 25, base: 25, bull: 25 },
      }),
    ]
    // snapWith 手填 V {210,290,380};参数齐 → 引擎算出 262(0.5×2826×.145×16.5×.09÷29×25)覆盖之
    const r = repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapWith(full) })
    expect(r.thesis!.versions[0].valuation.V.base).toBe(262)
  })

  it.each([
    ['VALUATION_NO_ASSUMPTIONS', snapWith([])],
    ['ASSUMPTION_NO_ANCHOR', snapWith([assumption({ anchor: undefined })])],
    ['FACT_REFERENCED_MISSING', snapWith([assumption({ anchor: { fact: 'nope' } })])],
    // delta/factor 须基线时点 + 该观测在场(对照复盘不漂的起点)
    [
      'ANCHOR_NO_ASOF',
      snapWith([
        assumption({
          anchor: { fact: 'co_share' },
          forecast: { mode: 'delta', bear: 1, base: 2, bull: 3 },
        }),
      ]),
    ],
    [
      'ANCHOR_ASOF_MISSING',
      snapWith([
        assumption({
          anchor: { fact: 'co_share', as_of: '1999-01' },
          forecast: { mode: 'delta', bear: 1, base: 2, bull: 3 },
        }),
      ]),
    ],
    // 命门 ≡ 有 logic:空 logic 即非命门 → 唯一参数非命门 → NO_CORE_ASSUMPTION
    ['NO_CORE_ASSUMPTION', snapWith([assumption({ logic: '' })])],
    ['CORE_NO_VERIFY', snapWith([assumption({ verify: [] })])],
    [
      'NO_CORE_ASSUMPTION',
      snapWith([assumption({ key: 'net_margin', logic: undefined, falsify_if: undefined })]),
    ],
  ])('addThesis 不变量①⑦: %s → 拒', (code, snap) => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    expectCode(
      () => repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snap as ThesisSnapshot }),
      code,
    )
  })

  // ④ 复查锚版本不回溯
  it('CHECKPOINT_NO_VERSION: against_v 不存在 → 拒', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () =>
        repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ against_v: 99 }) }),
      'CHECKPOINT_NO_VERSION',
    )
    expect(() =>
      repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() }),
    ).not.toThrow()
  })

  // ⑤⑥⑧⑨ 决策多闸
  it('addDecision: reason 必填', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: '  ' } as DecisionEvent,
        }),
      'DECISION_NO_REASON',
    )
  })

  it('NO_CHECKPOINT(⑨): 无复查建仓 → 拒', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-05', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'NO_CHECKPOINT',
    )
  })

  it('STALE_CHECKPOINT(⑨): 复查早于最新事实 → 拒;补复查后放行', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ at: '2026-04-30' }) })
    // 新事实(2026-07)晚于复查(2026-04-30)→ 决策陈旧
    repo.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '14%', as_of: '2026-07', source: '乘联会' }],
        },
      },
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-08', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'STALE_CHECKPOINT',
    )
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint({ at: '2026-07-31' }) })
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: '2026-08', trade: '建', reason: 'r' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('LOGIC_FALSIFIED(⑧): 逻辑证伪 → 禁建/加(仅减/清);价格便宜也拦', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    // 证伪复查 + 价格到买点(便宜也不能买 → 价值陷阱)
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({
        validity: '证伪',
        value_now: {
          V: { bear: 210, base: 265, bull: 350 },
          margin_of_safety: { at_buy_point: true },
        },
      }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: '2026-05', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'LOGIC_FALSIFIED',
    )
    // 减/清 放行
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: '2026-05', trade: '清', reason: '止损' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('GATE_VETOED / override 放行(读最近复查 gate)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({ gate: { state: '否决' } }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'GATE_VETOED',
    )
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: {
          type: '决策',
          at: 'x',
          trade: '建',
          reason: 'r',
          override: true,
        } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('MARGIN_NOT_REACHED: 建仓但安全边际未达买点 → 拒;减/清不受约束', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({
      kind: 'addCheckpoint',
      id: c.id,
      checkpoint: checkpoint({
        value_now: {
          V: { bear: 210, base: 265, bull: 350 },
          margin_of_safety: { at_buy_point: false },
        },
      }),
    })
    expectCode(
      () =>
        repo.apply({
          kind: 'addDecision',
          id: c.id,
          decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
        }),
      'MARGIN_NOT_REACHED',
    )
    expect(() =>
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '减', reason: 'r' } as DecisionEvent,
      }),
    ).not.toThrow()
  })

  it('addDecision 状态转换: 建→held, 清→closed', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() }) // gate 通行 + at_buy_point + 持有
    expect(
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '建', reason: 'r' } as DecisionEvent,
      }).head.status,
    ).toBe('held')
    expect(
      repo.apply({
        kind: 'addDecision',
        id: c.id,
        decision: { type: '决策', at: 'x', trade: '清', reason: '止盈' } as DecisionEvent,
      }).head.status,
    ).toBe('closed')
  })

  it('addReview 落库 + timeline append-only', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapshot() })
    repo.apply({ kind: 'addCheckpoint', id: c.id, checkpoint: checkpoint() })
    const review: ReviewEvent = {
      type: '复盘',
      at: 'x',
      vs_benchmark: { satellite: 0.18, index: 0.12, verdict: '跑赢' },
      lesson: 'l',
    }
    const r = repo.apply({ kind: 'addReview', id: c.id, review })
    expect(r.timeline).toHaveLength(2) // 复查 + 复盘
    expect(r.timeline[1].type).toBe('复盘')
  })

  it('listBySession: 按 origin 过滤', () => {
    repo.apply({ kind: 'create', code: 'A', name: 'a', originSessionId: 's1' })
    repo.apply({ kind: 'create', code: 'B', name: 'b', originSessionId: 's1' })
    repo.apply({ kind: 'create', code: 'C', name: 'c', originSessionId: 's2' })
    expect(repo.listBySession('s1')).toHaveLength(2)
    expect(repo.listBySession('s2')).toHaveLength(1)
  })

  // ===== 声明式恒等式 + 基于事实推导(灭黑盒 / 命门叶子 delta·factor / EPS·净利计算)=====
  // 基本面链:营收(命门)×净利率(命门)=净利 ÷股本(支撑)=EPS ×PE中枢(命门)=V。
  // 命门全 delta/factor 基于事实(Guard 2a/2b);EPS/净利是 step 计算中间量(非命门、不滚前值)。
  const fundFacts = (): Facts =>
    facts({
      营收: {
        level: 'company',
        label: '营收',
        unit: '亿',
        series: [{ value: '6000', as_of: '2025-12', source: '年报', tier: 'T1' }],
      },
      净利率: {
        level: 'company',
        label: '净利率',
        unit: '%',
        series: [{ value: '5', as_of: '2025-12', source: '年报', tier: 'T1' }],
      },
      动态PE: {
        level: 'company',
        label: '动态PE',
        unit: '倍',
        series: [{ value: '25', as_of: '2026-06', source: '交易所', tier: 'T1' }],
      },
    })
  const stepAssumps = (
    over: { lastStep?: ValuationAssumption['step'] } = {},
  ): ValuationAssumption[] => [
    assumption({
      key: '营收',
      label: '营收',
      unit: '亿',
      anchor: { fact: '营收', as_of: '2025-12' },
      forecast: { mode: 'factor', bear: 0.95, base: 1.0, bull: 1.05 }, // 锚 6000亿 × 倍数
      verify: [{ fact: '营收', at: 'annual', role: '终验' }],
      logic: '行业增速+份额提升',
      step: { order: 1, out: '营收' },
    }),
    assumption({
      key: '净利率',
      label: '净利率',
      unit: '%',
      anchor: { fact: '净利率', as_of: '2025-12' },
      forecast: { mode: 'factor', bear: 0.7, base: 0.8, bull: 1.0 }, // 锚 5% × 倍数 → 净利率
      verify: [{ fact: '净利率', at: 'annual', role: '终验' }],
      logic: '价格战压毛利、规模对冲',
      step: { order: 2, op: '×', out: '净利' },
    }),
    // 股本:支撑(无 logic)→ absolute 允许;÷ 得 EPS(计算中间量,非命门)
    {
      key: '股本',
      label: '股本',
      unit: '亿股',
      forecast: { mode: 'absolute', bear: 30, base: 30, bull: 30 },
      step: { order: 3, op: '÷', out: 'EPS' },
    },
    assumption({
      key: 'PE中枢',
      label: 'PE中枢',
      unit: '倍',
      anchor: { fact: '动态PE', as_of: '2026-06' },
      forecast: { mode: 'factor', bear: 0.6, base: 0.8, bull: 1.0 }, // 锚 25 × 倍数 → PE中枢
      verify: [{ fact: '动态PE', at: 'quarterly', role: '终验' }],
      logic: '43倍透支回归中枢',
      step: 'lastStep' in over ? over.lastStep : { order: 4, op: '×', out: 'V' },
    }),
  ]
  const stepSnap = (assumps: ValuationAssumption[]): ThesisSnapshot =>
    snapshot({
      valuation: {
        method: 'pe',
        assumptions: assumps,
        V: { bear: 1, base: 1, bull: 1 }, // 手填占位 → 引擎折叠覆盖
        margin_of_safety: { required: 0.2, anchor: 'bear' },
      },
    })

  it('命门叶子 delta/factor 基于事实 + EPS/净利计算 → 折叠冻结 V(营收×净利率÷股本×PE)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: fundFacts() })
    const r = repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: stepSnap(stepAssumps()) })
    // V = 6000 × 4% ÷ 30 × 20 = 160(EPS 8.0 是计算中间量,非命门);手填 {1,1,1} 被引擎覆盖
    expect(r.thesis!.versions[0].valuation.V.base).toBe(160)
    expect(r.thesis!.versions[0].valuation.V.bear).toBeLessThan(160)
    expect(r.thesis!.versions[0].valuation.V.bull).toBeGreaterThan(160)
  })

  it('声明了 step 但末步 out≠V → STEP_CHAIN_NOT_V(恒等式不收敛到 V)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: fundFacts() })
    expectCode(
      () =>
        repo.apply({
          kind: 'addThesisVersion',
          id: c.id,
          snapshot: stepSnap(stepAssumps({ lastStep: { order: 4, op: '×', out: '估值' } })),
        }),
      'STEP_CHAIN_NOT_V',
    )
  })

  it('命门用 absolute(凭空给数)→ CORE_FORECAST_NOT_DERIVED(须基于事实推导)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    expectCode(
      () =>
        repo.apply({
          kind: 'addThesisVersion',
          id: c.id,
          // co_share 命门改 absolute → 拒(命门必须 delta/factor)
          snapshot: snapWith([
            assumption({ forecast: { mode: 'absolute', bear: 15, base: 16, bull: 17 } }),
          ]),
        }),
      'CORE_FORECAST_NOT_DERIVED',
    )
  })

  it('命门单位 ≠ 锚事实单位 → ANCHOR_UNIT_MISMATCH(量纲不一致)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    expectCode(
      () =>
        // co_share(锚事实单位 %)命门标成 元 → 拒
        repo.apply({
          kind: 'addThesisVersion',
          id: c.id,
          snapshot: snapWith([assumption({ unit: '元' })]),
        }),
      'ANCHOR_UNIT_MISMATCH',
    )
  })

  it('链算不出(键不匹配 pipeline 且无 step)→ VALUATION_NOT_COMPUTABLE(不手填兜底)', () => {
    const c = repo.apply({ kind: 'create', code: '1', name: 'x', originSessionId: 's' })
    repo.apply({ kind: 'addFacts', id: c.id, facts: facts() })
    expectCode(
      // 单个 co_share 命门、method=pe、无 step → pe pipeline 缺 7 参 → 算不出 → 拒(即便手填了 V)
      () => repo.apply({ kind: 'addThesisVersion', id: c.id, snapshot: snapWith([assumption()]) }),
      'VALUATION_NOT_COMPUTABLE',
    )
  })
})
