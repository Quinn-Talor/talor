// scripts/seed-sample-card.mjs — 验证用:绕过数据源,直接注入一张新 schema 标的卡
// + 一条带 stock_card chip 的 assistant 消息(挂到最近的 session),
// 让案卷面板渲染:决策面(散户层 §9 五行)+ 三下钻(事实/逻辑/时间线整合因果轴)。
// 教学态 = §9 canonical「等」:逻辑没破但价格回升、安全边际不足 → 等回调。
// 时间线演示:建立 v1 → 复查(逻辑不动·挡噪声)→ 决策(基于 v1·建)→ 复查(参数错·校准 v1→v2 台阶)→ 复盘(跑赢)。
// 仅供本地验证 UI,不进生产。用法:node scripts/seed-sample-card.mjs   (需 better-sqlite3 = node 绑定)

import Database from 'better-sqlite3'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const db = new Database(join(homedir(), '.talor', 'chat.db'))
db.pragma('foreign_keys = ON')

db.exec(`CREATE TABLE IF NOT EXISTS stock_cards (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'watching' CHECK(status IN ('watching','held','closed')),
  bucket TEXT, origin_session_id TEXT NOT NULL,
  eligibility TEXT, facts TEXT NOT NULL DEFAULT '{}', thesis TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`)
db.exec(`CREATE TABLE IF NOT EXISTS card_timeline (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, at TEXT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES stock_cards(id) ON DELETE CASCADE);`)

const sess = db
  .prepare('SELECT id FROM sessions WHERE parent_session_id IS NULL ORDER BY updated_at DESC LIMIT 1')
  .get()
if (!sess) {
  console.error('无顶层 session,先在 app 里发一条消息再跑本脚本。')
  process.exit(1)
}
const sid = sess.id
const cardId = `002594-20260731-sample01`

db.prepare('DELETE FROM stock_cards WHERE id = ?').run(cardId)
db.prepare("DELETE FROM messages WHERE content LIKE '%【样例卡】%'").run()

// ① 事实:按 key 序列·三维·三层·先行重点
const facts = {
  ev_pen: { level: 'industry', label: '行业渗透率', unit: '%', role: '同步',
    series: [
      { value: '38%', as_of: '2025-12', source: '中汽协' },
      { value: '42%', as_of: '2026-06', source: '中汽协', structure: { note: '高端先行,下沉慢', quality: 'mixed' } },
    ] },
  monthly_sales: { level: 'company', label: '月度销量', unit: '万辆', role: '先行',
    series: [{ value: '28万', as_of: '2026-07', source: '乘联会', change: { yoy: '+9%', trend: 'down', trend_note: '34→28·放缓' } }] },
  co_share: { level: 'company', label: '公司份额', unit: '%', role: '同步',
    series: [
      { value: '16%', as_of: '2025-12', source: '乘联会' },
      { value: '14%', as_of: '2026-07', source: '乘联会', change: { trend: 'down', trend_note: '16→14·连2季' },
        structure: { note: '以量补价失效', quality: 'deteriorating', components: [{ name: '量', value: '+9%', signal: 'neutral' }, { name: '价', value: '-11%', signal: 'bad' }] } },
    ] },
  inventory: { level: 'company', label: '存货', unit: '亿元', role: '排雷',
    series: [{ value: '340亿', as_of: '2026-06', source: '巨潮:附注',
      change: { yoy: '+22%', turnover_days: 61, turnover_trend: '52→61·放缓' },
      structure: { note: '产成品激增·滞销苗头', quality: 'deteriorating', components: [{ name: '产成品', value: '185亿 +31%', signal: 'bad' }] } }] },
  rev_yoy: { level: 'company', label: '营收增速', unit: '%', role: '同步',
    series: [{ value: '15%', as_of: '2026-06', source: '巨潮:中报', change: { trend: 'down', trend_note: '22→15·减速', percentile: 55 } }] },
  policy_ev: { level: 'macro', label: '购置税政策', role: '先行',
    series: [{ value: '延续2027', as_of: '2026-03', source: '财政部' }] },
}

// ② 逻辑:冻结快照·版本化(v1 建立 → v2 校准);claim = 大白话一句话(散户决策面头条)
// valuation.assumptions = 全部估值预测参数(命门=high,带 logic_anchor/falsify;每参数双向挂事实 from_fact/verify)
// 命门(渗透率/份额,带 logic_anchor/falsify/market_implied,双向挂事实)
const aShare = (base, falsify) => ({
  key: 'co_share', label: '公司份额', unit: '%', bear: base - 1, base, bull: base + 1,
  from_fact: 'co_share@2025-12', verify: [{ fact: 'monthly_sales', at: 'monthly', role: '先行' }, { fact: 'co_share', at: 'quarterly', role: '终验' }],
  sensitivity: 'high', logic_anchor: '成本护城河', falsify, market_implied: '16%',
})
const aPen = {
  key: 'ev_pen', label: '行业渗透率', unit: '%', bear: 45, base: 50, bull: 55,
  from_fact: 'ev_pen@2025-12', verify: [{ fact: 'ev_pen', at: 'annual', role: '终验' }],
  sensitivity: 'high', logic_anchor: '政策驱动消费', falsify: '年报<45%', market_implied: '48%',
}
// 支撑 / 常量(pe 恒等式叶子参数;seed 直插 DB,from_fact 仅示意)
const aCap = { key: 'mkt_capacity', label: '行业容量', unit: '万辆', bear: 2826, base: 2826, bull: 2826, from_fact: 'ev_pen@2025-12', sensitivity: 'low' }
const aAsp = { key: 'asp', label: '单价', unit: '万元', bear: 16.5, base: 16.5, bull: 16.5, from_fact: 'rev_yoy@2026-06', sensitivity: 'mid' }
const aMargin = { key: 'net_margin', label: '净利率', unit: '%', bear: 8, base: 9, bull: 10, from_fact: 'rev_yoy@2026-06', sensitivity: 'mid' }
const aShares = { key: 'shares', label: '股本', unit: '亿股', bear: 29, base: 29, bull: 29, from_fact: 'rev_yoy@2026-06', sensitivity: 'low' }
const aPe = { key: 'pe_central', label: 'PE中枢', unit: 'x', bear: 23, base: 25, bull: 27, from_fact: '行业估值分位@2026-06', sensitivity: 'low' }
// pe 恒等式全参数集(7):渗透率×容量→份额→单价→净利率→股本→PE → V
const peAssumps = (shareBase, falsify) => [aPen, aCap, aShare(shareBase, falsify), aAsp, aMargin, aShares, aPe]
const thesis = {
  versions: [
    { v: 1, at: '2026-03-31', scope: '建立',
      claim: '政策让电车多卖,比亚迪成本低抢份额 → 赚钱', profit_type: '成长',
      valuation: { method: 'pe', method_reason: '成长股→PE,非周期不套PB-ROE',
        assumptions: peAssumps(16, '连2季<14%'),
        V: { bear: 200, base: 289, bull: 406 }, margin_of_safety: { required: 0.25, anchor: 'base', required_basis: 'V区间宽+命门high未验+成长股→25%' } } },
    { v: 2, at: '2026-07-31', scope: '校准',
      claim: '政策仍催电车,但份额被价格战侵蚀降速 → 仍赚但少', profit_type: '成长',
      valuation: { method: 'pe',
        assumptions: peAssumps(14.5, '连2季<13%'),
        V: { bear: 180, base: 262, bull: 370 }, margin_of_safety: { required: 0.25, anchor: 'base' } },
      ref_checkpoint: 'cp-0731' },
  ],
  current: 2,
}

// ⑤ 资格:8红灯/正和/能力圈 + 好生意体检(判断-only,数值在 facts)
const eligibility = {
  red_flags: 0, source_positive: true, in_circle: true, pass: true,
  good_business: { quality_gate: 'pass', moat: { type: '成本优势·规模', durability: '中' }, grade: '良' },
}

const ts = '2026-08-01T10:00:00.000Z'
db.prepare(
  `INSERT INTO stock_cards (id,code,name,status,bucket,origin_session_id,eligibility,facts,thesis,created_at,updated_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
).run(cardId, '002594', '比亚迪', 'held', 'satellite', sid, JSON.stringify(eligibility), JSON.stringify(facts), JSON.stringify(thesis), '2026-03-31T09:00:00.000Z', ts)

// ③ 时间线:复查(逻辑不动)→ 决策(建·基于v1)→ 复查(校准·台阶)→ 复盘(跑赢)
const cp1 = {
  type: '复查', at: '2026-04-30', against_v: 1,
  validity: '持有', conviction: 'mid',
  checks: [{ assumption: 'co_share', predicted: '16%', actual: '15.5%', actual_fact: 'co_share@2026-03',
    deviation: { 数值: '-0.5pp', 变化: '小幅' }, outcome: '容差',
    attribution: { cause: '季节性,Q2恢复', type: '外生' } }],
  value_now: { V: { bear: 210, base: 265, bull: 350 }, price: 195, realized_pct: 0.2,
    margin_of_safety: { to_bear: '-7%', vs_required: '门槛25%·达标', at_buy_point: true, buy_trigger: 199 } },
  gate: { state: '通行', reason: [] }, spawned_v: null,
  signal: { verdict: '买', reason: '回调至安全边际达标(195≤买点199),命门holding·挡噪声' },
}
const dec = { type: '决策', at: '2026-05-15', trade: '建', price: 195, weight: 0.05, based_v: 1, reason: '边际达标(195≤买点199),双命门holding' }
// 双向验证:渗透率兑现(强化)+ 份额偏离(校准)→ validity=校准
const cp2 = {
  type: '复查', at: '2026-07-31', against_v: 1,
  validity: '校准', conviction: 'mid',
  checks: [
    { assumption: 'ev_pen', predicted: '50%', actual: '51%', actual_fact: 'ev_pen@2026-06',
      deviation: { 数值: '+1pp', 变化: '兑现' }, outcome: '兑现' },
    { assumption: 'co_share', predicted: '16%', actual: '14%', actual_fact: 'co_share@2026-07',
      deviation: { 数值: '-2pp', 结构: '以量补价失效', 变化: '连2季减速' }, outcome: '偏离',
      attribution: { cause: '价格战侵蚀份额,非季节性', type: '参数错' } },
  ],
  value_now: { V: { bear: 180, base: 262, bull: 370 }, price: 248, realized_pct: 0.3,
    margin_of_safety: { to_bear: '+38%', vs_required: '门槛25%·不足', at_buy_point: false, buy_trigger: 135 } },
  gate: { state: '通行', reason: [] }, spawned_v: 2,
  signal: { verdict: '等', reason: '渗透率兑现但份额连2季偏(参数错)→校准v2;价格回升,边际不足→不加' },
}
const review = { type: '复盘', at: '2026-12-31', vs_benchmark: { satellite: 0.18, index: 0.12, verdict: '跑赢' }, lesson: '拐点信号阈值更严:份额连偏即校准,别等2季', ref_v: 2 }

const ins = db.prepare('INSERT INTO card_timeline (id,card_id,at,type,payload,created_at) VALUES (?,?,?,?,?,?)')
ins.run(randomUUID(), cardId, cp1.at, '复查', JSON.stringify(cp1), '2026-04-30T09:00:00.000Z')
ins.run(randomUUID(), cardId, dec.at, '决策', JSON.stringify(dec), '2026-05-15T09:00:00.000Z')
ins.run(randomUUID(), cardId, cp2.at, '复查', JSON.stringify(cp2), '2026-07-31T09:00:00.000Z')
ins.run(randomUUID(), cardId, review.at, '复盘', JSON.stringify(review), '2026-12-31T09:00:00.000Z')

const msgContent = JSON.stringify([
  { type: 'text', text: '【样例卡】比亚迪(002594)新 schema 标的卡 — 直接注入(绕过数据源),验证案卷 UI:决策面(五行·价格降权)+ 三下钻(事实/逻辑/时间线整合因果轴)。点下方卡片打开。' },
  { type: 'stock_card', id: cardId, head: { code: '002594', name: '比亚迪' } },
])
const nowIso = new Date().toISOString()
db.prepare("INSERT INTO messages (id,session_id,role,content,content_type,agent_id,created_at) VALUES (?,?,?,?,'blocks',?,?)")
  .run(randomUUID(), sid, 'assistant', msgContent, 'stock-research', nowIso)
db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(nowIso, sid)

console.log(`✓ 样例卡 ${cardId} 已注入顶层 session ${sid}(thesis 2版·大白话 claim + 好生意体检 + 复查×2[1不动1校准] + 决策based_v + 复盘),消息置底可见`)
db.close()
