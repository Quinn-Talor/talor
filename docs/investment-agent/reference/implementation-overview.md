# 投研(invest)Feature — 当前实现方案(as-built)

> 状态：参考——反映 2026-06-28 的代码结构，迁移到现行规格时对照（[`../spec.md`](../spec.md) §20）；文中链接的设计文档均已归档。

> 本文 = invest feature 的**实现现状参考**(as-built,反映代码真实结构),区别于偏理念的设计文档
> ([`design-final.md`](../archive/design-final.md) / [`value-chain-rigor.md`](../archive/value-chain-rigor.md) / [`mvp-design.md`](../archive/mvp-design.md))。
> 字段/双锚/复盘细节见 [`prediction-verification-model.md`](../archive/prediction-verification-model.md)。日期:2026-06-28。

---

## 0. 定位

invest 是 Talor 的**第一个 Feature**(纯本地,平台无业务、业务由 Feature 插入)。为**结构弱势的散户卫星仓**建"盯逻辑而非价格"的标的卡 = **投资纪律外骨骼**。设计天平:**约束结果不变量,不约束过程路径**(机制代码强制,判断质量交给 agent)。

代码量 ~4500 行(不含测试),分 4 层:`shared`(类型+引擎)/ `main/invest`(store+工具+agent+compute)/ `renderer/invest`(案卷 UI)/ 经 `main/features` 框架插入平台。

---

## 1. 因果模型(四概念闭环)

```
事实 ─归纳→ 逻辑 ─量化(锚+推算)→ 预测 ─时间·新事实→ 验证 ─归因→ 逻辑(闭环)
```

**命门 = 一个估值参数对象 = 四面合体**:挂逻辑(`logic`)+ 锚在事实(`anchor`)+ 推出预测(`forecast`)+ 配验证(`verify`/`falsify_if`)。同一条事实有 4 角色:证据 / 基线锚 / 对照靶 / 现值基准。节奏:事实快变·只增不改;逻辑慢变·版本冻结;预测=配方冻结+绝对值看锚;验证=事件触发·逐次冻结。

---

## 2. 数据模型 —— `CardBundle`(`shared/types/invest.ts`)

一张卡 = 三大区 + 卡头 + 资格关:

| 区            | 字段                                                          | 时间结构                | 概念                        |
| ------------- | ------------------------------------------------------------- | ----------------------- | --------------------------- |
| `head`        | code/name/status/bucket                                       | —                       | 身份                        |
| `eligibility` | red_flags/in_circle/good_business                             | —                       | 入场前置闸(独立于四者)      |
| `facts`       | `key → {series:[{value,as_of,source,tier,change,structure}]}` | **series**(append-only) | ① 事实                      |
| `thesis`      | `{versions[], current}`                                       | **versions**(冻结快照)  | ② 逻辑 + ③ 预测 + ④验证计划 |
| `timeline`    | `(Checkpoint\|DecisionEvent\|ReviewEvent)[]`                  | **events**(按时间冻结)  | ④ 验证记录 + 决策 + 复盘    |

**命门参数 `ValuationAssumption`**(见名知义):
`key/label/unit` · `anchor{fact,as_of}`(锚) · `forecast{mode,bear/base/bull,horizon}`(预测) · `logic`(命门⟺有它) · `falsify_if`(证伪条件) · `verify[]`(先行对账) · `market_implied`。

**复盘对账 `AssumptionCheck`**:`metric` · `predicted_value`(系统算定) · `actual_value` · `actual_as_of` · `deviation/outcome/attribution`。

---

## 3. 估值引擎(`shared/invest/valuation-trace.ts`,纯函数·主/渲共用)

- **`resolveForecast(assumptions, facts, when)`** —— 双锚解析成绝对未来值:
  - `when='now'`:锚取最新观测 → V_now 活算回流。
  - `when='baseline'`:锚取 `anchor.as_of` 观测(append-only 不变)→ 复盘对照·冻结不漂。
  - `delta`=锚+量 / `factor`=锚×倍数 / `absolute`=直取;缺锚 → NaN(不臆造)。命门 `core=!!logic`。
- **`computeValuationTrace(method, traceAssumptions)`** —— 5 配模式恒等式逐步算 V,吐每步中间量:
  `pe`(渗透率×容量→销量→营收→净利→EPS→V)/ `dcf`(终值法)/ `pb-roe` / `ddm` / `nav`。
  **三档传导**:仅命门随档动撑区间,支撑固定 base(区间=命门赌错范围,不被全参数完美相关夸大)。
  缺参 / 经济无意义(r≤g)→ `ok:false`(UI 回退显存量 V)。
- **`anchorValue(facts, anchor, when)`** —— UI 取锚展示值。

---

## 4. 六不变量 + V-flow(代码强制,违反落库被拒)

| #   | 不变量                                   | 强制点                                                                                               |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ①   | 驱动挂逻辑(logic)+ 立足(anchor ref 事实) | `store.addThesisVersion`:ASSUMPTION_NO_ANCHOR / NO_CORE_ASSUMPTION                                   |
| ②   | 事实带白名单源 + as_of,只增不改          | `store.addFacts`:FACT_NO_SOURCE/UNTRUSTED/NO_ASOF                                                    |
| ③   | **价值由引擎算**(不手填)                 | `addThesisVersion` 参数齐则引擎 V 覆盖手填;`addCheckpoint` 算定 value_now.V + checks.predicted_value |
| ④   | 复查锚出身版本(against_v)不回溯          | `addCheckpoint`:CHECKPOINT_NO_VERSION                                                                |
| ⑤   | 决策过 gate                              | `addDecision`:GATE_VETOED/THROTTLED                                                                  |
| ⑥   | 建/加过安全边际(at_buy_point)            | `addDecision`:MARGIN_NOT_REACHED / LOGIC_FALSIFIED / STALE_CHECKPOINT                                |

**V-flow(评估风险①)**:当前版 V_now 活算回流;历史 V(版本/复查)创建时冻结、绝不回溯重算 → 时光机不漂移。
**对照复盘**:`addCheckpoint` 系统算定 `checks[].predicted_value = resolveForecast(against_v, facts, 'baseline')`,与 `actual_value`(到期最新)同量纲。
delta/factor 另校:ANCHOR_NO_ASOF / ANCHOR_ASOF_MISSING(基线时点须在场)。

---

## 5. 计算层 `compute/`(invest_lib 纯函数,co-located 测试)

~16 个纯函数(`compute/*.ts`),铁律:排雷/分位/趋势/周转/EPS测算/ROE/估值/行业6维/美林时钟/决策硬门**只能 compute 产出,agent 不手算**。其中 11 个薄包成 `compute_*` builtin 工具(见 §6),其余(`reverse-dcf` / `buy-trigger` / `cross-check` / `falsification` / `position` / `valuation-trace`)被 store/UI/其他 compute 内部调用。

---

## 6. 工具层 `tools/`(19 = 11 compute\_\* + 8 card)

**写卡(card,薄包 `CardRepo.apply`)**:`create_card` · `get_card` · `set_eligibility` · `add_facts` · `add_thesis` · `add_checkpoint` · `add_decision` · `add_review`。

**算(compute\_\*,薄包 invest_lib)**:`compute_red_flags` · `compute_percentile` · `compute_trend` · `compute_turnover` · `compute_projection` · `compute_valuation` · `compute_dupont` · `compute_industry_score` · `compute_macro_clock` · `compute_gate` · `compute_decision`。

工具错误走 `ToolErrorEnvelope`;zod 校验输入;`create_card` 经 `rootSessionId` 把 origin 上溯根会话。

---

## 7. Store(`store.ts` · `CardRepo`,复用 db 单例)

- 表:`stock_cards`(卡头+eligibility+facts+thesis JSON)+ `card_timeline`(单表 snapshot/decision/review payload)。
- `apply(CardCmd)` 分派 8 写命令;`read(id)` 合成 `CardBundle`。
- 校验集中在 `addFacts`/`addThesisVersion`/`addCheckpoint`/`addDecision`(§4 错误码),`CardValidationError{code}` 结构化。
- 幂等:同 session 同 code 复用卡(`findOpenCardId` 去后缀归一)。

---

## 8. Agent 装配(`agents.ts` · 5 agent)

| agent                        | 角色                                         |
| ---------------------------- | -------------------------------------------- |
| `stock-research`(投研主理人) | 编排 + 建卡 + 决策建议;delegate 4 specialist |
| `stock-specialist`           | 标的财务/业务/估值事实采集                   |
| `industry-research`          | 行业景气 6 维/格局/空间                      |
| `macro-research`             | 宏观事实 + 美林时钟风向 regime               |
| `review-analyst`             | 独立复盘归因                                 |

每 agent 经 `feature.agents()` 注入**全部 19 工具**;主理人 prompt 含估值链(逻辑→锚→forecast→恒等式→V)、六不变量、源白名单、非荐股铁律。prompt 软引导,硬约束在代码(validator/path-guard/quote-verifier)。

---

## 9. UI(`renderer/invest/` · 案卷 ArtifactUI)

- `stockCardUI.tsx`:`Inline` chip + `Panel` 案卷 = **决策面五行**(①逻辑 claim → ②估值 V → ③安全边际 → ④决策 + 健康/gate)+ **三下钻**(事实/逻辑/时间线整合因果轴)。
- `summarizeHealth.ts`:纯函数派生(UI 只读不算价值)—— `dualLines`(估vs实)/ `safety` / `redLines` / `valuationTrace` / `recompute` / `timelineTrajectory`。
- rigor 只进下钻:命门审计显**锚→推算→未来**(断环标红);恒等式阶梯显**具体数值代入**(`中间量 op 参数 = 输出`);事实项显 `@as_of`;决策面"估"= 推算后未来值(与下钻/实同口径)。
- 读经平台通用 `artifact:read` IPC(写经工具)。

---

## 10. Feature 集成(`feature.ts` · `TalorFeatureMain`)

invest 只**声明**贡献,平台 `installFeatures`(`main/index.ts`)注册:

- `init({db})`:建卡表 + 构造 `CardRepo`(模块级 store)。
- `agents()`:声明 5 agent(各连 19 工具)→ 平台 `registerFeatureAgent`(内存态,origin=feature)。
- `artifacts()`:声明 `stock_card` 读口 → 平台通用 `artifact:read` 路由(案卷面板取数)。
- `mcpDeps()`:声明 Playwright(检索取数);缺失平台提示用户。
- 禁止依赖 ipc/mcp/electron(只声明,不碰平台内部)。

---

## 11. 测试(220 测 / 27 文件,全绿)

`valuation-trace.test`(引擎+双锚解析)· `store.test`(校验+V/predicted 冻结)· `card-tools.test`(zod+闭环)· `flow.e2e.test`(create→facts→thesis→checkpoint→decision)· `cross-industry.test`(5 配模式跨行业)· `summarizeHealth.test` + `stockCardUI.test`(渲染端·happy-dom,真 bundle stub)· `feature.test`(注册)。每条规则"触发+不触发"两测。

---

## 12. 现状边界(刻意未做 = 约束结果不约束路径)

- 阶段性验证的**中间 waypoint 期望值**未建模:复查只对 horizon 终目标,"在途/偏轨"靠 agent 判 outcome。
- `conviction` agent 每轮设,非从 outcome 序列自动累积。
- KnowledgeBase(RAG)/ LongTermMemory 平台侧返回空。

## 13. 文档导航

| 文档                                                                                          | 性质                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 本文                                                                                          | as-built 实现现状                                       |
| [`prediction-verification-model.md`](../archive/prediction-verification-model.md)             | 字段模型 / 双锚 / 四概念关系(最新)                      |
| [`value-chain-rigor.md`](../archive/value-chain-rigor.md)                                     | 价值链 + 决策系统设计(部分早于字段重构,以本文/上文为准) |
| [`design-final.md`](../archive/design-final.md) / [`mvp-design.md`](../archive/mvp-design.md) | 理念 / MVP 设计                                         |
| [`fact-keys.md`](./fact-keys.md)                                                              | 事实 key 字典                                           |
