// tests/e2e/seed-db.cjs —— E2E 播种脚本(经 electron-as-node 跑,better-sqlite3 = electron ABI)
// 用法: ELECTRON_RUN_AS_NODE=1 <electron> seed-db.cjs <dbPath> <jsonPath>
// 建 invest 两表(与 store CREATE 同构;app 启动时 createCardTables IF NOT EXISTS 复用)+ 落一张卡。

const Database = require('better-sqlite3')
const fs = require('fs')

const [, , dbPath, jsonPath] = process.argv
const { timeline, ...card } = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

const db = new Database(dbPath)
db.exec(`
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
CREATE TABLE IF NOT EXISTS card_timeline (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL,
  at          TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES stock_cards(id) ON DELETE CASCADE
);`)

db.prepare(
  `INSERT INTO stock_cards (id,code,name,status,bucket,origin_session_id,eligibility,facts,thesis,created_at,updated_at)
   VALUES (@id,@code,@name,@status,NULL,@origin_session_id,@eligibility,@facts,@thesis,'2026-03','2026-07')`,
).run(card)

const ins = db.prepare(
  `INSERT INTO card_timeline (id,card_id,at,type,payload,created_at) VALUES (?,?,?,?,?,?)`,
)
timeline.forEach((e, i) => ins.run('tl' + i, card.id, e.at, e.type, e.payload, e.at))

db.close()
console.log('seeded card ' + card.id + ' with ' + timeline.length + ' timeline events')
