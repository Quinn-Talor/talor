// src/main/invest/store.ts —— 业务层: 标的卡持久化(CardRepo implements ArtifactStore)
//
// 终稿模型(docs/investment-agent/README.md):卡 = 事实(facts) + 逻辑(thesis) + 时间线(timeline)。
//   stock_cards:卡头 + eligibility/facts/thesis JSON 列(facts append、thesis 加版本=可变聚合,JSON 最简)。
//   card_timeline:复查/决策/复盘 事件(append-only)。
// 六不变量(写经 apply 强制):
//   ① 驱动挂逻辑(logic)+ 立足(anchor ref 事实,不空)
//   ② 事实带源(白名单)+ 时点,只增不改(append 观测)
//   ③ 价值由 compute 算(V/区间由工具传入,store 不手算)
//   ④ 复查锚出身版本(against_v 存在)不回溯
//   ⑤ 决策过 gate(否决拒建/加、节流拒加)
//   ⑥ 建/加仓过安全边际门槛(最近复查 at_buy_point),override 留痕
//
// 允许依赖: better-sqlite3 / node:crypto / shared/types
// 禁止依赖: ipc/* / mcp/*

import type { Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import log from 'electron-log'
import type { ArtifactStore } from '../../shared/types/artifact'
import type {
  CardBundle,
  CardCmd,
  CardHead,
  CardStatus,
  Eligibility,
  Facts,
  Thesis,
  ThesisSnapshot,
  Checkpoint,
  DecisionEvent,
  ReviewEvent,
  TimelineEvent,
} from '../../shared/types/invest'
import { computeValuationTrace, resolveForecast } from '../../shared/invest/valuation-trace'

export class CardValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'CardValidationError'
  }
}

export const CREATE_STOCK_CARDS = `
CREATE TABLE IF NOT EXISTS stock_cards (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'watching' CHECK(status IN ('watching','held','closed')),
  bucket            TEXT,
  origin_session_id TEXT NOT NULL,
  eligibility       TEXT,
  facts             TEXT NOT NULL DEFAULT '{}',
  thesis            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
`

export const CREATE_CARD_TIMELINE = `
CREATE TABLE IF NOT EXISTS card_timeline (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL,
  at          TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES stock_cards(id) ON DELETE CASCADE
);
`

export const CREATE_CARD_TIMELINE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_card_timeline_card ON card_timeline(card_id, at);
`

/** 必需列(与 CREATE_STOCK_CARDS 同步);任一缺失即旧 schema,DROP 重建(不保留历史卡)。 */
const STOCK_CARDS_REQUIRED_COLS = [
  'id',
  'code',
  'name',
  'status',
  'bucket',
  'origin_session_id',
  'eligibility',
  'facts',
  'thesis',
  'created_at',
  'updated_at',
] as const

function recreateCardTablesIfOutdated(db: Database): void {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='stock_cards'")
    .get() as { name: string } | undefined
  if (!exists) return
  const cols = (db.prepare('PRAGMA table_info(stock_cards)').all() as Array<{ name: string }>).map(
    (c) => c.name,
  )
  const missing = STOCK_CARDS_REQUIRED_COLS.filter((c) => !cols.includes(c))
  if (missing.length === 0) return
  log.info(
    `[invest] stock_cards schema outdated (missing: ${missing.join(', ')}). ` +
      `Dropping + recreating (old card data discarded).`,
  )
  db.exec('DROP TABLE IF EXISTS card_timeline;')
  db.exec('DROP TABLE IF EXISTS stock_cards;')
}

/** 在给定 db 上建投研表(由 feature.init 或测试调用)。幂等 + 旧 schema 自动重建。 */
export function createCardTables(db: Database): void {
  recreateCardTablesIfOutdated(db)
  db.exec(CREATE_STOCK_CARDS)
  db.exec(CREATE_CARD_TIMELINE)
  db.exec(CREATE_CARD_TIMELINE_INDEX)
}

function now(): string {
  return new Date().toISOString()
}

// —— 来源可信度硬门(限制死:只认权威来源,挡财经门户/自媒体/爬虫/记忆)——
const TRUSTED_SOURCE_PATTERNS: RegExp[] = [
  /compute/i,
  /上交所|上海证券交易所|sse\.com\.cn/i,
  /深交所|深圳证券交易所|szse\.cn/i,
  /北交所|北京证券交易所|bse\.cn/i,
  /港交所|香港交易所|hkex/i,
  /巨潮|cninfo/i,
  /交易所/,
  /\.gov\.cn/i,
  /国家统计局|统计局|stats\.gov/i,
  /人民银行|央行|pbc\.gov/i,
  /证监会|csrc/i,
  /财政部|mof\.gov/i,
  /海关|customs\.gov/i,
  /工信部|miit/i,
  /发改委|ndrc/i,
  /商务部|mofcom/i,
  /中国政府网/,
  /证券|券商|研报|研究所|研究报告|投行/,
  /中金|中信|华泰|国泰君安|国君|海通|招商|广发|国信|兴业|申万|建投|东方证券|光大|安信|平安证券|中泰|天风|民生证券/,
  /基金|资管|资产管理/,
  /评级|穆迪|标普|惠誉|中诚信|大公|联合资信|moody|s&p|fitch/i,
  /年报|半年报|中报|季报|财报|定期报告|业绩|公告|招股|财务报告|利润表|资产负债表|现金流量表/,
  /协会|联会|联合会|联席会|商会|中汽协|乘联会/,
  /wind|万得|ifind|choice|理杏仁|彭博|bloomberg|路透|reuters/i,
]

/** 来源是否在可信白名单内(限制死)。空串视为不可信(由 FACT_NO_SOURCE 先行拦)。 */
export function isTrustedSource(source: string | undefined | null): boolean {
  const s = (source ?? '').trim()
  if (!s) return false
  return TRUSTED_SOURCE_PATTERNS.some((re) => re.test(s))
}

/** 代码归一化(S4c):去交易所后缀 + trim。 */
export function normalizeCode(code: string): string {
  return code.trim().replace(/\.(sh|sz|bj)$/i, '')
}

/** basis/actual_fact 的 "key@as_of" → key。 */
export function factRefKey(ref: string): string {
  return String(ref).split('@')[0].trim()
}

function makeCardId(code: string): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `${code}-${ymd}-${randomUUID().slice(0, 8)}`
}

interface CardRow {
  id: string
  code: string
  name: string
  status: CardStatus
  bucket: string | null
  origin_session_id: string
  eligibility: string | null
  facts: string
  thesis: string | null
  created_at: string
  updated_at: string
}

export class CardRepo implements ArtifactStore<CardBundle, CardCmd> {
  constructor(private readonly db: Database) {}

  read(id: string): CardBundle | null {
    const row = this.getRow(id)
    if (!row) return null
    return {
      id,
      type: 'stock_card',
      head: this.toHead(row),
      eligibility: row.eligibility ? (JSON.parse(row.eligibility) as Eligibility) : null,
      facts: JSON.parse(row.facts) as Facts,
      thesis: row.thesis ? (JSON.parse(row.thesis) as Thesis) : null,
      timeline: this.getTimeline(id),
    }
  }

  apply(cmd: CardCmd): CardBundle {
    switch (cmd.kind) {
      case 'create':
        return this.create(cmd.code, cmd.name, cmd.originSessionId)
      case 'setEligibility':
        return this.setEligibility(cmd.id, cmd.eligibility)
      case 'addFacts':
        return this.addFacts(cmd.id, cmd.facts)
      case 'addThesisVersion':
        return this.addThesisVersion(cmd.id, cmd.snapshot)
      case 'addCheckpoint':
        return this.addCheckpoint(cmd.id, cmd.checkpoint)
      case 'addDecision':
        return this.addDecision(cmd.id, cmd.decision)
      case 'addReview':
        return this.addReview(cmd.id, cmd.review)
    }
  }

  listBySession(sid: string): CardHead[] {
    const rows = this.db
      .prepare('SELECT * FROM stock_cards WHERE origin_session_id = ? ORDER BY created_at DESC')
      .all(sid) as CardRow[]
    return rows.map((r) => this.toHead(r))
  }

  /** 找本会话某 code 的未平仓卡 id(code 归一化);供 create 幂等 + card 工具解析代码→UUID。 */
  findOpenCardId(originSessionId: string, code: string): string | null {
    const row = this.db
      .prepare(
        "SELECT id FROM stock_cards WHERE origin_session_id = ? AND code = ? AND status != 'closed' ORDER BY created_at ASC LIMIT 1",
      )
      .get(originSessionId, normalizeCode(code)) as { id: string } | undefined
    return row?.id ?? null
  }

  // —— 写命令 ——

  private create(code: string, name: string, originSessionId: string): CardBundle {
    const normCode = normalizeCode(code)
    const existingId = this.findOpenCardId(originSessionId, normCode)
    if (existingId) return this.read(existingId)!
    const id = makeCardId(normCode)
    const ts = now()
    this.db
      .prepare(
        `INSERT INTO stock_cards (id, code, name, status, bucket, origin_session_id, eligibility, facts, thesis, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, normCode, name, 'watching', 'satellite', originSessionId, null, '{}', null, ts, ts)
    return this.read(id)!
  }

  private setEligibility(id: string, eligibility: Eligibility): CardBundle {
    this.assertCardExists(id)
    this.db
      .prepare('UPDATE stock_cards SET eligibility = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(eligibility), now(), id)
    return this.read(id)!
  }

  /** ② 事实带源(白名单)+ 时点;只增不改(合并观测,按 key append)。 */
  private addFacts(id: string, incoming: Facts): CardBundle {
    this.assertCardExists(id)
    const cur = JSON.parse(this.getRow(id)!.facts) as Facts
    for (const [key, fact] of Object.entries(incoming ?? {})) {
      for (const obs of fact?.series ?? []) {
        const tag = `${key}`
        if (!obs?.source || String(obs.source).trim() === '') {
          throw new CardValidationError('FACT_NO_SOURCE', `事实「${tag}」缺 source(无来源=编造,拒)`)
        }
        if (!isTrustedSource(obs.source)) {
          throw new CardValidationError(
            'FACT_SOURCE_UNTRUSTED',
            `事实「${tag}」来源「${obs.source}」不在可信白名单(只认 交易所/政府官网/投资机构/公司定期报告·公告/行业协会/权威数据终端)`,
          )
        }
        if (!obs.as_of || String(obs.as_of).trim() === '') {
          throw new CardValidationError('FACT_NO_ASOF', `事实「${tag}」缺 as_of(必须标事实时点)`)
        }
      }
      // 合并:已有 key → append 观测(只增不改);新 key → 整条加入
      if (cur[key]) cur[key].series.push(...(fact.series ?? []))
      else cur[key] = fact
    }
    this.db
      .prepare('UPDATE stock_cards SET facts = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(cur), now(), id)
    return this.read(id)!
  }

  /**
   * ①③⑦ 逻辑快照:估值参数挂事实(不变量⑦:anchor 立足)+ 命门挂逻辑/验证(①);价值/区间齐。
   * 命门 = 挂 logic 的参数(支持逻辑的指标;吸收原 drivers)。
   */
  private addThesisVersion(id: string, snap: ThesisSnapshot): CardBundle {
    this.assertCardExists(id)
    const facts = JSON.parse(this.getRow(id)!.facts) as Facts
    const factKeys = new Set(Object.keys(facts))
    const assumptions = snap.valuation?.assumptions
    if (!Array.isArray(assumptions) || assumptions.length === 0) {
      throw new CardValidationError(
        'VALUATION_NO_ASSUMPTIONS',
        '估值缺 assumptions(预测参数;至少含命门)',
      )
    }
    let hasCore = false
    for (const a of assumptions) {
      const name = a.label ?? a.key
      const f = a.forecast
      if (!f || (f.mode !== 'delta' && f.mode !== 'factor' && f.mode !== 'absolute')) {
        throw new CardValidationError('FORECAST_NO_MODE', `参数「${name}」无 forecast.mode`)
      }
      const isCore = !!(a.logic && a.logic.trim())
      // Guard 2a(命门基于事实):命门是"前值经逻辑估算预期"的叶子输入,必须 delta/factor(锚事实值推导);
      //   禁 absolute(凭空给数)。绝对常量(WACC/终值增长等技术输入)只能作支撑(去掉 logic)。方法无关。
      if (isCore && f.mode === 'absolute') {
        throw new CardValidationError(
          'CORE_FORECAST_NOT_DERIVED',
          `命门「${name}」用了 absolute(凭空给数)。命门预估须基于锚事实推导(delta=锚+增量 / factor=锚×倍数);纯常量请作支撑(去掉 logic)。`,
        )
      }
      // 不变量⑦:命门 / delta / factor 必立足锚事实(anchor.fact 指向已有 facts)
      const needsAnchor = isCore || f.mode === 'delta' || f.mode === 'factor'
      if (needsAnchor) {
        if (!a.anchor?.fact || a.anchor.fact.trim() === '') {
          throw new CardValidationError(
            'ASSUMPTION_NO_ANCHOR',
            `参数「${name}」无 anchor.fact(预测须立足事实)`,
          )
        }
        if (!factKeys.has(a.anchor.fact)) {
          throw new CardValidationError(
            'FACT_REFERENCED_MISSING',
            `参数「${name}」锚事实「${a.anchor.fact}」不在 facts(先 addFacts)`,
          )
        }
      }
      // delta/factor 须有基线时点,且该观测在序列中(对照复盘不漂的起点)
      if (f.mode === 'delta' || f.mode === 'factor') {
        const asOf = a.anchor?.as_of
        if (!asOf || asOf.trim() === '') {
          throw new CardValidationError(
            'ANCHOR_NO_ASOF',
            `参数「${name}」forecast=${f.mode} 须 anchor.as_of(基线时点)`,
          )
        }
        if (!(facts[a.anchor!.fact]?.series ?? []).some((o) => o.as_of === asOf)) {
          throw new CardValidationError(
            'ANCHOR_ASOF_MISSING',
            `参数「${name}」基线 ${a.anchor!.fact}@${asOf} 不在 facts 观测序列`,
          )
        }
        // Guard 2b(锚同量纲):delta/factor 是"锚事实值经推导",参数与锚必须同口径(单位一致),
        //   否则推算无意义(如 行业增速% ← 营收亿)。两边单位都须显式且相等。
        const factUnit = facts[a.anchor!.fact]?.unit ?? undefined
        const paramUnit = a.unit ?? undefined
        if (!paramUnit || !factUnit || paramUnit !== factUnit) {
          throw new CardValidationError(
            'ANCHOR_UNIT_MISMATCH',
            `参数「${name}」(单位 ${paramUnit ?? '∅'})与锚事实「${a.anchor!.fact}」(单位 ${factUnit ?? '∅'})量纲不一致 — delta/factor 推算要求同口径(锚应挂同量纲事实)。`,
          )
        }
      }
      // 命门 = 挂了 logic 的参数(支持逻辑的指标);命门必有验证(对账事实须在场)。
      if (isCore) {
        hasCore = true
        if (!Array.isArray(a.verify) || a.verify.length === 0) {
          throw new CardValidationError('CORE_NO_VERIFY', `命门「${name}」无 verify(验收映射)`)
        }
      }
      for (const vh of a.verify ?? []) {
        if (!factKeys.has(factRefKey(vh.fact))) {
          throw new CardValidationError(
            'FACT_REFERENCED_MISSING',
            `参数「${name}」验证事实「${vh.fact}」不在 facts`,
          )
        }
      }
    }
    if (!hasCore) {
      throw new CardValidationError('NO_CORE_ASSUMPTION', '至少需一个命门(带 logic 的参数)')
    }
    // 不变量③′(声明式恒等式·方法无关):一旦逐参数声明了 step,折叠链须收敛到 V ——
    // order 最大的末步 out 必须为 'V',否则算不出价值(链断在估值)。无 step 的卡(canonical pe 漏斗 /
    // dcf 等非线性法)由各自 pipeline 保证,不走此校验。
    const declaredSteps = snap.valuation.assumptions
      .filter((a) => a.step)
      .sort((x, y) => x.step!.order - y.step!.order)
    if (declaredSteps.length > 0) {
      const last = declaredSteps[declaredSteps.length - 1].step!
      if (last.out !== 'V') {
        throw new CardValidationError(
          'STEP_CHAIN_NOT_V',
          `声明式恒等式末步(order 最大)须产出 V,当前为「${last.out}」`,
        )
      }
    }
    // 不变量③(灭黑盒):价值必须由引擎从恒等式算出 —— 参数齐则冻结引擎 V(覆盖手填,杜绝拍脑袋数);
    // 算不出(键不匹配 pipeline 且无 step / 缺叶子参数)→ 链断,直接拒,不再用手填 V 兜底。
    const trace = computeValuationTrace(
      snap.valuation.method,
      resolveForecast(snap.valuation.assumptions, facts, 'now'),
    )
    if (trace.ok && trace.V) {
      snap.valuation.V = trace.V // 冻结:引擎算出的出身值(历史不回溯)
    } else {
      throw new CardValidationError(
        'VALUATION_NOT_COMPUTABLE',
        `估值链算不出 V(method=${snap.valuation.method}${trace.missing?.length ? `;缺/不匹配:${trace.missing.join('、')}` : ''})。请用该 method 标准键,或逐参数声明 step(叶子输入 delta/factor 基于事实,EPS/净利等中间量由公式计算)。`,
      )
    }
    if (snap.valuation.margin_of_safety?.required == null) {
      throw new CardValidationError(
        'NO_MARGIN_REQUIRED',
        '估值缺 margin_of_safety.required(安全边际门槛)',
      )
    }
    const thesis: Thesis = (() => {
      const row = this.getRow(id)!
      if (row.thesis) {
        const t = JSON.parse(row.thesis) as Thesis
        t.versions.push(snap)
        t.current = snap.v
        return t
      }
      return { versions: [snap], current: snap.v }
    })()
    this.db
      .prepare('UPDATE stock_cards SET thesis = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(thesis), now(), id)
    return this.read(id)!
  }

  /** ④ 复查锚出身版本(against_v 存在)不回溯。 */
  private addCheckpoint(id: string, cp: Checkpoint): CardBundle {
    this.assertCardExists(id)
    const row = this.getRow(id)!
    const thesis = row.thesis ? (JSON.parse(row.thesis) as Thesis) : null
    if (!thesis || !thesis.versions.some((v) => v.v === cp.against_v)) {
      throw new CardValidationError(
        'CHECKPOINT_NO_VERSION',
        `复查 against_v=${cp.against_v} 不存在(须锚已有逻辑版本,不回溯)`,
      )
    }
    // 不变量③:复查重估 V 由引擎算(against_v 版假设 × 当前最新事实)→ 冻结入档(时光机历史不漂移)
    const against = thesis.versions.find((v) => v.v === cp.against_v)!
    const cpFacts = JSON.parse(row.facts) as Facts
    const cpTrace = computeValuationTrace(
      against.valuation.method,
      resolveForecast(against.valuation.assumptions, cpFacts, 'now'),
    )
    if (cpTrace.ok && cpTrace.V && cp.value_now) {
      cp.value_now.V = cpTrace.V // 冻结:此刻引擎重估值,入档后不回流
    }
    // 对照复盘:每条对账的预测绝对值 = 基线锚(anchor.as_of)应用 forecast,系统算定冻结(不让 agent 填增量)
    const baseline = new Map(
      resolveForecast(against.valuation.assumptions, cpFacts, 'baseline').map((r) => [r.key, r]),
    )
    for (const chk of cp.checks ?? []) {
      const r = baseline.get(chk.metric)
      if (r && Number.isFinite(Number(r.base))) chk.predicted_value = r.base
    }
    this.append(id, '复查', cp, cp.at)
    return this.read(id)!
  }

  /** ⑤⑥⑧⑨ 决策:reason 必填 + 逻辑成立硬闸(⑧)+ 新鲜复查(⑨)+ 过 gate(⑤)+ 过安全边际(⑥)。override 留痕。 */
  private addDecision(id: string, dec: DecisionEvent): CardBundle {
    this.assertCardExists(id)
    if (!dec.reason || dec.reason.trim() === '') {
      throw new CardValidationError('DECISION_NO_REASON', '决策必注明理由(reason 必填)')
    }
    const latest = this.latestCheckpoint(id)
    const isOpen = dec.trade === '建' || dec.trade === '加'
    if (!dec.override) {
      // 不变量⑧:逻辑成立性硬闸 —— 证伪 → 禁建/加(仅减/清),无论价格多便宜(防价值陷阱)
      if (isOpen && latest?.validity === '证伪') {
        throw new CardValidationError(
          'LOGIC_FALSIFIED',
          '逻辑已证伪:禁止建/加仓(仅可减/清),无论价格多便宜(防价值陷阱)',
        )
      }
      // 不变量⑨:决策时效闸 —— 建/加须基于"已对账最新事实"的新鲜复查
      if (isOpen) {
        if (!latest) {
          throw new CardValidationError('NO_CHECKPOINT', '建/加须先复查(决策须基于已对账事实)')
        }
        const factAsOf = this.latestFactAsOf(id)
        if (factAsOf && latest.at < factAsOf) {
          throw new CardValidationError(
            'STALE_CHECKPOINT',
            `复查(${latest.at})早于最新事实(${factAsOf}):须重新复查后再决策(防陈旧估值)`,
          )
        }
      }
      const gate = latest?.gate?.state ?? null
      if (gate === '否决' && isOpen) {
        throw new CardValidationError('GATE_VETOED', 'gate=否决:禁止建仓/加仓(仅可减/清)')
      }
      if (gate === '节流' && dec.trade === '加') {
        throw new CardValidationError('GATE_THROTTLED', 'gate=节流:禁止加仓')
      }
      if (isOpen && latest?.value_now?.margin_of_safety?.at_buy_point !== true) {
        throw new CardValidationError(
          'MARGIN_NOT_REACHED',
          '安全边际未达买点(at_buy_point≠true):逻辑成立≠该买,需价格进安全边际(override 留痕)',
        )
      }
    }
    this.append(id, '决策', dec, dec.at)
    const next: CardStatus | null = dec.trade === '清' ? 'closed' : isOpen ? 'held' : null
    if (next) this.setStatus(id, next)
    return this.read(id)!
  }

  private addReview(id: string, review: ReviewEvent): CardBundle {
    this.assertCardExists(id)
    this.append(id, '复盘', review, review.at)
    return this.read(id)!
  }

  // —— 私有 plumbing ——

  private getRow(id: string): CardRow | null {
    return (this.db.prepare('SELECT * FROM stock_cards WHERE id = ?').get(id) as CardRow) ?? null
  }

  private toHead(r: CardRow): CardHead {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      bucket: (r.bucket as 'satellite') ?? undefined,
      origin_session_id: r.origin_session_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }
  }

  private getTimeline(cardId: string): TimelineEvent[] {
    const rows = this.db
      .prepare(
        'SELECT payload FROM card_timeline WHERE card_id = ? ORDER BY at ASC, created_at ASC',
      )
      .all(cardId) as Array<{ payload: string }>
    return rows.map((r) => JSON.parse(r.payload) as TimelineEvent)
  }

  private latestCheckpoint(cardId: string): Checkpoint | null {
    const row = this.db
      .prepare(
        "SELECT payload FROM card_timeline WHERE card_id = ? AND type = '复查' ORDER BY at DESC, created_at DESC LIMIT 1",
      )
      .get(cardId) as { payload: string } | undefined
    return row ? (JSON.parse(row.payload) as Checkpoint) : null
  }

  /** 全部事实里最新观测的 as_of(不变量⑨ 时效闸用:复查须不早于最新事实)。无事实→null。 */
  private latestFactAsOf(cardId: string): string | null {
    const row = this.getRow(cardId)
    if (!row?.facts) return null
    const facts = JSON.parse(row.facts) as Facts
    let max: string | null = null
    for (const f of Object.values(facts)) {
      for (const obs of f.series ?? []) {
        if (obs?.as_of && (max === null || obs.as_of > max)) max = obs.as_of
      }
    }
    return max
  }

  private append(cardId: string, type: TimelineEvent['type'], payload: unknown, at?: string): void {
    const ts = now()
    this.db
      .prepare(
        'INSERT INTO card_timeline (id, card_id, at, type, payload, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(randomUUID(), cardId, at ?? ts, type, JSON.stringify(payload), ts)
    this.setUpdatedAt(cardId, ts)
  }

  private assertCardExists(id: string): void {
    if (!this.getRow(id)) throw new CardValidationError('CARD_NOT_FOUND', `卡不存在: ${id}`)
  }

  private setStatus(id: string, status: CardStatus): void {
    this.db
      .prepare('UPDATE stock_cards SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id)
  }

  private setUpdatedAt(id: string, ts: string): void {
    this.db.prepare('UPDATE stock_cards SET updated_at = ? WHERE id = ?').run(ts, id)
  }
}
