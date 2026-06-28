// scripts/migrate-card-schema.mjs —— 把旧 schema 标的卡(from_fact/proj_mode/logic_anchor/顶层三档)
// 迁到新 schema(anchor{fact,as_of} + forecast{mode,bear/base/bull,horizon} + logic + falsify_if;
// checks: assumption/predicted/actual/actual_fact → metric/predicted_value/actual_value/actual_as_of)。
// 幂等:已是新 schema 的跳过。用法:
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

function migrateThesis(thesis) {
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
  return { thesis, changed }
}

const rows = onlyId
  ? db.prepare('SELECT id, thesis FROM stock_cards WHERE id = ?').all(onlyId)
  : db.prepare('SELECT id, thesis FROM stock_cards').all()

const upThesis = db.prepare('UPDATE stock_cards SET thesis = ? WHERE id = ?')
const tlRows = db.prepare('SELECT id, card_id, type, payload FROM card_timeline')
const upTl = db.prepare('UPDATE card_timeline SET payload = ? WHERE id = ?')

let cards = 0
let tls = 0
const tx = db.transaction(() => {
  for (const r of rows) {
    if (!r.thesis) continue
    const { thesis, changed } = migrateThesis(JSON.parse(r.thesis))
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
