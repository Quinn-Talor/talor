# A股投资 Agent — 预测·验证·复盘模型(锚/预测/对照 + 字段见名知义重构)

> 本文 = 在 [`value-chain-rigor.md`](./value-chain-rigor.md) 基础上,把**「预测怎么存、对照复盘怎么对账」**收敛严谨,并把相关字段名校准到**见名知义**。
> 背景:`proj_mode` 落地后,三档(`bear/base/bull`)存的是"相对锚的增量",但字段名看着像绝对值 → 决策面、下钻、复盘读法不一,易混。本文厘清四概念关系 → 双锚计算 → 字段重构。
> 日期:2026-06-28。实施后回填 `value-chain-rigor.md` + README。

---

## 0. 问题(为什么要这次重构)

1. **三档语义被名字掩盖**:`proj_mode='delta'` 时 `base=0.5` 是"+0.5pp 增量",不是预测值 14.5%;`bear/base/bull` 这名字让人误读成绝对值(决策面一度显"估 0.5")。
2. **锚被塞进字符串**:`from_fact: "co_share@2026-07"` 把"锚指标 + 基线时点"两件事塞一个字段;且 resolver 一律取 **latest**、忽略 `@as_of` 基线。
3. **对照复盘对不上**:`checks[].predicted` 由 agent 填了 `against_v` 版 base(=增量),且该用**基线锚**而非 latest → "预测 vs 实际"量纲错、跑不通。
4. **命名撞车**:`logic_anchor` 的 "anchor" 与预测的"锚"(from_fact)撞名;`falsify` 是动词但存的是条件。

---

## 1. 四概念关系(事实 · 逻辑 · 预测 · 验证)

不是四个并列模块,是一条**因果闭环**,且**命门**把四者拧在一起:

```
事实 ─归纳→ 逻辑 ─量化(锚+推测)→ 预测 ─时间·新事实→ 验证 ─归因→ 逻辑(闭环)
  └────────────── 事实是底座,在 3 处喂入 ──────────────┘
```

- **命门 = 一个估值参数对象 = 四面合体**:挂逻辑(`logic`)+ 锚在事实(`anchor`)+ 推出预测(`forecast`)+ 配验证(`verify`/`falsify_if`)。支撑参数只有"事实锚 + 预测"两面,无逻辑/证伪 → 固定 base、不撑区间。
- **同一条事实有 4 个角色**(混乱根源):① 证据(立论时读)② 基线锚(预测起点,`@as_of` 那条)③ 对照靶(到期实际)④ 现值基准(永远 latest → V_now)。
- **节奏**:事实快变·只增不改;逻辑慢变·版本冻结;预测=配方冻结(增量)+ 绝对值看锚;验证=事件触发(每财报)·逐次冻结。

---

## 2. 卡片对应(card 三区)

| 概念        | 落在 card                        | 字段                                            |
| ----------- | -------------------------------- | ----------------------------------------------- |
| ① 事实      | `facts[key].series[]`            | `{value, as_of, source}` append-only            |
| ② 逻辑      | `thesis.versions[v]`             | `claim` + 命门的 `logic`                        |
| ③ 预测      | `thesis…assumptions[]`           | `anchor` + `forecast`(冻结于版本)+ `V`          |
| ④ 验证·计划 | `thesis…assumptions[]`           | `verify[]` + `falsify_if`(冻结于版本)           |
| ④ 验证·记录 | `timeline[].Checkpoint.checks[]` | `predicted_value` vs `actual_value`(逐复查冻结) |

跨区引用:`anchor.fact → facts`;`checks.metric → assumptions.key`;`checks.actual_* → facts`;`against_v → versions`。

---

## 3. 双锚:同一 forecast,两种锚两用途

预测的"配方"(锚指标 + 推测量)冻在版本里**只有一份**,但解析时按用途取不同的锚:

```
现值 V_now (活算·回流)   : 锚 = facts[anchor.fact] 最新观测      → 应用 forecast
复盘预测 (冻结·对照靶)   : 锚 = facts[anchor.fact]@anchor.as_of  → 应用 forecast
```

一个解析函数两模式:

```
resolveForecast(assumption, facts, when: 'now' | 'baseline') → { bear, base, bull }(绝对值)
  when='now'      锚取 series 最新       → V_now / 决策面"估" / 下钻阶梯
  when='baseline' 锚取 anchor.as_of 那条 → 对照复盘的预测绝对值(基线 append-only ⇒ 稳定不漂)
```

> 不需要新存"预测绝对值"字段:基线观测 append-only 不可变 ⇒ `baseline` 模式的结果永远可稳定派生。

---

## 4. 字段模型(见名知义 · 全重构)

### 4.1 `ValuationAssumption`(before → after)

| 现字段                          | 新字段                      | 说明                                                          |
| ------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `from_fact: "co_share@2026-07"` | `anchor: { fact, as_of }`   | 锚=预测起点;拆成指标 + 基线时点,显式                          |
| `proj_mode`                     | `forecast.mode`             | `delta`/`factor`/`absolute`(语义保留)                         |
| `bear/base/bull`                | `forecast.{bear,base,bull}` | 归到 forecast 下,一看即知是"推测量"非绝对值                   |
| —(隐含在 verify)                | `forecast.horizon`          | ★新增:预测兑现时点("一段时间"),终验时机                       |
| `logic_anchor`                  | `logic`                     | 命门挂的逻辑(去掉与"锚"撞名的 anchor)                         |
| `falsify`                       | `falsify_if`                | 证伪**条件**,读作 "falsify if …"                              |
| `sensitivity`(已废)             | —(删)                       | 命门 ⟺ 有 `logic`                                             |
| `verify[]`                      | `verify[]`(保留)            | **先行**指标对账;终验由 `anchor.fact + forecast.horizon` 隐含 |
| `key/label/unit/market_implied` | 不变                        |                                                               |

```ts
interface PredictionAnchor {
  fact: string // 锚定哪条事实(facts key)
  as_of?: string // 基线时点(delta/factor 必填;absolute 可省)
}
interface Forecast {
  mode: 'delta' | 'factor' | 'absolute' // 锚+量 / 锚×倍数 / 直接设定
  bear: number
  base: number
  bull: number // 三档推测量
  horizon?: string // 预测兑现时点(如 '2026-annual')
}
interface ValuationAssumption {
  key: string
  label: string
  unit?: string | null
  anchor?: PredictionAnchor // 命门必有;纯常量支撑可省
  forecast: Forecast
  logic?: string // 命门 ⟺ 有 logic
  falsify_if?: string // 命门:证伪条件
  verify?: VerifyHook[] // 先行指标对账
  market_implied?: string
}
```

### 4.2 `AssumptionCheck`(复盘对账 · before → after)

| 现字段                          | 新字段            | 说明                                      |
| ------------------------------- | ----------------- | ----------------------------------------- |
| `assumption`                    | `metric`          | 对账哪个指标(ref `key`)                   |
| `predicted`                     | `predicted_value` | 锚基线 + 推测 = 绝对预测值(系统算定·冻结) |
| `actual`                        | `actual_value`    | 到期实际                                  |
| `actual_fact`                   | `actual_as_of`    | 实际取自哪个时点                          |
| `deviation/outcome/attribution` | 不变              |                                           |

---

## 5. 落库与计算(不变量)

- **`add_thesis`**:引擎按 `resolveForecast(…, 'now')` 算 `V` 并冻结(承接 P1c)。`anchor.as_of` 必须命中 `facts[anchor.fact]` 已有观测(校验)。
- **`add_checkpoint`**:系统**算定** `checks[].predicted_value = resolveForecast(被检参数, facts, 'baseline')`,冻进 timeline——**不让 agent 填**(承接"价值 compute 算"不变量)。`actual_value` 取 `facts[anchor.fact]` 到期最新。
- **V_now**:始终 `resolveForecast(…, 'now')` 活算 → 事实更新自动回流。
- **不变量**:对照复盘的预测靶 = **基线锚**(立论时点·不漂);现值 = **最新锚**(回流)。两者同 forecast、异锚。

---

## 6. 实施分期 + 迁移

**P1 改名重构(行为不变,纯结构)** — 一次性扫过:
`shared/types/invest.ts`(类型)→ `shared/invest/valuation-trace.ts`(resolver 读 anchor/forecast)→ `renderer/summarizeHealth.ts` + `stockCardUI.tsx`(访问路径 a.forecast.base 等)→ `main/invest/store.ts`(校验读 anchor.fact / logic)→ `main/invest/tools/card-tools.ts`(zod)→ `scripts/seed-sample-card.mjs` → `main/invest/agents.ts`(prompt)→ 全部测试 fixture(flat → nested)。

**P2 补对照复盘(新行为)**:
`resolveForecast(a, facts, when)` 双模式 → `add_checkpoint` 算定冻结 `predicted_value` → 触发/不触发两测。

**迁移**:seed + 所有 fixture 从 flat 改 nested(工作量主要在此);两段分别提交。

**验收**:`typecheck` 0 新错;invest 全测试绿;UI 决策面"估"= 下钻未来值 = 复盘 predicted_value 三处口径一致。

---

## 7. 待定 / 风险

- `forecast.mode` 命名:保留 `delta/factor/absolute`(财务习惯)vs 改 `add/mul/set`(更直白)。**暂定保留**。
- `forecast.horizon` 显式新增 vs 复用 `verify` 终验 `at`。**暂定显式**(你强调的"一段时间"应一等公民)。
- 全量 fixture 迁移面广(seed + store.test + card-tools.test + flow.e2e + cross-industry + 渲染端),P1 提交会较大;按文件分批落、每批跑测。
