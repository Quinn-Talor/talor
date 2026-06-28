# A股投资 Agent — 设计终稿

> 本目录唯一说明文档。事实 key 字典见 [`fact-keys.md`](./fact-keys.md);三层数据→逻辑图见 [`data-framework.svg`](./data-framework.svg)。
> 真相基准 = 当前代码 + 本文;冲突时以代码为准,并回头修本文。

骨架三样:**事实 / 逻辑 / 时间线**;双闸:**gate(系统风险)+ 安全边际(估值缓冲)**。

---

## 1. 理念

为**结构弱势的散户**建**在 A 股生存的投资体系** = **投资纪律外骨骼**,信条**盯逻辑而非价格**。卫星仓,复盘**跑赢宽基才算赢**。设计天平:**约束结果不变量,不约束过程路径**。

---

## 2. 核心模型

> **盯一只股的「逻辑」有没有按「事实」兑现,只在价格进「安全边际」时才动手。**

```
① 事实 facts     客观·按 key 序列·只增不改·快变量    ○──○──○──○─▶
② 逻辑 thesis    主观·冻结快照·慢变量                ●━━━━●(修订才跳)
③ 时间线 timeline 复查 / 决策 / 复盘                  ▽   ▽   ▽
```

- 只有**事实是"流"**(连续 append);**逻辑离散冻结**(慢变,不自动跟事实);时间线在离散点对账。
- **双线收敛**:每个 driver「预估线(逻辑给)⟷ 事实线(事实给)」,窗口内收敛=兑现、背离=警惕。
- **事实快变 + 逻辑慢变 = "盯逻辑而非价格"的结构根**(逻辑不随数据噪声乱跳)。

---

## 3. ① 事实 facts(客观·按 key 序列·三维·分层分类)

```
facts[key] = { level, label, unit, role(先行/同步/滞后/排雷), series:[观测] }
观测 = { value, as_of, source(白名单),
         change?(yoy·趋势·周转·动能),           ← 变化维(compute_trend/turnover 派生)
         structure?(components[{name,value,signal}], quality) }  ← 结构维
```

**三维读法**:数值 · **变化**(含**周转**)· **结构**(拆解,揭示"数值好看但结构恶化")。

**分层 + 公司层再分通用/行业特殊**(详见 [`fact-keys.md`](./fact-keys.md)):

| 层 / 类                            | 内容                                                                                             | 用途                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| 公司·通用 key(所有公司·必取)       | 营收/毛利净利率/ROE/经营现金流/负债/8红灯/估值分位/(结构周转)存货·应收                           | 资格赛排雷 + 估值传导      |
| 公司·行业特殊 key(因行业·命门核心) | 制造:产能利用率/订单 · 消费:同店/客单 · 周期:产品价/价差 · 金融:NIM/NPL · 科技:研发/良率/backlog | 命门 driver 立足/验收      |
| 行业整体(level=industry)           | 行业渗透率/CR/均价/行业估值分位                                                                  | 行业景气6维 + 公司命门立足 |
| 宏观(level=macro)                  | PMI/CPI/PPI/社融/M2/LPR/北向                                                                     | 美林时钟 → 总仓位          |

**三条 key 铁律**:

1. **重点先行指标**(验证要早·抢 price-in 前):月度销量·合同负债·在手订单·预付·产能利用率·在建工程·渠道库存·OCF领先净利·另类高频。`role=先行` 是验证主力;滞后财务作估值+排雷。
2. **关键 key 需"结构+周转"**(非标量):存货(原料/在产/产成品+周转天数)、应收(账龄+DSO)、营收(量/价+增速)、ROE(杜邦三因子)。
3. **通用 key 行业化解读**:周期看正常化盈利(非当期EPS)、银行用利息净收入+PB-ROE。

---

## 4. ② 逻辑 thesis(主观·冻结快照·版本化)

> 价值链严谨化升级详见 [`value-chain-rigor.md`](./value-chain-rigor.md)。

```
thesis = { versions:[快照], current }
快照 = { claim(大白话单句) · profit_type · valuation }
valuation = method(配 profit_type) + assumptions[](★全部估值预测参数·单一真相) + V(compute算) + 安全边际门槛
assumption(预测参数) = key · label · 三档(bear/base/bull) · 立足 from_fact(派生自事实) ·
                       验证 verify(对账事实·先行+终验) · 敏感度;命门(high)额外带 逻辑锚 + 证伪线
命门 = assumptions 中 sensitivity==='high'(吸收原 drivers)
```

**严谨推导**:逻辑塌缩到最少几个根假设(估),恒等式(销量→营收→EPS→V)**沉到 compute,不进卡**。准确性靠**预期差 + 敏感度定仓 + 安全边际 + 可快速证伪**,非"估准"。逻辑变一次 = 出新版本快照(冻结,basis 钉时点);`current` 指当前版。

**配模式(method 决定根假设集)**:

| method | 适用             | 根假设                 |
| ------ | ---------------- | ---------------------- |
| pe     | 成长/稳定        | 营收增速·净利率·PE中枢 |
| dcf    | 现金流清晰       | FCF·g·折现率·永续g     |
| pb-roe | 周期/重资产/金融 | 正常化ROE·BVPS·g·r     |
| ddm    | 高分红           | 分红·分红g·r           |
| nav    | 资源/控股        | 分部重估·资源价格·折价 |

---

## 5. ③ 时间线 timeline(复查 / 决策 / 复盘)

```
复查(每财报·主力)= 验证 + 重立(同一最新事实一鱼两吃):
  ① 验证(回看):逐参数对账(checks[].assumption;predicted 取 against_v·不回溯,actual 取 facts[verify.fact] 最新)
     → outcome 双向(超预期/兑现=强化、容差=持有、偏离=校准、破=证伪)→ validity + conviction
  ② 重立(向前·仅校准/证伪):最新事实作新版 from_fact 立足 → 重新预测 → compute 重算 V → 重出安全边际
  强化/持有不换版,只有校准/证伪才填 spawned_v(逻辑慢变·挡噪声)
决策:建/加/减/清 + 仓位(compute 出)+ based_v;多闸(逻辑成立→gate→安全边际→新鲜复查)·非荐股
复盘:跑赢宽基没 + 教训
```

---

## 6. 事实 → 逻辑(默认不动,归因才跳)

```
新观测 → 复查 → ┌ 容差内/噪声/外生 ─▶ 逻辑不动(只重估 V_now)
                ├ 参数错(逻辑对) ───▶ 校准:新版本(改 projected)
                ├ 机制错(逻辑错) ───▶ 重写/证伪:新版本 或 退出
                └ 结构性新信息 ─────▶ 信息驱动:新版本(加/退 driver)
```

多数复查逻辑不动(`spawned_v=null`)——挡噪声、防过度交易。

---

## 7. 安全边际(价格闸:逻辑错了的兜底)

- **锚保守端 V_bear**:强买点 P≤V_bear;中等 (V_base−P)/V_base ≥ 门槛。
- **门槛随不确定性放大**:V区间宽↑·命门 high 未验↑·拐点/成长↑·距验收远↑。
- **买入硬门** `at_buy_point`:逻辑成立 ≠ 该买,还得价格进安全边际。**"等"最常见原因 = 逻辑对、边际不足。**

---

## 8. 完整 JSON(终稿)

```jsonc
{
  "head": { "code": "002594", "name": "比亚迪", "status": "held", "bucket": "satellite" },
  "eligibility": { "red_flags": 0, "source_positive": true, "in_circle": true, "pass": true },

  // ① 事实:按 key 序列·三维·分层分类·先行重点
  "facts": {
    "rev_yoy": {
      "level": "company",
      "label": "营收增速",
      "unit": "%",
      "role": "同步",
      "series": [
        {
          "value": "19%",
          "as_of": "2026-03",
          "source": "巨潮:一季报",
          "change": { "trend": "22→19·减速" },
        },
      ],
    },
    "inventory": {
      "level": "company",
      "label": "存货",
      "unit": "亿元",
      "role": "排雷",
      "series": [
        {
          "value": "320亿",
          "as_of": "2026-03",
          "source": "巨潮:附注",
          "change": { "yoy": "+18%", "turnover_days": "58·放缓" },
          "structure": {
            "note": "产成品激增·滞销苗头",
            "quality": "deteriorating",
            "components": [{ "name": "产成品", "value": "170亿 +28%", "signal": "bad" }],
          },
        },
      ],
    },
    "monthly_sales": {
      "level": "company",
      "label": "月度销量",
      "unit": "万辆",
      "role": "先行",
      "series": [
        { "value": "32万", "as_of": "2026-04", "source": "乘联会", "change": { "yoy": "+20%" } },
      ],
    },
    "co_share": {
      "level": "company",
      "label": "公司份额",
      "unit": "%",
      "role": "同步",
      "series": [{ "value": "15%", "as_of": "2026-04", "source": "乘联会" }],
    },
    "ev_pen": {
      "level": "industry",
      "label": "行业渗透率",
      "unit": "%",
      "role": "同步",
      "series": [
        {
          "value": "42%",
          "as_of": "2026-03",
          "source": "中汽协",
          "structure": { "note": "高端先行", "quality": "mixed" },
        },
      ],
    },
    "policy_ev": {
      "level": "macro",
      "label": "购置税",
      "role": "先行",
      "series": [{ "value": "延续2027", "as_of": "2026-03", "source": "财政部" }],
    },
  },

  // ② 逻辑:冻结快照·版本化
  "thesis": {
    "versions": [
      {
        "v": 1,
        "at": "2026-03-31",
        "scope": "建立",
        "claim": "政策让电车多卖,比亚迪成本低抢份额→赚钱",
        "profit_type": "成长",
        "valuation": {
          "method": "pe",
          "assumptions": [
            {
              "key": "co_share",
              "label": "公司份额",
              "bear": 15,
              "base": 16,
              "bull": 17,
              "from_fact": "co_share@2025-12",
              "verify": [
                { "fact": "monthly_sales", "at": "monthly", "role": "先行" },
                { "fact": "co_share", "at": "quarterly", "role": "终验" },
              ],
              "sensitivity": "high",
              "logic_anchor": "成本护城河",
              "falsify": "连2季<14%",
            },
            {
              "key": "net_margin",
              "label": "净利率",
              "bear": 8,
              "base": 9,
              "bull": 10,
              "from_fact": "net_margin@2026-03",
            },
            {
              "key": "pe_central",
              "label": "PE中枢",
              "bear": 18,
              "base": 22,
              "bull": 26,
              "from_fact": "行业估值分位@2026-03",
            },
          ],
          "V": { "bear": 210, "base": 290, "bull": 380 },
          "margin_of_safety": {
            "required": 0.25,
            "anchor": "bear",
            "required_basis": "V区间宽+命门high未验+成长股→25%",
          },
        },
      },
    ],
    "current": 1,
  },

  // ③ 时间线
  "timeline": [
    {
      "type": "复查",
      "at": "2026-04-30",
      "against_v": 1,
      "validity": "持有",
      "conviction": "mid",
      "checks": [
        {
          "assumption": "co_share",
          "predicted": "16%",
          "actual": "15%",
          "actual_fact": "monthly_sales@2026-04",
          "deviation": { "数值": "-1pp", "结构": "以量补价", "变化": "减速" },
          "outcome": "容差",
          "attribution": { "cause": "补贴空窗,Q2恢复", "type": "外生" },
        },
      ],
      "value_now": {
        "V": { "bear": 210, "base": 265, "bull": 350 },
        "price": 255,
        "realized_pct": 0.25,
        "margin_of_safety": {
          "to_bear": "-21%",
          "vs_required": "<25%",
          "at_buy_point": false,
          "buy_trigger": 210,
        },
      },
      "gate": { "state": "节流" },
      "spawned_v": null,
      "signal": { "verdict": "等", "reason": "逻辑holding但安全边际不足+gate节流" },
    },
    {
      "type": "决策",
      "at": "2026-05-10",
      "trade": "建",
      "price": 218,
      "weight": 0.05,
      "reason": "回调至边际达标,命门holding",
    },
    {
      "type": "复盘",
      "at": "2026-12-31",
      "vs_benchmark": { "satellite": 0.18, "index": 0.12, "verdict": "跑赢" },
      "lesson": "拐点信号阈值更严",
    },
  ],
}
```

---

## 9. 散户层(引擎严谨·仪表盘朴素)

```
逻辑一句话:政策让电车多卖,比亚迪成本低抢份额 → 赚钱
双线收敛:  渗透率 估50%━ 实际42%○ │ 份额 估16%━ 实际15%○ 略背离 │ 兑现度25%
安全边际:  现价¥255 vs 熊市价值¥210(贵21%)│ 门槛25% │ 不足 → 等回调¥218以下
红线:      份额连2季<14% / 渗透率年报<45% / 存货产成品激增+周转放缓 / 出8红灯 → 撤
现在:      等(逻辑没破·边际不足)·非荐股
```

---

## 10. 九不变量(代码强制)

① 命门(高敏 assumption)必挂逻辑(logic_anchor),否则拒
② 事实必带来源(白名单)+ 时点,只增不改;关键 key(存货/应收/营收)需结构+周转
③ 价值由 compute 从 assumptions 算,不手填
④ 复查锚出身版本(against_v)不回溯;命门连偏 N 次强制证伪,连续兑现→确信度↑
⑤ 决策过 gate(系统性风险闸)
⑥ 建/加仓过安全边际门槛(at_buy_point),否则拒;override 留痕
⑦ 估值参数必挂事实:每 assumption 须 from_fact(立足),命门须 verify(指向白名单事实)
⑧ 逻辑成立性硬闸:validity=证伪 → 禁建/加(仅减/清),无论价格多便宜(防价值陷阱)
⑨ 决策时效闸:建/加须基于"已对账最新事实"的新鲜复查(复查 at ≥ 最新事实 as_of)

---

## 11. 三面架构 + 业务流 + 数据策略

**三面**:判断面(LLM:拆逻辑/归因/选key/取值)· 能力面(东财接口/compute[trend·turnover·red_flags·dupont·projection·valuation·buy_trigger·position·decision·industry·macro]/store)· 栏杆面(九不变量+配模式必备key)。

**业务流**:

```
建卡:锚行业 → 取通用核心+行业特殊 key + 定命门 → thesis.v1(compute算V+安全边际门槛)
财报到:facts 追加(先行 key 优先)→ 复查(对账+兑现+重估+归因)→ 持有/校准/证伪
动手:gate + 安全边际 双闸过 → 决策 · 平仓:复盘(跑赢宽基?)
```

**数据三层**:东财确定性接口(公司通用+行业整体+宏观,key↔字段映射,入 facts)+ 浏览器检索(行业特殊KPI+先行另类+软信息)+ LLM 定性。东财=主、Tushare=备份核验、akshare/baostock=弃;行业层用东财成分财务汇总做代理指标。

---

## 一句话收口

> **Card = 事实(客观·按key序列·三维·分层:公司通用+公司行业特殊+行业整体+宏观·先行重点·关键key结构+周转)+ 逻辑(主观·冻结快照·valuation.assumptions 预测参数·每参数挂事实·配模式估值·安全边际门槛)+ 时间线(复查=验证+重立/决策/复盘)。事实快变逻辑慢变,复查双向验证(强化/校准/证伪)定逻辑动否(默认不动);价值=compute(assumptions);买入过 逻辑成立+gate+安全边际+新鲜复查。内核严谨、呈现朴素、九不变量代码守底。**
