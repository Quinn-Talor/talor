// tests/e2e/invest-workspace.e2e.ts —— 真 IPC + 真 SQLite 端到端(Electron)
//
// 补齐单测/集成测未覆盖的最后一环:ipcMain ↔ ipcRenderer ↔ better-sqlite3 真链路。
// 手法:HOME 指向临时目录(不碰真 ~/.talor)→ 启动 build 出的真 app → 在 Electron
// 主进程内(better-sqlite3 electron ABI)向真 app 库 seed 一张卡 → 驱动真渲染,数据全程
// 走 artifact:list / artifact:read / session:getMessages 真 IPC。
//
// 前置:electron-vite build(out/) + npm run rebuild:electron。经 `npm run test:e2e` 跑。

import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'

let app: ElectronApplication
let page: Page

const CARD_ID = 'e2e-byd'
const SESSION = 'e2e-sess'
const V1_CLAIM = '政策驱动+成本护城河,份额抢占'
const V2_CLAIM = '份额加速·上调预期'

const assumption = () => ({
  key: 'co_share',
  label: '公司份额',
  unit: '%',
  anchor: { fact: 'co_share', as_of: '2026-03' },
  forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026' },
  logic: '成本护城河 → 份额持续抢占',
  falsify_if: '连2季<14%',
  step: { order: 1, out: 'V' },
})

// seed 载荷(在主进程内以原始 SQL 落库;绕过写入闸门 —— 闸门另有测试,此处专测读链路)
const seed = {
  id: CARD_ID,
  code: '002594',
  name: '比亚迪',
  status: 'held',
  origin_session_id: SESSION,
  eligibility: JSON.stringify({ red_flags: 0, source_positive: true, in_circle: true, pass: true }),
  facts: JSON.stringify({
    co_share: {
      level: 'company',
      label: '份额',
      unit: '%',
      series: [
        { value: '14%', as_of: '2026-03', source: '乘联会' },
        { value: '16%', as_of: '2026-07', source: '乘联会' },
      ],
    },
    ev_pen: {
      level: 'industry',
      label: '渗透率',
      unit: '%',
      role: '排雷',
      series: [{ value: '42%', as_of: '2026-06', source: '中汽协' }],
    },
  }),
  thesis: JSON.stringify({
    current: 2,
    versions: [
      {
        v: 1,
        at: '2026-03',
        scope: '建立',
        claim: V1_CLAIM,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [assumption()],
          V: { bear: 13, base: 14, bull: 15 },
          margin_of_safety: { required: 0.2, anchor: 'bear' },
        },
      },
      {
        v: 2,
        at: '2026-06',
        scope: '校准',
        claim: V2_CLAIM,
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [assumption()],
          V: { bear: 15, base: 16, bull: 17 },
          margin_of_safety: { required: 0.2, anchor: 'bear' },
        },
      },
    ],
  }),
  timeline: [
    {
      at: '2026-04-30',
      type: '复查',
      payload: JSON.stringify({
        type: '复查',
        at: '2026-04-30',
        against_v: 1,
        validity: '持有',
        checks: [],
        value_now: {
          V: { bear: 13, base: 14, bull: 15 },
          margin_of_safety: { at_buy_point: true },
        },
        gate: { state: '通行' },
        spawned_v: null,
        signal: { verdict: '等', reason: 'r' },
      }),
    },
    {
      at: '2026-05-10',
      type: '决策',
      payload: JSON.stringify({
        type: '决策',
        at: '2026-05-10',
        trade: '建',
        reason: '进安全边际,首建 10%',
        based_v: 1,
        weight: 0.1,
      }),
    },
    {
      at: '2026-07-31',
      type: '复查',
      payload: JSON.stringify({
        type: '复查',
        at: '2026-07-31',
        against_v: 1,
        validity: '校准',
        checks: [],
        value_now: {
          V: { bear: 15, base: 16, bull: 17 },
          margin_of_safety: { at_buy_point: false },
        },
        gate: { state: '通行' },
        spawned_v: 2,
        signal: { verdict: '等', reason: '份额加速' },
      }),
    },
  ],
}

test.beforeAll(async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'talor-e2e-'))
  mkdirSync(join(tmpHome, '.talor'), { recursive: true })
  const dbPath = join(tmpHome, '.talor', 'chat.db')

  // 启动前 seed:electron-as-node 跑 seed 脚本(better-sqlite3 = electron ABI,与 app 一致),
  // 建两表 + 落卡。app 随后启动读同一库(HOME 指到 tmpHome,不碰真 ~/.talor)。
  const jsonPath = join(tmpHome, 'seed.json')
  writeFileSync(jsonPath, JSON.stringify(seed))
  const require = createRequire(import.meta.url)
  const electronPath = require('electron') as string
  execFileSync(electronPath, [join(process.cwd(), 'tests/e2e/seed-db.cjs'), dbPath, jsonPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  })

  app = await _electron.launch({
    args: ['out/main/index.js'],
    cwd: process.cwd(),
    env: { ...process.env, HOME: tmpHome, TALOR_HOME: tmpHome, NODE_ENV: 'production' },
    timeout: 45_000,
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('真 IPC+SQLite:池子→活论文→时光机拨动→分析过程 全链', async () => {
  // 进工作台(平台顶级 surface)
  await page.getByText('投研工作台').first().click()

  // 池子:artifact:list 真 IPC → SQLite 读回 seed 卡
  await expect(page.getByText('比亚迪')).toBeVisible()
  await expect(page.getByText('002594')).toBeVisible()

  // 活论文:自动选首卡 → artifact:read 真 IPC → 传导链现在态=最新逻辑 v2
  await expect(page.getByText('v2 · 成长')).toBeVisible()
  // 事实区命门事实(exact 避开传导链的"公司份额")
  await expect(page.getByText('份额', { exact: true })).toBeVisible()

  // 时光机拨动:点建立节点 → reconstruct 回拨 v1(真数据全栈重建)
  await page.getByText('建立', { exact: true }).click()
  await expect(page.getByText('历史 · 冻结只读')).toBeVisible()
  await expect(page.getByText(V1_CLAIM)).toBeVisible()

  // 分析过程:session:getMessages 真 IPC(未 seed 消息 → 空态,证明 IPC 往返)
  await expect(page.getByText('此标的暂无研究对话')).toBeVisible()
})
