// scripts/migrate-card-schema.mjs —— 把旧 schema 标的卡(from_fact/proj_mode/logic_anchor/顶层三档)
// 迁到新 schema(anchor{fact,as_of} + forecast{mode,bear/base/bull,horizon} + logic + falsify_if;
// checks: assumption/predicted/actual/actual_fact → metric/predicted_value/actual_value/actual_as_of)。
// 另:EPS×PE 乘除链 → 逐参数声明 step(method 归 pe),让引擎逐步算 V、每步中间量可见(不黑盒);
//     历史 method='custom' 收敛回 'pe'(custom 方法已废,step 折叠改为方法无关)。
// 幂等:已新 schema / 已声明 step 且非 custom 的跳过。用法:
//   node scripts/migrate-card-schema.mjs            # 迁所有旧卡
//   node scripts/migrate-card-schema.mjs <cardId>   # 只迁指定卡
// 需 better-sqlite3 = node 绑定(npm run rebuild:node)。

import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'

const db = new Database(join(homedir(), '.talor', 'chat.db'))
const onlyId = process.argv[2] || null

/** 一条估值参数:旧 → 新(已新则原样返回)。 */
function migrateAssumption(a) {
  if (!a || a.forecast) return a // 已新
  const out = { key: a.key, label: a.label }
  if (a.unit != null) out.unit = a.unit
  if (a.from_fact) {
    const i = String(a.from_fact).indexOf('@')
    out.anchor = i >= 0
      ? { fact: a.from_fact.slice(0, i), as_of: a.from_fact.slice(i + 1) }
      : { fact: a.from_fact }
  }
  out.forecast = { mode: a.proj_mode || 'absolute', bear: a.bear, base: a.base, bull: a.bull }
  if (a.horizon) out.forecast.horizon = a.horizon
  if (a.logic_anchor) out.logic = a.logic_anchor
  if (a.falsify) out.falsify_if = a.falsify
  if (a.market_implied != null) out.market_implied = a.market_implied
  if (a.verify) out.verify = a.verify
  return out
}

/** 一条对账:旧 → 新(已新则原样返回)。 */
function migrateCheck(c) {
  if (!c || c.metric) return c
  const { assumption, predicted, actual, actual_fact, ...rest } = c
  const out = { metric: assumption, ...rest }
  if (predicted !== undefined) out.predicted_value = predicted
  if (actual !== undefined) out.actual_value = actual
  if (actual_fact !== undefined) out.actual_as_of = actual_fact
  return out
}

// canonical pe 专属"漏斗叶子"——出现任一即真 pe(不动);误标卡则缺这些。
const FUNNEL_LEAVES = ['ev_pen', 'mkt_capacity', 'co_share', 'asp', 'shares']
const BUILTIN_METHODS = ['pe', 'dcf', 'pb-roe', 'ddm', 'nav']

/** EPS×PE 乘除链 → 声明式 step(EPS 种子 × PE = V),method 归 pe(它就是 PE 倍数估值)。
 *  另:把历史误用的 method='custom' 收敛回 'pe'(custom 已废,step 折叠改为方法无关)。
 *  其余参数(revenue_growth/net_margin…)留定性命门(无 step)。canonical pe 漏斗不碰。
 *  幂等:已有 step 且 method≠custom / 含漏斗叶子 / 非 EPS×PE 形态 → 跳过。 */
function migrateToStepChain(thesis) {
  if (!thesis?.versions) return false
  let changed = false
  for (const v of thesis.versions) {
    const val = v.valuation
    const a = val?.assumptions
    if (!Array.isArray(a) || a.length === 0) continue
    // ① 历史 custom → pe(step 保留;custom 方法已移除)
    if (val.method === 'custom') {
      val.method = 'pe'
      changed = true
      console.log(`  ↳ method=custom → pe(step 折叠方法无关,保留 step)`)
      continue
    }
    // ② 误标的 EPS×PE 漏斗(无 step)→ 声明 step,method 保持(pe)
    if (a.some((x) => x.step)) continue
    if (!BUILTIN_METHODS.includes(val.method)) continue
    if (a.some((x) => FUNNEL_LEAVES.includes(x.key))) continue // canonical pe 漏斗,走内置 pipeline
    const eps = a.find((x) => /eps/i.test(x.key))
    const pe = a.find((x) => /pe/i.test(x.key) && x !== eps)
    if (!eps || !pe) continue // 非 EPS×PE 形态
    eps.step = { order: 1, out: 'EPS年值' }
    pe.step = { order: 2, op: '×', out: 'V' }
    changed = true
    console.log(`  ↳ ${eps.key} × ${pe.key} → 声明 step(method=${val.method})`)
  }
  return changed
}

/** 找符合角色的"带单位"事实(取最新观测 as_of);无单位 → 不返回(过不了量纲关)。 */
function findFundFact(facts, re) {
  for (const [k, f] of Object.entries(facts ?? {})) {
    if (!re.test(k)) continue
    if (!f?.unit || !String(f.unit).trim()) continue
    const last = f.series?.[f.series.length - 1]
    if (last?.as_of) return { key: k, unit: f.unit, asOf: last.as_of }
  }
  return null
}

/** EPS×PE 捷径(EPS 当命门直接预测)→ 重建为基本面链:营收×净利率÷股本×PE,EPS 计算得出。
 *  命门叶子全 factor 基于事实(过 Guard 2a/2b);仅当有带单位的 营收/净利率/股本/PE 事实时重建,
 *  否则跳过(留 UI computedWarn 标记,待 agent 重抓数据建链)。 */
function rebuildToFundamental(thesis, facts) {
  if (!thesis?.versions) return false
  let changed = false
  for (const v of thesis.versions) {
    const a = v.valuation?.assumptions
    if (!Array.isArray(a)) continue
    if (!a.some((x) => x.logic && /eps|每股收益/i.test(x.key))) continue // 仅"EPS 当命门"的捷径卡
    const rev = findFundFact(facts, /revenue|营收|营业收入/i)
    const mgn = findFundFact(facts, /net_margin|净利率/i)
    const sh = findFundFact(facts, /shares|股本/i)
    const pe =
      findFundFact(facts, /pe.*(center|hist)|历史.*pe|pe.*中枢/i) ||
      findFundFact(facts, /pe_ttm|动态pe/i)
    if (!rev || !mgn || !sh || !pe) continue // 数据不足(缺带单位事实)→ 跳过
    v.valuation.method = 'pe'
    v.valuation.assumptions = [
      {
        key: rev.key,
        label: '营收',
        unit: rev.unit,
        anchor: { fact: rev.key, as_of: rev.asOf },
        forecast: { mode: 'factor', bear: 0.97, base: 1.0, bull: 1.08 },
        verify: [{ fact: rev.key, at: 'annual', role: '终验' }],
        logic: '行业增速放缓+份额提升对冲',
        step: { order: 1, out: '营收' },
      },
      {
        key: mgn.key,
        label: '净利率',
        unit: mgn.unit,
        anchor: { fact: mgn.key, as_of: mgn.asOf },
        forecast: { mode: 'factor', bear: 0.7, base: 1.0, bull: 1.25 },
        verify: [{ fact: mgn.key, at: 'annual', role: '终验' }],
        logic: '价格战压毛利、规模+垂直整合对冲',
        step: { order: 2, op: '×', out: '净利' },
      },
      {
        key: sh.key,
        label: '股本',
        unit: sh.unit, // 支撑(无 logic)
        anchor: { fact: sh.key, as_of: sh.asOf },
        forecast: { mode: 'factor', bear: 1.0, base: 1.0, bull: 1.0 }, // 股本基本不变
        step: { order: 3, op: '÷', out: 'EPS' },
      },
      {
        key: pe.key,
        label: 'PE中枢',
        unit: pe.unit,
        anchor: { fact: pe.key, as_of: pe.asOf },
        forecast: { mode: 'factor', bear: 0.8, base: 1.0, bull: 1.2 },
        verify: [{ fact: pe.key, at: 'quarterly', role: '终验' }],
        logic: '动态PE 透支成长,回归历史中枢',
        step: { order: 4, op: '×', out: 'V' },
      },
    ]
    changed = true
    console.log(`  ↳ EPS×PE 捷径 → 基本面链(${rev.key}×${mgn.key}÷${sh.key}×${pe.key})`)
  }
  return changed
}

function migrateThesis(thesis, facts) {
  if (!thesis?.versions) return { thesis, changed: false }
  let changed = false
  for (const v of thesis.versions) {
    const a = v.valuation?.assumptions
    if (Array.isArray(a)) {
      const next = a.map(migrateAssumption)
      if (next.some((x, i) => x !== a[i])) {
        v.valuation.assumptions = next
        changed = true
      }
    }
  }
  if (migrateToStepChain(thesis)) changed = true // 误标乘除链 → 声明 step;历史 custom → pe
  if (rebuildToFundamental(thesis, facts)) changed = true // EPS×PE 捷径 → 基本面链(EPS 计算得出)
  return { thesis, changed }
}

const rows = onlyId
  ? db.prepare('SELECT id, thesis, facts FROM stock_cards WHERE id = ?').all(onlyId)
  : db.prepare('SELECT id, thesis, facts FROM stock_cards').all()

const upThesis = db.prepare('UPDATE stock_cards SET thesis = ? WHERE id = ?')
const tlRows = db.prepare('SELECT id, card_id, type, payload FROM card_timeline')
const upTl = db.prepare('UPDATE card_timeline SET payload = ? WHERE id = ?')

let cards = 0
let tls = 0
const tx = db.transaction(() => {
  for (const r of rows) {
    if (!r.thesis) continue
    const { thesis, changed } = migrateThesis(JSON.parse(r.thesis), JSON.parse(r.facts ?? '{}'))
    if (changed) {
      upThesis.run(JSON.stringify(thesis), r.id)
      cards++
      console.log(`✓ thesis 迁移: ${r.id}`)
    }
  }
  for (const t of tlRows.all()) {
    if (onlyId && t.card_id !== onlyId) continue
    if (t.type !== '复查') continue
    const cp = JSON.parse(t.payload)
    if (!Array.isArray(cp.checks)) continue
    const next = cp.checks.map(migrateCheck)
    if (next.some((x, i) => x !== cp.checks[i])) {
      cp.checks = next
      upTl.run(JSON.stringify(cp), t.id)
      tls++
      console.log(`✓ 复查 checks 迁移: ${t.card_id} @${cp.at}`)
    }
  }
})
tx()

console.log(`\n完成:迁移 ${cards} 张卡 thesis + ${tls} 条复查 checks${onlyId ? `(限 ${onlyId})` : ''}。`)
db.close()
