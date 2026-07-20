# 投研 Agent 体系重构 + 闭环 MVP —— 完整方案(定稿·待评审)

> 状态:定稿待评审 · 日期:2026-07-20 · 分支:feature/investment-agent
> 上游依据:`docs/investment-agent/README.md`(设计终稿)、`value-chain-rigor.md`、`prediction-verification-model.md`、`fact-keys.md`、`docs/superpowers/specs/2026-07-16-invest-agent-design.md`(定稿)、`implementation-overview.md`(as-built)
> 本方案定三件事:**① agent 体系怎么拆 ② 多 agent 怎么协作 ③ UI 怎么体现流程与协作**。范围 = MVP · 指令驱动 · 把流程做成闭环。§9 列全部已定决策。

---

## 0. 背景与目标

系统把**价值链**(事实 → 估值 V)用代码焊死(V 由 `computeValuationTrace` 从 assumptions×facts 算、伪造不了),但**逻辑链**(事实 → 证伪/验证 → 裁定)整条留给 agent 手搓,且流程是**线不是圈**:

- `addFacts` 纯 append、从不测逻辑;`falsify_if` 是自由文本、全程没代码读过。
- 复查裁定(outcome/validity/spawned_v)照抄 agent 输入,无一致性守卫。
- 复盘存不下自己的结论,`lesson → 下一轮建卡`**没有任何边** —— 循环闭不上。
- agent 结构只拆了"采数"(宏观/行业/标的),准确性最吃劲的判断(估值/证伪/决策)全压在主理人一个 context,且**全队协作、没有对手方**。

**目标**:指令驱动下,一张卡能被用户一句句指令推着走完 `建卡 → 取事实 → 梳理逻辑 → 更新事实 → 更新逻辑 → 决策 → 复盘`,且**每个判断都活过一轮独立证伪、复盘教训能回流下一轮、命门只立在可信事实上**。

---

## 1. 设计原则

1. **分工:代码给「眼睛 + 护栏 + 触发」,agent 给「脑子 + 判断」。** 不变量/确定性计算/写入闸门 = 代码焊死;选命门、设证伪条件、判校准/证伪、归因 = agent 自由(CLAUDE.md §4.5)。
2. **准确性 = 提案 → 独立挑战 → 裁决。** 不是把单个 agent 调更强,而是让它的结论**必须活过一轮反驳**。
3. **硬约束只焊承重点。** 空方必经、命门锚可信、校准/证伪必出版本 = 代码硬闸;其余取最省、最不脆的做法。
4. **目标驱动,不写死。** agent prompt 写目标 + 纪律 + 循环衔接,数据靠 `search_tool`/MCP 自发现,不钉死源/工具。
5. **MVP 指令驱动,不做系统主动。** 自动盯 add_facts、到期角标、逼近证伪、后台 push —— 一律 v2。
6. **最小拆分。** 每个 agent = 上下文交接损耗 + 延迟 + 成本;只加准确性关键角色。

---

## 2. Agent 体系(重点一)

### 2.1 编制总览:镜像一支投研团队(6 agent)

| agent                             | 认知模式 / 专业                           | 写卡权            | 上场时机                              |
| --------------------------------- | ----------------------------------------- | ----------------- | ------------------------------------- |
| **主理人 PM**(stock-research)     | 编排 · 裁决 · 决策纪律 · 落卡             | **全部写**        | 全程                                  |
| **宏观分析师**(macro-research)    | 美林时钟 / 流动性 / 政策 → 系统性 gate    | 无(fan-out)       | 建卡 · 复查(宏观维)                   |
| **行业分析师**(industry-research) | 6 维景气 / 竞争格局 / 产业链              | 无                | 建卡 · 复查(行业维)                   |
| **标的分析师**(stock-specialist)  | 财务排雷 / 杜邦 / **估值建模 · 命门草案** | 无                | 建卡 · 梳理逻辑 · 复查对账            |
| **空方 · 证伪官**(short-thesis)⭐ | 独立证伪:攻最弱命门 / 唱空 / 反"持有"惯性 | 无(**read-only**) | **每次立论前 & 每次复查裁定前(强制)** |
| **复盘官**(review-analyst)        | 兑现度 / 能力 vs 运气 / vs 宽基           | 仅 `add_review`   | 平仓后                                |

**相对现状(5 agent)的净变化只有两处**,其余保留受限盒子架构:

- **➕ 新增「空方 · 证伪官」** —— 准确性对手方。
- **🔁 建模下沉**:估值/命门从主理人挪进标的分析师 —— 专业性 + 去偏差(**建模者 ≠ 决策者**)。

### 2.2 每个 agent 详规(职责 / 分工边界 / 工作流程 / 方法 / 依赖工具)

工具名取自现有注册表(`compute-tools.ts` / `card-tools.ts` + MCP)。

#### 2.2.1 主理人 PM(stock-research)

- **职责**:接指令 → 判循环步 → 编排委托 → 汇总下属产出 → 过空方 → 裁决 → 落卡 → 把关决策纪律。**唯一持全部写卡权**(受限盒子的盒主)。
- **分工边界(不做)**:不亲自深挖某域事实、不亲自建估值模型、不做证伪挑战、不做复盘归因 —— 全部委托。它是裁决者,不是分析师。
- **工作流程(每条指令)**:①`get_card`/`get_timeline` 读态、判循环步 → ②(建卡/立论前)`get_prior_lessons(code)` 读上轮教训 → ③`delegate_agent` 委托相关下属,收结构化 fan-out → ④汇总草案(thesis/checkpoint/decision)→ ⑤(立论/复查裁定)委托空方 → 收 `ShortThesisChallenge` → 裁决(驳回留痕 / 改判)→ ⑥(决策)`compute_gate`+`buy_trigger`+`compute_decision`/`compute_position` 过双闸 → ⑦调写卡工具落盘(store 闸门 + 空方 gate 硬校验)。
- **方法**:九不变量纪律;双闸(gate → 安全边际 → 新鲜复查);强化/持有不换版、校准/证伪出新版。
- **依赖工具**:编排 `delegate_agent`;读 `get_card` `get_timeline` `get_prior_lessons`(新);**写(全权)** `create_card` `set_eligibility` `add_facts` `add_thesis` `add_checkpoint` `add_decision` `add_review`;决策计算 `compute_gate` `buy_trigger` `compute_decision` `compute_position`;辅助 `search_tool` + builtin `read/grep/glob`。

#### 2.2.2 宏观分析师(macro-research)

- **职责**:判宏观象限(美林时钟)→ 系统性风险 gate 输入 + 宏观事实(利率/流动性/政策/通胀)。
- **分工边界**:只管宏观层,不碰个股财务/估值;**零写卡**,fan-out 给 PM。
- **工作流程**:收委托 → `search_tool`+MCP 采宏观数据 → `compute_macro_clock` 定象限 → 给 `equity_stance`+`suggested_systemic` → 结构化返回。
- **方法**:美林时钟(增长×通胀四象限)、流动性/政策面。
- **依赖工具**:`search_tool`、MCP 宏观(`cn_gdp` `cn_cpi` `cn_ppi` `cn_m` `shibor` `us_tycr` 等)、`compute_macro_clock`。**无写卡**。

#### 2.2.3 行业分析师(industry-research)

- **职责**:6 维景气 + 竞争格局 + 产业链位置 → 行业事实 + 景气判断。
- **分工边界**:只管行业层;**零写卡**;fan-out。
- **工作流程**:收委托 → `search_tool`+MCP 采行业数据 → `compute_industry_score`(6 维)+ `compute_percentile`/`compute_trend`(景气位置/动能)→ 结构化返回。
- **方法**:6 维景气(需求/供给/价格库存/格局/政策/估值)、产业链上下游。
- **依赖工具**:`search_tool`、MCP 行业(`index_*` `ths_index/daily/member` `sw_daily` `concept*`)、`compute_industry_score` `compute_percentile` `compute_trend`。**无写卡**。

#### 2.2.4 标的分析师(stock-specialist)—— 采公司事实 + 建模

- **职责**:采公司事实(财报三表 + 先行指标)→ 排雷 → 杜邦 → EPS 测算 → **估值建模 + 命门草案**(assumptions 带 anchor/forecast/verify/falsify_if + valuation trace)。
- **分工边界**:只管标的层;**零写卡**(命门草案作为 fan-out 交 PM 落 `add_thesis`);不做决策、不做证伪裁决。
- **工作流程**:①`search_tool`+MCP 采公司事实(先行 key 优先)→ ②`compute_red_flags` 排雷 → ③`compute_dupont`+`compute_turnover` 拆 ROE → ④`compute_projection` 出 EPS 路径 → ⑤`compute_valuation` 四情景 V + `compute_percentile` 位置 + `reverse_dcf` 反推隐含增速 → ⑥组装命门草案 + trace → 结构化返回。
- **方法**:8 红灯排雷、杜邦、逆向 DCF、四情景估值、命门=高敏感参数。
- **依赖工具**:`search_tool`、MCP 公司(`stock_basic` `income` `balancesheet` `cashflow` `fina_indicator` `daily_basic` `forecast` `express` `dividend` 等)、`compute_red_flags` `compute_dupont` `compute_turnover` `compute_projection` `compute_valuation` `reverse_dcf` `compute_percentile` `compute_trend` `cross_check`。**无写卡**。

#### 2.2.5 空方 · 证伪官(short-thesis)⭐ 新增

- **职责**:对 PM 每份草案(立论/复查裁定)做**独立证伪**:找最弱命门、论证已破/预测过乐观、反"持有"惯性 → 产 `ShortThesisChallenge`。
- **分工边界**:纯 **read-only**,零写卡、不建设、无裁决权(裁决在 PM)。**独立性是价值**——不复用标的分析师中间结论,自己重算。**零写权靠架构**(`deniedWriteTools` 收窄,同 specialist),非靠 prompt 自觉。
- **工作流程**:①收委托(带草案)→ `get_card`/`get_timeline` 独立读全卡 → ②挑最弱命门:`reverse_dcf`(价格已隐含过高增速)/ `check_falsification`(某 verify.fact 越阈)/ `cross_check`(来源打架)/ `compute_percentile`(估值历史高位)→ ③`search_tool`+MCP 独立采反面证据 → ④产 `ShortThesisChallenge`。
- **方法**:逆向 DCF 隐含增速、证伪阈、来源交叉、历史分位、机制质疑(护城河真伪)。
- **依赖工具(只读)**:`get_card` `get_timeline` `search_tool`、MCP(只读)、`check_falsification` `reverse_dcf` `cross_check` `compute_percentile` `compute_trend` `compute_valuation`。**无任何 `add_*`/`create_card`/`set_*` 写权。**

#### 2.2.6 复盘官(review-analyst)

- **职责**:平仓后对过程不对结果:逐命门兑现度 + 能力/运气四象限 + vs 宽基。
- **分工边界**:只读历史 + **唯一写口 `add_review`**;不改事实/逻辑/决策;独立于 PM(避免自评)。
- **工作流程**:收委托 → `get_card`/`get_timeline` 读全程 → 逐命门比对 predicted(出身版)vs actual(已发生事实)→ 采宽基收益 → 四象限归因 → `add_review`(结构化)。
- **方法**:对过程不对结果、四象限(顺/逆逻辑 × 结果好/差 → 能力/运气)、跑赢宽基才算赢。
- **依赖工具**:`get_card` `get_timeline` `search_tool`、MCP(`index_daily` 宽基)、`compute_*`(重算兑现)、`add_review`(唯一写)。

### 2.3 空方 gate 协议(准确性引擎,硬校验)

**为什么**:数值已被 compute 焊死,LLM 的错集中在**判断层**(命门选得对不对、逻辑还成不成立)。空方专扎这层,把设计里可选的"唱空"升级成**结构性必经步骤**。

- **强制介入点**:`add_thesis`(建立/校准/重写)前;`add_checkpoint` 裁定前。
- **输出 schema**:
  ```ts
  ShortThesisChallenge {
    target: 'thesis' | 'checkpoint'
    weakest_assumption: string            // 指向某命门 key
    refutation: string                    // 证伪论据
    counter_evidence?: { fact: string; as_of: string }[]
    suggested_verdict: '证伪' | '校准' | '维持'
    severity: 'high' | 'mid' | 'low'
  }
  ```
- **裁决协议(propose → challenge → adjudicate)**:PM 必须对 challenge 二选一——**书面驳回**(理由留痕)或**改论/改判**。裁决连同 challenge 落卡。
- **硬校验(已定)**:`add_thesis`/`add_checkpoint` 携带 `challenge` 字段(空方输出 + PM 裁决);**store 无 `challenge` 拒写**。store 只校验"有没有咨询 + 有没有裁决",**不判 challenge 内容对错**(内容是判断)——既焊必经流程,又不脆、不夺判断。**仅对新写生效**,存量版本 grandfather。
- **升级(v1.1)**:大仓位/高确信,空方扩成 N 人 panel 取多数。

### 2.4 协作时序:一次"梳理逻辑"指令

```
用户指令「梳理逻辑、出估值」
  └─ PM 判定循环步 = 立论
     ├─ 委托 标的分析师:采公司事实 + 建模 → 命门草案(assumptions + trace)   [fan-out]
     ├─ 委托 行业/宏观分析师(按需):域内判断 + gate 输入                       [fan-out]
     ├─ PM 汇总成 thesis 草案(v1)
     ├─ 【强制】委托 空方:攻草案 → ShortThesisChallenge                        [challenge]
     ├─ PM 裁决:驳回(留痕) or 按 challenge 改命门/改预测                       [adjudicate]
     └─ PM 调 add_thesis(草案 + challenge + 裁决) → store 闸门校验 → 落卡        [write, gated]
```

交接全是结构化对象(命门草案 / `ShortThesisChallenge`),委托走 Talor `delegate_agent`,子会话产结构化摘要回 PM。

### 2.5 冷启动:从零(无卡)如何开工

**⚠ 当前 UI 缺口**:工作台 composer 绑定"已选卡的 origin_session"(`activeSession = selected?.origin_session_id`),**无卡时禁用 → 无法发起研究**。冷启动第一件事是补入口(§5.4)。

**PM 冷启动流程(先资格赛,后逻辑)**:

1. **标的解析**:`search_tool`/MCP `stock_basic` 把"比亚迪"解析成规范 `code`+`name`(主题词 → MVP 请用户确认到具体标的;选股发现流 v2)。
2. **查前世**:`get_prior_lessons(code)` —— 研究过就先读上轮教训(冷启动即接上回程边)。
3. **建卡壳**:`create_card` → 空卡 + 新 `origin_session`。
4. **资格赛(第一道闸)**:委托标的分析师 `compute_red_flags` 排雷 + 判能力圈/护城河 → `set_eligibility`。**不合格 → 明说"不建逻辑",卡停资格态**;合格才继续。
5. **取事实**:委托宏观/行业/标的分析师采数 → `add_facts`(先行优先)。
6. **立论(过空方)**:标的分析师建模出命门草案 → PM 汇总 → 空方挑战 → PM 裁决 → `add_thesis(v1 + challenge)`。

**冷启动铁律:先资格赛,后逻辑。** 不合格的票根本不进建逻辑 —— 先确保标的**值得盯**。

---

## 3. 系统能力(重点二)

### 3.1 能力四层 + 闭环增补

四层能力,agent 按指令自由组合,现状约 90% 具备:

| 层         | 能力                                                  | 状态                                                                  |
| ---------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| 取数       | `search_tool` + MCP(数值 cn-financial / 检索 browser) | ✅                                                                    |
| 计算       | 14 个 `compute_*`                                     | ✅                                                                    |
| 读卡       | `get_card` `get_timeline`                             | ✅;**➕ `get_prior_lessons(code)`**(跨同 code 历史卡取 lesson,回程边) |
| 写卡(闸门) | 7 个写工具                                            | ✅ + 下方增补                                                         |

**写卡层增补(闭环 + 空方 gate 落地)**:

1. **`add_review` 扩容**:`thesis_realized`(逐命门兑现/证伪)+ `attribution`(四象限)+ `ref_v`(**新写必填**)+ `ref_decisions[]`。新字段 optional、读侧降级,旧卡零迁移。
2. **`add_thesis`/`add_checkpoint` 增 `challenge` 字段**,store 无 challenge 拒写(§2.3)。
3. **store 两条薄守卫**:`validity∈{校准,证伪}` ⟹ 必有 `spawned_v`;`check.outcome=破` ⟹ `validity` 不得为持有/强化。

### 3.2 事实数据层:取数管线 + 准确性防线(几乎所有 agent 的地基)

命门的 `anchor`/`verify`/`falsify_if` 全指向事实——**事实错,估值/证伪/裁定全错**。

**取数管线(结构化优先,散文兜底)**

- **主路 = 结构化数值接口**:据 `fact-keys.md` 的 `metric_key ↔ 接口/字段` 映射,调 MCP 数值源(cn-financial / tushare / 东财公开 JSON),**数字直接取自 API 字段、不经 LLM 转述**(消除最大误差源:数字被读错/编造)。
- **辅路 = 权威公开页检索**:数值接口没有的(定性/结构/政策/格局)或需交叉验证的,用 browser MCP 检索白名单权威页(交易所/巨潮/统计局/券商研报)。
- **`search_tool` = 发现**"事实在哪",不产事实本身。
- **谁取**:域分析师各管其 metric 域,带源值 fan-out → PM `add_facts` 落卡。

**准确性防线(defense-in-depth,硬的在代码)**

| 层             | 机制                                                                           | MVP                   |
| -------------- | ------------------------------------------------------------------------------ | --------------------- |
| L0 结构化优先  | 数值取自 API 字段而非转述 prose                                                | ✅ 必做(纪律+MCP)     |
| L1 白名单+时点 | `addFacts` 拒非白名单源/无 as_of + 每值带 `tier`(T1-3)                         | ✅ 已有               |
| L2 交叉校验    | **命门锚/verify 事实硬校验** ≥2 独立源 `cross_check`;外围事实软引导;打架标存疑 | ✅ 必做(命门 facts)   |
| L3 口径/单位   | as_of+单位(已有);口径字段(TTM/年度/单季·合并/母公司)                           | 口径 → v1.1           |
| L4 可回溯      | source 升级结构化 provenance `{name,tier,ref,retrieved_at}`                    | → v1.1                |
| L5 对手方+对账 | 空方 `cross_check` 质疑;复查 predicted vs actual 用事实,错则对账暴露 → 自纠    | ✅(靠 §2/§4)          |
| L6 分级授权    | **命门锚:T1 直接可锚 / T2 需交叉校验 / T3 仅上下文**                           | ✅ 必做(store 不变量) |

**核心铁律(已定)**:**命门锚只能立在 T1、或已交叉校验的 T2 事实上;T3 仅作上下文,不得作命门锚。** 做成 `add_thesis` 写入不变量(不合格锚拒写),不靠 agent 自觉。最大风险是 LLM 读错/编造数字 —— **L0 结构化优先 + L6 tier 硬闸**联合根治。

> 明确**不做**(v2):`falsify_if` 结构化 + `surveilThesis` 自动证伪引擎 + 到期检测 + 后台 push。MVP 证伪由空方(判断)+ 复查对账(对账)承担。

---

## 4. 闭环流程(7 步 × agent × 能力 × 协作)

| 步         | 用户指令              | 主导 agent     | 协作                                    | 关键写入                                       |
| ---------- | --------------------- | -------------- | --------------------------------------- | ---------------------------------------------- |
| 0 建卡     | "建比亚迪的卡"        | PM             | 标的分析师排雷 → 资格赛                 | `create_card`+`set_eligibility`                |
| 1 取事实   | "拉最新财务+先行数据" | 域分析师 ×3    | fan-out → PM                            | `add_facts`(先行优先)                          |
| 2 梳理逻辑 | "梳理逻辑、出估值"    | 标的分析师建模 | **→ 空方挑战 → PM 裁决**                | `add_thesis(v1+challenge)`                     |
| 3 更新事实 | "更新到 Q3 财报"      | 域分析师       | fan-out → PM                            | `add_facts`(增量)                              |
| 4 更新逻辑 | "复查,逻辑还成不成立" | PM 对账        | **→ 空方挑战 → PM 裁决**;校准/证伪出 v2 | `add_checkpoint(+challenge)`(+`add_thesis` v2) |
| 5 决策     | "现在能建仓吗"        | PM             | 双闸(gate+安全边际+新鲜复查)            | `add_decision`                                 |
| 6 复盘     | "平仓了,复盘"         | 复盘官         | 读全程,独立归因                         | `add_review`(扩容)                             |
| ↩ 回程     | 下次建同只票          | PM             | `get_prior_lessons` 注入                | —(读)                                          |

**闭环判据**:第 6 步 `lesson/attribution` 落卡,且第 0/2 步 PM 经 `get_prior_lessons` 读到并引用 —— 线接成圈。

---

## 5. UI 设计(重点三:体现流程 + 体现协作)

沿用 **chromeless 三区**(池子 | 活论文 | 分析过程),chat 驱动。活论文=当前态,时间线时光机=全流程留痕(每动作一可回拨节点)。在此之上补:

### 5.1 体现「完整流程」

- **情境化循环 chips**:据卡当前态提示下一步能下什么指令(无逻辑→梳理逻辑;事实旧→取最新并复查;持仓→复盘)。
- **每卡「流程状态」标**:建立/持有/待复查/校准中/已平仓,从最新时间线节点派生,池子+活论文头部露出。
- **回程边可视**:建卡/梳理逻辑时,把 `get_prior_lessons` 的上轮教训顶在逻辑区上方。
- **复盘节点富渲染**:兑现度(逐命门)、能力/运气四象限、vs 宽基。

### 5.2 体现「多 agent 协作」

- **发言人标识**:委托的子 agent 以各自身份出现(标的/宏观/行业分析师、空方、复盘官),非统一"AI"。
- **红蓝对抗块 ⭐**:空方 challenge → PM 裁决,渲染成显式「证伪挑战 · 裁决」卡片(空方论据告警色,PM 采纳/驳回中性色 + 结论)。**让用户亲眼看到论点被压力测试**——相对"一个 AI 说了算"的核心信任差异点。
- **委托折叠**:fan-out 采析默认折叠成一行("已咨询 宏观/行业/标的 →"),点开看细节。
- **落卡回执**:每次写卡后活论文对应区(命门/时间线节点)高亮"刚更新"。

### 5.3 组件

- 复用:`MessageBubble` 分角色渲染、时光机 `reconstructCardAt`、传导链、安全边际 ladder。
- 新增:`ChallengeCard`(红蓝对抗)、`FlowStatusBadge`(流程状态)、`PriorLessonNote`(上轮教训)、`SpeakerAvatar`(发言人)、循环 chips 情境化逻辑。

### 5.4 无卡发起研究入口(闭冷启动缺口)

- **池子顶「+ 研究新标的」**:输入名/代码 → 起一个**无卡研究会话**(新建 session,不绑 selected)→ PM 走 §2.5 冷启动;流程第 3 步 `create_card` 后池子实时插入新卡并自动选中,对话接续到该卡会话。
- **改造点**:`ProcessPanel`/`InvestWorkspace` 解耦"能对话"与"已选卡"——`activeSession` 可来自新研究会话;`create_card` 落库后经 `tick` 刷新纳池+选中。
- **资格态呈现**:资格赛不通过的卡显示"未通过资格赛:{红灯/不在能力圈}",不渲染逻辑区。

---

## 6. 数据模型 / store 变更汇总(实施用)

**新增工具**:`get_prior_lessons(code) → { v, lesson, attribution, at }[]`(跨同 code 历史卡)。

**类型变更**(`src/shared/types/invest.ts`):

- `ThesisSnapshot` / `Checkpoint` 增 `challenge: { output: ShortThesisChallenge; adjudication: { verdict: 'accept'|'reject'|'revise'; note: string } }`。
- `ReviewEvent` 增 `thesis_realized: {assumption: string; outcome: '兑现'|'未兑现'|'证伪'}[]`、`attribution: {...}`、`ref_v: number`(新写必填)、`ref_decisions?: string[]`。
- `FactObservation`:MVP 保持 `source: string` + `tier` + `as_of`;v1.1 → `provenance {name,tier,ref?,retrieved_at}` + `basis?`。

**新增 store 不变量(error code)**:

- `THESIS_NO_CHALLENGE` / `CHECKPOINT_NO_CHALLENGE` —— 无 `challenge` 拒写。
- `CALIBRATE_NO_SPAWN` —— 校准/证伪无 `spawned_v`。
- `OUTCOME_VALIDITY_MISMATCH` —— outcome=破 但 validity 持有/强化。
- `ANCHOR_UNTRUSTED` —— 命门锚事实非 T1 且无交叉校验结果。

---

## 7. 落地顺序(三阶段,每阶段端到端可验)

**Phase 1 · 地基与闭环(store/tools 层,纯 TDD,无 UI)**
`get_prior_lessons` + `add_review` 扩容 + 两条薄守卫 + `challenge` 字段 + 命门锚 tier/交叉校验硬闸(`ANCHOR_UNTRUSTED`)+ 空方 gate 拒写。
→ 验证:单测覆盖每条新不变量"触发+不触发";命门不再能立在虚假事实或未过空方的逻辑上。

**Phase 2 · agent 行为**
注册**空方**(只读收窄,`deniedWriteTools`)+ 改 **PM prompt**(空方 gate + 循环衔接 + 冷启动流程)+ **建模下沉**标的分析师 prompt。
→ 验证:指令驱动跑通冷启动 → 立论(过空方)→ 复查(过空方)→ 决策 → 复盘 全链;空方 challenge + PM 裁决落卡。

**Phase 3 · UI**
无卡入口(解冷启动)+ 红蓝对抗块 + 分角色发言 + 流程状态 + 回程可视 + 资格态。
→ 验证:工作台内从"+ 研究新标的"零卡起步走完全流程;面板出现红蓝对抗 + 分角色;每卡显示流程状态。

顺序逻辑:**数据/不变量先(可测)→ agent 行为(依赖前者)→ UI(呈现)**。

---

## 8. 验收(MVP)

0. **冷启动**:无卡时可从「+ 研究新标的」发起;PM 先跑资格赛,不合格卡停资格态、不建逻辑;合格则自动建卡+选中继续立论。
1. 一张卡可被指令驱动走完 0→6 全流程,时光机逐节点可重建。
2. `add_thesis`/`add_checkpoint` 无 `challenge` 被 store 拒写(空方 gate 硬生效)。
3. 校准/证伪必带 `spawned_v`;outcome=破 与 validity 一致(薄守卫生效)。
4. 复盘写入 `thesis_realized/attribution/ref_v`;下次建同 code 卡时 PM 上下文出现上轮 lesson。
5. 分析过程面板出现分角色发言 + ≥1 个"证伪挑战·裁决"红蓝对抗块;每卡显示流程状态。
6. **事实准确性**:命门锚/verify 事实非 T1 且无交叉校验时 `add_thesis` 被拒写(`ANCHOR_UNTRUSTED`);数值事实可追溯 source+tier+as_of;来源打架的值标 `⟨unverifiable⟩` 且不得作命门锚。

---

## 9. 已定决策(评审确认)

| #   | 议题              | 决策                                                   | 理由                                                |
| --- | ----------------- | ------------------------------------------------------ | --------------------------------------------------- |
| 1   | 空方 gate         | **硬校验**(无 challenge 拒写,只查"咨询+裁决",不判内容) | 软的必被跳过;硬校验焊必经流程、不夺判断、不脆(§4.5) |
| 2   | 建模归属          | **并入标的分析师**                                     | 共享公司事实、少一次交接;建模者≠决策者靠 ≠PM 已达成 |
| 3   | `add_review` 兼容 | 新字段 optional + 读侧降级;`ref_v` 必填只对新写        | append-only,旧卡天然有效,零迁移                     |
| 4   | 空方工具          | 复用只读子集,零写权靠 `deniedWriteTools` 架构          | 收窄机制已存在,不建新基建                           |
| 5   | 交叉校验强度      | 命门锚/verify **硬校验**,外围软引导                    | 只在承重处焊死                                      |
| 6   | T2 作锚           | **T1 直接 / T2 需交叉校验 / T3 仅上下文**              | 分级信任,务实又有闸                                 |
| 7   | provenance/口径   | MVP 只 tier+as_of;结构化 provenance + 口径 → v1.1      | 准确性地板进 MVP,审计富化延后                       |

## 10. 明确不做(v2)

自动盯 `add_facts` · 到期角标 · 逼近证伪预警 · 后台 push · `falsify_if` 结构化 + `surveilThesis` 引擎 · 空方 panel · 结构化 provenance + 口径规范 · 选股发现流。
