# A股投资 Agent — 完整方案(价值传导 · 卡片结构 · 决策系统)

> 本文 = 在 [`README.md`](./README.md)(终稿理念/三样)基础上,把**价值传导链严谨化 + 决策系统补全**收敛成单一实施方案。
> UI 细节见 [`ui-redesign.md`](./ui-redesign.md)。实施后回填 README §4/§5/§8/§10。日期:2026-06-23。

---

## 0. 理念与目标(原始需求 · 不可偏离)

为**结构弱势的散户**建**在 A 股生存的投资体系** = **投资纪律外骨骼**,信条 **盯逻辑而非价格**。卫星仓,**复盘跑赢宽基才算赢**。设计天平:**约束结果不变量,不约束过程路径**。

衡量本方案的唯一标准:它能不能在"逻辑会错、价格会骗、人会合理化"的现实里,**用代码强制的纪律帮散户活下来并跑赢宽基**。

---

## 1. 系统总览(因果)

```
事实变化(快变) ─┬─重估─────────────────────────┐
                └─验证→复查→归因→逻辑变化(慢变)─┐│
                                                ▼▼
                          逻辑+事实 → 预测参数 → 估值V → 安全边际(←现价)
                                                              │
                          决策 = 逻辑成立性(布尔闸) ⊗ 安全边际(连续尺) ⊗ gate(系统否决)
                                                              │
                                            复盘(跑赢宽基?)→ 教训 → 下一轮
        └──────────────── 时间线:验证/矫正回路(串起全程)────────────────┘
```

- **事实变化、逻辑变化都不直接驱动决策**,都汇于"估值→安全边际"这唯一出口。
- **验证双向、逻辑粘性**:事实对账逻辑可能 **强化**(兑现/超预期→确信度↑)也可能 **证伪**;只有校准/证伪才出新版,强化/持有不换版——逻辑不随每次复查跳变(事实快变·逻辑慢变)。
- **决策三判据**:① 逻辑还成立吗(布尔硬闸,先决)② 安全边际够不够(连续,定动作)③ gate 系统风险(否决);仓位的"度"由确信度(强化累积)+ 边际深度定。

---

## 2. 价值传导链(严谨五级)

| 级           | 是什么                     | 来源                          | 落点                                      |
| ------------ | -------------------------- | ----------------------------- | ----------------------------------------- |
| 逻辑(命门)   | 论点 + 关键敏感变量        | 主观                          | `claim` + `assumptions[sensitivity=high]` |
| **预测参数** | 估值根假设(命门+支撑·三档) | **逻辑 + 当前事实 推测**      | `valuation.assumptions[]` ★第一类         |
| 估值 V       | 价值区间                   | **预测参数 → compute 恒等式** | `valuation.V`(compute 算)                 |
| 安全边际     | 现价相对估值的偏差         | 现价 vs V + 门槛              | `value_now.margin_of_safety`              |
| 决策         | 买/等/弃 + 仓位            | 成立性 + 边际 + gate          | timeline 决策                             |

**配模式 → 预测参数集**:pe(增速/份额/净利率/PE中枢)· dcf(FCF/g/r/永续g)· pb-roe(正常化ROE/BVPS/g/r)· ddm(分红/分红g/r)· nav(分部/资源价/折价)。

---

## 3. 卡片结构(完整)★核心

### 3.1 三样总览

```
Card = ① 事实 facts      客观·按 key 序列·三维·只增不改        (真相序列)
       ② 逻辑 thesis     主观·冻结快照·版本化(含估值预测参数)  (命门 + assumptions)
       ③ 时间线 timeline  复查(验证+重立)/决策/复盘            (验证·矫正回路)
```

### 3.2 ① 事实 facts(真相序列 · 不变)

```ts
Fact = { level, label, unit?, role(先行/同步/滞后/排雷), series: FactObservation[] }  // append-only
FactObservation = { value, as_of, source(白名单), tier?, change?(三维-变化), structure?(三维-结构) }
```

事实是**预测参数的立足点(from_fact)与验证标的(verify.fact)**——价值链地基。

### 3.3 ② 逻辑 thesis(升级:估值预测参数第一类)

```ts
ThesisSnapshot = { v, at, scope(建立/校准/重写), claim, profit_type,
                   valuation: Valuation, ref_checkpoint? }   // drivers 并入 assumptions;claim = 大白话单句

Valuation = { method, method_reason?, assumptions: ValuationAssumption[], V: VRange, margin_of_safety }

// ★ 估值预测参数(吸收原 Driver):每参数双向挂事实
ValuationAssumption = {
  key, label, unit?,
  bear, base, bull,             // 三档预测(逻辑+当前事实推出)
  from_fact?,                   // ← 立足:facts key@as_of(派生基线)
  verify?: VerifyHook[],        // → 验证:facts key + at + 先行/终验
  sensitivity?,                 // high = 命门
  logic_anchor?, falsify?, market_implied?,   // 命门才带(预期差 = base vs market_implied)
}
```

- **`drivers` 合并进 `assumptions`**:命门 = `sensitivity:high` 那几条(带 logic_anchor/falsify);单一真相,不两处存 projected。
- 支撑参数(净利率/PE中枢)只带 projected + from_fact + verify。

### 3.4 ③ 时间线 timeline(升级:复查 = 验证 + 重立)

```ts
Checkpoint = { type:'复查', at, against_v,        // 锚出身版本(不回溯)
  validity: '强化'|'持有'|'校准'|'证伪',           // ★ 验证产物(双向):强化/持有不换版,校准/证伪才出新版
  conviction?: 'high'|'mid'|'low',                 // ★ 确信度(强化累积↑/偏离↓)→ 喂仓位
  checks: AssumptionCheck[],                       // 逐参数对账
  value_now: ValueNow,                             // 重估 V_now + 安全边际(含 buy_trigger)
  gate, spawned_v, signal }                        // validity 即动作:强化/持有=不换版;校准/证伪=spawned_v 非空

AssumptionCheck = {
  assumption,                   // ref valuation.assumptions[].key
  predicted,                    // ★ 取自 against_v 版该参数 base(验证用·不回溯)
  actual, actual_fact?,         // 取自 facts[verify.fact] 最新(同一事实)
  deviation?{数值,结构,变化},
  outcome: '超预期'|'兑现'|'容差'|'偏离'|'破',     // ★ 双向(含容差判定):超预期/兑现/容差=未破、偏离=校准、破=证伪
  attribution?{cause, type(噪声/外生/参数错/机制错)} }  // 偏离/破 才需归因

DecisionEvent = { type:'决策', at, trade, price?, weight?, based_v?, reason, override? }  // weight 由 compute 出(§6)
ReviewEvent   = { type:'复盘', at, vs_benchmark{satellite,index,verdict}, lesson?, ref_v? }
```

### 3.5 事实 ↔ 预测参数 的双向关系(核心)

```
facts[key].series ──立足 from_fact──→ assumption   "参数 = 逻辑 + 当前事实 推出"
facts[key].series ←─验证 verify.fact── assumption   "预测由 未来实际事实 对账"
```

- 命门(高敏)是验证主力(先行快验 + 终验);支撑参数容差宽。
- 复查对账 = 取 `facts[verify.fact]` 最新实际 vs `against_v` 版 `predicted` → 偏差 + 归因。

### 3.6 完整 JSON(比亚迪 · pe · 新结构)

```jsonc
"thesis": { "current": 2, "versions": [{
  "v":2,"at":"2026-07-31","scope":"校准",
  "claim":"政策让电车多卖,比亚迪成本低抢份额→赚钱",
  "profit_type":"成长",
  "valuation":{
    "method":"pe",
    "assumptions":[
      {"key":"ev_pen","label":"渗透率","unit":"%","bear":45,"base":50,"bull":55,
       "from_fact":"ev_pen@2025-12","verify":[{"fact":"ev_pen","at":"annual","role":"终验"}],
       "sensitivity":"high","logic_anchor":"政策驱动消费","falsify":"年报<45%"},
      {"key":"co_share","label":"份额","unit":"%","bear":13.5,"base":14.5,"bull":16,
       "from_fact":"co_share@2026-07","verify":[{"fact":"monthly_sales","at":"monthly","role":"先行"},{"fact":"co_share","at":"quarterly","role":"终验"}],
       "sensitivity":"high","logic_anchor":"成本护城河","falsify":"连2季<13%"},
      {"key":"net_margin","label":"净利率","unit":"%","bear":8,"base":9,"bull":10,"from_fact":"net_margin@2026-06","verify":[{"fact":"net_margin","at":"quarterly"}]},
      {"key":"pe_central","label":"PE中枢","unit":"x","bear":18,"base":22,"bull":26,"from_fact":"行业估值分位@2026-06"}
    ],
    "V":{"bear":205,"base":280,"bull":360},
    "margin_of_safety":{"required":0.25,"anchor":"base","required_basis":"区间宽+命门high未验+成长→25%"}
  },
  "ref_checkpoint":"cp-0731"
}]}
```

---

## 4. 决策因果(事实变化/逻辑变化 → 决策)

- **事实变化(快变)两路径**:① 重估(实际直灌 → 重算 V_now → 安全边际位置变,逻辑可不动,最常见)② 验证(复查 → 归因 → 噪声/外生不动 · 参数错校准 · 机制错证伪)。
- **逻辑变化(慢变)**:只在参数错/机制错/结构性新信息时 → 改 assumptions → compute 重算 V。
- **合成(判据有序)**:
  1. **逻辑成立吗?**(validity)— 证伪/破 → 弃/清,**价格无关**(价值陷阱硬闸,见不变量⑧)。
  2. 成立 → **安全边际够吗?** → 到买点 = 候选买;不足 = 等回调。
  3. **gate 系统风险** → 否决/节流叠加。
  4. → 决策 + **仓位的度**(§6)。

---

## 5. 时间线机制(验证 / 矫正 · 事实双用)★

**复查铰链:同一批最新事实,一鱼两吃。**

```
最新事实 F
  ├─① 验证(回看·双向):F vs 出身版 against_v 旧预测 → 准不准(deviation)→ validity
  │      ├ 兑现/超预期 → 强化(逻辑更可信·确信度↑)   ┐
  │      ├ 容差/噪声/外生 → 持有(无信息)            ├ 版本不变(强化/持有)← 多数复查在此
  │      ├ 参数错 → 校准                            ┐
  │      └ 机制错 → 证伪(逻辑破/退出)               ├ 出新版(校准/证伪)
  └─② 重立(向前·仅校准/证伪触发):F 作新版 from_fact 立足 → 重新预测参数 → computeValuation → 新 V → 重出安全边际
```

- **验证是双向的**:不只"偏离→改",还有"兑现/超预期→强化"。**强化/持有不换版,只有校准/证伪才出新版** → 逻辑不一定马上转新逻辑(粘性)。
- **逻辑慢变 = 验证连续累积、版本离散跳**:强化建信心、偏离蚀信心;只在阈值(参数错/机制错/命门连偏 N 次)才离散跳版。挡噪声、防过度交易。
- **同一事实双角色不混**:对旧版是"验证标的"(`predicted ← against_v`,不回溯);对新版是"立足基线"(`from_fact ← 最新`)。不同字段、不同时点引用。
- **强化 → 确信度↑ → 喂仓位**(§6):命门越验越敢加(仍须过安全边际)。
- **意义**:把一次性判断变成持续被现实检验、被迫诚实迭代的纪律发条(对账面 / 防自欺 / 校准引擎 / 问责记忆)。

---

## 6. 决策的"度"(仓位)★ 新补 #2

仓位不靠手感,由 compute 出:

```
computePosition({ margin_depth, conviction, risk_budget, uncertainty }) → weight
  margin_depth  现价低于 V_bear 越深 → 仓位↑
  conviction    命门已验证程度(复查连续强化累积↑ / 偏离蚀↓)→ 越验越敢↑
  risk_budget   单股最大亏损 × 组合风险预算 → 上限
  uncertainty   V 区间越宽/命门未验 → 仓位↓
```

散户生存第一律:**不重仓单股**;买"多少"比买"不买"更要命。

---

## 7. 不变量(代码守底 · 更新)

① 命门必挂逻辑(logic_anchor)+ 立足(from_fact)
② 事实必带来源(白名单)+ 时点·只增不改;关键 key 结构+周转
③ **V 由 compute 从 assumptions 算,不手填**
④ 复查锚出身版本(against_v)不回溯;验证双向(强化/持有不换版,仅校准/证伪出新版);命门连偏 N 次强制证伪,连续兑现 → 确信度↑
⑤ 决策过 gate(系统风险)
⑥ 建/加仓过安全边际(at_buy_point)
⑦ **★ 估值参数必挂事实**:每 assumption 须 from_fact;命门须 verify(指向白名单事实);复查逐参数对账 `facts[verify.fact]`
⑧ **★ 逻辑成立性硬闸(防价值陷阱)**:`validity=证伪` → 禁建/加(仅减/清),无论价格多便宜
⑨ **★ 决策时效闸**:建/加须基于"已对账最新事实"的新鲜复查(最近复查 at ≥ 最新 relevant 事实 as_of)

---

## 8. UI(案卷)· 优化版

同一条价值链,两个高度:**决策面 = 结论投影(散户)**;**三下钻 = 推导展开(专业)**。去重铁律:每件事只在一处主述(见 §8.6)。

**下钻顺序:逻辑·估值 → 事实 → 时间线**(结论 → 推导 → 地基 → 验证史)。逻辑·估值紧贴决策面("这结论怎么推的"),事实是更底层的地基。

### 8.1 顶条

代码/名 · verdict · gate · 逻辑健康 · `v{n}·scope` · **好生意 grade · 护城河 type·久期**(good_business)· 卫星仓。

### 8.2 决策面(散户层 · 纯结论链)

`① 逻辑成立?`(validity + 命门双线 估vs实 + 红线)→ `② 估值`(V **旧→新** + 一句「X 校准·见下钻」桥)→ `③ 安全边际`(现价 vs 估值 + 是否到买点)→ `④ 决策`(买/等/弃 + 仓位;gate 叠加;非荐股)。**价格只在 ③**。

- 校准期:② 显 `V 旧→新`;持有期:② 显静态 V + "逻辑未动·未重算"(粘性,防看价改估值)。
- 决策面**不展开机制**——"为什么 V 变了"压成一句桥,详情下沉到 §8.3。

### 8.3 逻辑·估值 下钻(推导 + 重算合一)★ · 首个下钻(在事实之上)

**估值不是黑箱**:按配模式显**恒等式阶梯**(参数 → 中间量 → V),命门/支撑/常量分级(见 §9.2)。

- **恒等式与重算合一**:本期被事实改的参数及其下游步 **inline 显「旧→新」**,未变的上游步单值。一个阶梯 = 方法 + 参数 + 过程 + 重算,**不另设"重算条"**。
- 顶部一行标驱动事实:`本期校准 ← fact@as_of 实X · 参数错`。
- 参数行加微提示 `实X→重估base`(消歧:决策面①的"验证 actual" vs 此处的"参数 base")。
- 本块只显**当前版当前阶梯**;**版本史移交时间线**(§8.4 时光机),不在此重述 diff。

### 8.4 时间线 下钻(验证/矫正时光机)★

不是事件流水,是**逻辑的验证轨迹 + 价值轨迹**。五个用途:

1. **验证轨迹**:逻辑越验越稳(强化)还是动摇(校准/证伪)—— validity 序列。
2. **价值轨迹**:V 被现实一步步改到哪(如 289→262),每步由哪条事实驱动。
3. **确信度轨迹**:敢不敢加仓的依据(强化累积↑ / 偏离蚀↓)。
4. **决策问责**:每个决策押的哪版逻辑、押对没(based_v + 盈亏)。
5. **复盘**:卫星 vs 宽基,**跑输宽基=败**。

底座:每个复查节点**事实双用**(§5)—— 既验上期逻辑(`predicted ← against_v`)、又作下期 base(`from_fact ← 最新`)。

**呈现**:

- 顶部**轨迹条**:`逻辑 持有→校准 · 确信 中→中 · V 289→262↓ · 仓位 5%(v1)`——走势一眼看完。
- 逐节点(逆序,最新在上):
  - **复查** = `锚vN · 新事实(命门)· 验证 outcome + 归因 · 确信Δ · 重算 V 旧→新 · 当下 verdict`;校准/证伪标"出 v{n+1}"台阶。
  - **决策** = `trade @price · 仓位 · 基于 vN`。
  - **复盘** = `卫星 vs 宽基 · 跑赢/输 · 教训`。
  - **建立** = `v1 · 确信 · V · 大白话`。
- **版本史归此**(时光机切版本),逻辑·估值块(§8.3)不再单列版本演化。

### 8.5 折叠态嗅探(角标)

三下钻默认折叠,折叠头显**红点角标 + 一句嗅探**:`事实·存货恶化⚠` / `逻辑·命门连2季偏` / `时间线·刚校准v2`——不展开也知哪有料。

### 8.6 去重映射(每件事唯一主述)

| 信息                                      | 唯一主述                          |
| ----------------------------------------- | --------------------------------- |
| 逻辑**验证**(估vs实)                      | 决策面 ① + 时间线复查节点(历史轴) |
| **结论** V 旧→新                          | 决策面 ②(桥接「见下钻」)          |
| **参数更新 + 沿恒等式重算**(旧→新 inline) | 逻辑·估值 ladder(独一份)          |
| 版本时间线                                | 版本演化 / 时间线                 |

> 同一事实多角色(事实下钻=原始观测 · 决策面①=验证 actual · ladder=参数 base)分层不混,非冗余。

---

## 9. compute / 估值引擎 ★

价值由 compute 算(不变量③),前端只读。估值是**显式引擎**(方法+参数+恒等式过程),非黑箱字符串——把"compute 是真相"做到能逐步审计。

### 9.1 引擎与 trace

```ts
TraceStep = { out, expr, inputs: string[], bear: number, base: number, bull: number, unit?: string } // 一步中间量(三档)
computeValuation(method, assumptions) → { V: VRange, trace: TraceStep[] }  // V = trace 末步(out==='V')
```

- `assumptions` = 该 method 的**全部叶子参数**(命门/支撑/常量,sensitivity 区分)。
- trace **computed 不存**(compute 是真相);V 存。**无新 schema 字段**。
- `inputs` 记每步用到的参数 key → 重算时定位"哪个参数变了 → 从哪步起重传"。
- UI 把 trace 渲染成恒等式阶梯(§8.3)。

### 9.2 配模式参数 + 恒等式(不同 method,参数不同)

| method     | 命门参数               | 支撑 / 常量                  | 恒等式(参数 → V)                                                                |
| ---------- | ---------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| **pe**     | 渗透率·份额            | 容量·单价·净利率·股本·PE中枢 | 渗透率×容量→行业销量 ×份额→公司销量 ×单价→营收 ×净利率→净利 ÷股本→EPS ×PE→**V** |
| **dcf**    | FCF基数·增长g·折现wacc | 高速期n·永续g∞·净负债·股本   | Σ FCFₜ/(1+wacc)ᵗ + 终值PV − 净负债 ÷股本→**V**                                  |
| **pb-roe** | 正常化ROE              | BVPS·可持续g·股权成本COE     | 合理PB=(ROE−g)/(COE−g) ×BVPS→**V**                                              |
| **ddm**    | 基期股利·折现COE       | 股利增长g                    | DPS×(1+g)/(COE−g)→**V**                                                         |
| **nav**    | 各分部价值             | 净负债·股本                  | Σ分部 − 净负债 ÷股本→**V**                                                      |

- validator:method → 必备参数键校验(`VALUATION_MISSING_PARAM`),缺参数拒落库(扩 README §5 配模式必备 key)。

### 9.3 事实→参数→重算价值(跨 method 通用,一套机制)

```
新事实观测 → 命中某命门 param 的 verify.fact → 复查对账(facts[verify.fact] 实际 vs 出身版 predicted)
  → outcome 偏离/破 → 归因 参数错/机制错 → 校准:param.base 更新(spawn 新版·同 method)
  → computeValuation(method, 新 assumptions) → 新 trace + 新 V
  → diff(旧trace, 新trace):从"被改 param 的 inputs 所在步"起,逐步 旧→新
```

- **机制不挑 method**:pe 改份额、dcf 改 wacc、pb-roe 改正常化ROE、ddm 改股利——都是"换被事实改的参数 → 重跑该 method 的 computeValuation → diff trace"。
- 强化/持有(未打到命门)→ 不换参数、不重算,V 沿用(粘性,防看价改估值)。

### 9.4 其他 compute(已实现)

- `buyTriggerPrice({bear,base,required,anchor})` → 买点价。
- `computePosition(...)` → 仓位(§6)。
- 复查对账 helper:逐 assumption 取实际事实 vs against_v 预测 → outcome + 偏差。

### 9.5 本期实施范围(估值引擎 + UI 优化)

**五配模式恒等式全实现**(pe 自上而下 / dcf 终值法 / pb-roe 合理PB / ddm 戈登 / nav 分部)+ 引擎框架(`TraceStep` / method 分派 / UI ladder);`computeValuationTrace` 按 method 分派,缺参数或经济无意义(r≤g)→ ok:false 回退显存量 V。**仍待**:store `VALUATION_MISSING_PARAM` 配模式必备参数硬校验(需先与 cross-industry 行业命门 fixture 调和)。

| 改动                                                                                                                                       | 文件                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `computeValuationTrace` + 5-method 恒等式 + `TraceStep` 类型 + 测试 ✓                                                                      | `shared/invest/valuation-trace.ts` |
| method → 必备参数键校验 `VALUATION_MISSING_PARAM`(待:先与 cross-industry 行业命门 fixture 调和)                                            | `store.ts` validator               |
| `valuationTrace(snap)` 跑引擎出 trace;`recompute(bundle)` diff 当前版 vs 上一版;`timelineTrajectory(bundle)`(validity序列/确信/V轨迹/仓位) | `summarizeHealth.ts`               |
| 决策面瘦身(V旧→新+桥)+ ladder 恒等式与重算合一 + **下钻重排(逻辑估值→事实→时间线)** + **时间线深化(轨迹条+节点+版本史归此)** + 折叠角标    | `stockCardUI.tsx`                  |
| pe 全参数集                                                                                                                                | `seed` + 测试                      |
| 本节 §8/§9 + README §5/§9 + fact-keys 配模式必备 key                                                                                       | docs                               |

---

## 10. 实施范围 & 顺序

| 步  | 改动                                                                                                                                      | 文件                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | 类型:`ValuationAssumption`+`Valuation.assumptions`;drivers 并入;`AssumptionCheck`;`Checkpoint.validity`;`DecisionEvent.weight` 由 compute | `shared/types/invest.ts`                        |
| 2   | compute:`computeValuation(assumptions)`、`computePosition`、复查对账 helper                                                               | `main/invest/compute/`                          |
| 3   | store 校验:命门需 logic_anchor+verify、每参数 from_fact;V 由 compute;**不变量⑦⑧⑨**(参数挂事实 / 证伪禁建加 / 决策需新鲜复查)              | `main/invest/store.ts`                          |
| 4   | UI:决策面链条 + 传导视图(assumptions 表)+ 时间线逐参数对账 + 折叠嗅探                                                                     | `renderer/invest/{summarizeHealth,stockCardUI}` |
| 5   | agents prompt:add_thesis 写 valuation.assumptions(各挂 from_fact/verify);复查填 validity;决策标 based_v/weight                            | `main/invest/agents.ts`                         |
| 6   | seed + 组件/store/跨行业测试 改 assumptions/validity 结构                                                                                 | `scripts/seed-sample-card.mjs` + `*.test.ts(x)` |
| 7   | 回填 README §4/§5/§8                                                                                                                      | `docs/investment-agent/README.md`               |

顺序:类型 → compute → store(不变量)→ UI → agents/seed/测试 → README。

---

## 11. 推迟下一期(明确不进本期)

- **组合层(#3)**:卫星仓总占比、核心仓宽基兜底、跨卡相关性、总仓位由 gate(美林时钟)定。"跑赢宽基"的真正落点是组合,本期先把单卡纪律做严谨,组合层单列。

## 12. 不做(YAGNI)

- 不引图表库(纯 SVG);不做严格按时长比例的时间轴;不动事实/时间线持久化列形态(thesis JSON 内结构升级,无迁移);gate 保持叠加否决项,不升为价值链节点。

---

## 一句话收口

> Card = 事实(真相序列)+ 逻辑(命门 + 估值预测参数 assumptions·每参数双向挂事实)+ 时间线(复查 = 验证旧逻辑成立性 + 重立新逻辑基线)。价值传导 `事实→逻辑→预测参数→compute→V→安全边际→决策` 每级钉在真实事实上、可逐参数审计;决策 = 逻辑成立性(硬闸·防价值陷阱)× 安全边际(定动作与仓位)× gate;时间线是这条链持续验证/矫正的发条。内核严谨、呈现朴素、九不变量代码守底。
