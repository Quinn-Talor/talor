# 事实 key 字典

> facts 的命名/取数/引用权威。key 是系统公共锚:**数据源(取数)· compute(算)· driver.basis/verify(引用)· 配模式(必备项)** 全靠 key 对齐。
> 配套设计见 [`README.md`](./README.md)。

## 命名规范

- `snake_case`;宏观无前缀,行业整体前缀 `ind_`,公司无前缀(行业特殊 key 直接用业务名)。
- `key` 是稳定标识(不随观测变);`label/unit/level/role` 是 key 的固定属性;`value/structure/as_of/source` 在每条观测。
- 自由 key(case-specific 软信息)允许,但须守命名规范 + 标 level/role。

## 三类(库 + thesis 驱动选,非固定清单)

| 类                  | 标准化     | 谁定                              |
| ------------------- | ---------- | --------------------------------- |
| 通用核心            | 固定 key   | 本字典写死(财务骨架·所有公司必取) |
| 行业特殊 / 行业整体 | 按行业模板 | 本字典给推荐集,agent 按行业选     |
| 自由                | 命名规范   | agent 自定(软信息/特殊事实)       |

`role`:**先行**(早于财报·验证主力)/ 同步 / 滞后 / **排雷**。

---

## 一、宏观 key(level=macro,喂 compute_macro_clock)

| key              | 含义       | 单位 | 源          | role |
| ---------------- | ---------- | ---- | ----------- | ---- |
| `pmi`            | 制造业 PMI | —    | 统计局/东财 | 先行 |
| `cpi_yoy`        | CPI 同比   | %    | 统计局      | 同步 |
| `ppi_yoy`        | PPI 同比   | %    | 统计局      | 先行 |
| `social_finance` | 社融增速   | %    | 央行        | 先行 |
| `m2_yoy`         | M2 同比    | %    | 央行        | 同步 |
| `lpr`            | 5年 LPR    | %    | 央行        | 同步 |
| `northbound`     | 北向净流入 | 亿   | 东财 hsgt   | 先行 |
| `policy_stance`  | 政策取向   | enum | 会议/部委   | 先行 |

## 二、行业整体 key(level=industry,喂 compute_industry_score 6维)

| key          | 维                                     | 源               |
| ------------ | -------------------------------------- | ---------------- |
| `ind_pen`    | 需求·渗透率                            | 协会/东财成分    |
| `ind_growth` | 需求·行业增速                          | 东财成分营收汇总 |
| `ind_util`   | 供给·产能利用率                        | 统计局/协会      |
| `ind_capex`  | 供给·资本开支阶段(出清/克制/扩张/过剩) | 东财成分 capex   |
| `ind_price`  | 价格趋势(提价/价格战)                  | 商品/协会        |
| `ind_inv`    | 库存(补/去)                            | 东财成分存货     |
| `ind_cr`     | 格局·集中度                            | 东财成分营收占比 |
| `ind_pe_pct` | 估值·行业 PE/PB 分位                   | 东财板块         |

> 行业整体多用**东财成分财务汇总做代理**(增速=成分营收加总同比、capex=成分在建工程、库存=成分存货、CR=头部营收占比)。

## 三、公司 key

### 3a. 通用核心(所有公司必取·好生意体检+排雷+估值传导)

| key               | 含义                         | 单位 | 东财字段/口径                  | 喂 compute               | role | 透视         |
| ----------------- | ---------------------------- | ---- | ------------------------------ | ------------------------ | ---- | ------------ |
| `rev_yoy`         | 营收增速(量/价拆)            | %    | TOTALOPERATEREVETZ             | projection·red_flags     | 同步 | 成长         |
| `gross_margin`    | 毛利率(趋势=定价权)          | %    | XSMLL                          | dupont                   | 同步 | **护城河**   |
| `sales_exp_ratio` | 销售费用率(品牌是否自带流量) | %    | 销售费用/营收                  | red_flags                | 同步 | **护城河**   |
| `net_margin`      | 净利率                       | %    | 算                             | dupont·projection        | 同步 | 盈利         |
| `core_ni`         | 扣非归母净利(利润质量)       | 亿   | 扣非净利润                     | red_flags                | 滞后 | **质量**     |
| `roe`             | ROE(杜邦三因子)              | %    | ROEJQ                          | dupont                   | 滞后 | 资本回报     |
| `roa`             | 总资产回报(剥杠杆的真实回报) | %    | 净利/平均总资产·算(终端常直供) | dupont·red_flags         | 滞后 | **资本回报** |
| `ocf_ni`          | 经营现金流/净利(收现质量)    | x    | 算(现金流/利润表)              | red_flags                | 先行 | **质量**     |
| `fcf`             | 自由现金流=OCF−capex         | 亿   | 算(现金流量表)                 | red_flags·valuation(dcf) | 先行 | **质量**     |
| `debt_assets`     | 资产负债率·有息/净现金       | %    | 算                             | red_flags                | 同步 | 资本结构     |
| `ar`              | 应收(账龄+DSO)               | 亿   | 资产负债表+附注                | red_flags·turnover       | 排雷 | 质量         |
| `ap`              | 应付(占款+DPO)               | 亿   | 资产负债表                     | turnover                 | 同步 | **护城河**   |
| `inventory`       | 存货(结构+周转)              | 亿   | 资产负债表+附注                | red_flags·turnover       | 排雷 | 质量         |
| `contract_liab`   | 合同负债(预收·议价)          | 亿   | 资产负债表                     | red_flags                | 先行 | **护城河**   |
| `goodwill`        | 商誉(并购/减值雷)            | 亿   | 资产负债表                     | red_flags                | 排雷 | 质量         |
| `eps`             | EPS                          | 元   | EPSJB                          | valuation(pe)            | 滞后 | 估值         |
| `bvps`            | 每股净资产                   | 元   | BPS                            | valuation(pb-roe)        | 同步 | 估值         |
| `dps`             | 每股分红                     | 元   | 分红接口                       | valuation(ddm)           | 同步 | 估值         |
| `pe_pct`·`pb_pct` | PE/PB 历史分位               | %    | K线+行情算                     | percentile               | 同步 | 估值         |
| `price`           | 现价                         | 元   | push2 f43÷100                  | valuation                | 同步 | 估值         |

### 3a★ 好生意体检(资格赛后 / 估值前的一道关:这门生意值不值得拥有)

> 与命门(下文 3b:本次逻辑能不能兑现)正交。好生意体检判**生意质地 + 护城河**,用 3a 通用核心 key 的**趋势(5–10 年)**打分。三步:质量门 → 资本回报质地 → 护城河趋势。

**(1) 盈利质量门(排雷·先于一切,过不了不看后面):**

- `ocf_ni ≥ 1`(长期):利润收得回现金;长期 < 1 → 利润困在 `ar`/`inventory`,纸面富贵。
- `fcf > 0` 且 capex 非长期吞光 OCF(分**维持性 vs 扩张性**);`core_ni`(扣非)≈ 归母净利(非补贴/投资收益/处置撑)。

**(2) 资本回报质地(剥杠杆看生意本身,不是增速/净利率):**

- 主看 `roe`(直读·加权)与 `roa = 净利率 × 总资产周转`(剥掉杠杆的真实回报,单线可算 / 终端常直供)——**不重构 ROIC**(ROIC 要拼 EBIT + 选有息负债 + 判超额现金、无单一来源、口径不透明,违反"事实带源")。
- 杜邦串起来:`roe = roa × 权益乘数`、`roa = 净利率(定价权) × 总资产周转(成本/规模)` → 一眼看出高回报靠**定价权**还是**周转**、以及是否靠杠杆。
- **剥杠杆判真伪**:`roe` 高且 `debt_assets` 低(权益乘数 ≈ 1÷(1−`debt_assets`) 不高)= 真好生意;`roe` 高但 `debt_assets` 高 = 杠杆撑的伪好生意;`roa` 低 = 生意本身回报差(被杠杆掩盖)。

**(3) 护城河 × 财务科目指纹(读趋势):**

| 护城河类型         | 关键 key 组合                                                   | 指纹(怎么读)                             |
| ------------------ | --------------------------------------------------------------- | ---------------------------------------- |
| 无形资产·品牌      | `gross_margin`↑稳 + `sales_exp_ratio` 低 + `contract_liab`↑     | 高毛利**不靠砸广告**、客户愿先付钱       |
| 无形资产·专利/牌照 | 高 `gross_margin` + `rd_ratio`/牌照 + 准入稀少                  | 技术/牌照壁垒(防研发资本化虚增)          |
| 转换成本           | `contract_liab`(递延)+ `ar` 稳回款 + `sales_exp_ratio` 低       | 锁客、不用反复获客                       |
| 网络效应·平台      | `contract_liab`+`ap` ≫ `ar`+`inventory`(负营运资本)+ 高周转     | 上下游都给你**垫钱**做生意(CCC<0)        |
| 成本优势·规模/工艺 | 营业成本率 < 同业 + 高周转 + 高 `roa`                           | 即使毛利不高也走量出高回报(Costco 型)    |
| 成本优势·独占资源  | 低单位成本 + 资源资产 + 高稳 `gross_margin`                     | 重资产但 `roe`/`roa` 仍高(低成本矿/水电) |
| 上下游议价         | `prepaid` 少 + `ap` 占款多(DPO 长)+ `ar` 账期短                 | 产业链话语权:占别人的钱                  |
| 伪护城河(警惕)     | 当期高 `roe` 但靠杠杆/补贴、`gross_margin`↓、`sales_exp_ratio`↑ | 高回报不可持续 → 体检不过                |

> 一句话:**护城河 = "高资本回报(`roe`/`roa`)能持续"在报表上的痕迹。`gross_margin` 水平+趋势看定价权,`sales_exp_ratio` 看品牌自带流量,`contract_liab`/`ap` 看产业链议价,营运资本结构(CCC)看是不是别人给你垫钱。** 体检结论喂 `eligibility`(好生意 → 才进逻辑;非好生意 → 提高安全边际门槛或不碰)。

### 3b. 行业特殊(因行业·命门核心·命门 driver 优先 ref)

| 行业      | 行业特殊 key                                                                             |
| --------- | ---------------------------------------------------------------------------------------- |
| 科技/成长 | `rd_ratio`(研发占比)·`yield`(良率)·`backlog`(在手订单)·`client_conc`(客户集中)           |
| 制造      | `capacity_util`(产能利用率)·`shipments`(出货量)·`orders`(订单=合同负债)·`unit_cost`      |
| 周期      | `product_price`(产品售价)·`spread`(价差)·`open_rate`(开工率)·`normalized_roe`(正常化ROE) |
| 消费      | `same_store`(同店)·`arpu`(客单)·`members`(会员/复购)·`channel_inv`(渠道库存)             |
| 金融      | `nim`(净息差)·`npl`(不良率)·`provision`(拨备覆盖)·`aum_scale`(规模)·`ev`(内含价值)       |
| 公用/资源 | `capacity`(装机/产量)·`tariff`(电价/油价)·`payout`(分红率)·`reserves`(储量)              |
| 医药      | `pipeline`(管线/临床)·`vbp_impact`(集采影响)·`sales_ramp`(销售放量)                      |

### 3c. 先行指标(验证主力·跨行业·role=先行)

| key             | 先行于                            | 源            |
| --------------- | --------------------------------- | ------------- |
| `monthly_sales` | 季报营收                          | 协会/上险量   |
| `contract_liab` | 未来营收(钱已收)                  | 财报附注/东财 |
| `backlog`       | 营收                              | 公告/研报     |
| `prepaid`       | 扩产/锁料                         | 资产负债表    |
| `cip`           | 未来产能                          | 资产负债表    |
| `ocf_ni`        | 盈利质量                          | 现金流量表    |
| `alt_hf`        | 经营景气(上险/DAU/电费/物流/招聘) | 检索          |

---

## 四、"结构 + 周转"强制 key(非标量)

| key           | 结构维(拆)                   | 周转/效率维                | 预警组合                   |
| ------------- | ---------------------------- | -------------------------- | -------------------------- |
| `inventory`   | 原料/在产/产成品             | 周转天数(compute_turnover) | 产成品↑+周转↓=滞销         |
| `ar`          | 账龄(1年内/1-2/2+)           | DSO                        | 长账龄↑+DSO↑=收款恶化/虚增 |
| `ap`          | 应付账款/票据                | DPO · 现金循环 CCC         | DPO 长+CCC<0=占款·产业链强 |
| `rev_yoy`     | 量/价·产品线                 | 增速                       | 量↑价↓=以量补价            |
| `roe`         | 杜邦三因子(净利率×周转×杠杆) | —                          | 靠杠杆撑=脆弱              |
| `debt_assets` | 有息/无息·短/长期            | —                          | 短期有息↑=流动性紧         |

→ 这些 key 的观测**必须带 structure(拆解+signal+quality)+ change.turnover**;只给总额视为不合格。

---

## 五、配模式必备 key(validator 按 method 校验)

| method | 必备 key                                       |
| ------ | ---------------------------------------------- |
| pe     | `eps`·`pe_pct`(+ projection 的营收增速/净利率) |
| dcf    | FCF 相关·折现率                                |
| pb-roe | `bvps`·`roe`(正常化)                           |
| ddm    | `dps`·分红率                                   |
| nav    | 分部重估·`reserves`/资源价格                   |

> method=pb-roe 而缺 `bvps`/`roe` → validator 拒(防 method-misapplication,如周期股套 PE)。

---

## 六、取数映射(key → 东财公开接口)

| 来源         | 接口                                             | 取哪些 key                                                                                               |
| ------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 实时行情     | `push2.eastmoney.com/api/qt/stock/get`           | price(f43÷100)·pe·pb                                                                                     |
| 主要财务指标 | `datacenter.../RPT_F10_FINANCE_MAINFINADATA`     | rev_yoy(TOTALOPERATEREVETZ)·eps(EPSJB)·bvps(BPS)·roe(ROEJQ)·gross_margin(XSMLL)·core_ni(扣非)·net_margin |
| 利润表       | `datacenter.../RPT_DMSK_FN_INCOME`               | 销售/管理/研发费用 → sales_exp_ratio                                                                     |
| 三大报表     | `datacenter.../RPT_DMSK_FN_*`(资产负债/现金流)   | ar·ap·inventory·goodwill·debt·contract_liab·cip·总资产(roa/周转分母) · ocf/capex→fcf·ocf_ni              |
| 历史K线      | `push2his.../kline/get`                          | pe_pct·pb_pct(分位算)·趋势                                                                               |
| 宏观/板块    | `datacenter.../RPT_ECONOMY_*` · `push2.../clist` | macro keys · ind\_\* 代理                                                                                |

> 行业特殊 key(同店/NIM/产品价/管线)+ 先行另类(上险/DAU)多需**检索**(行业协会/研报/cninfo),非东财接口直出。
