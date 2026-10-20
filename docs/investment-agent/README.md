# A 股投资模块（invest）文档

> 现行规格只有一份：[`spec.md`](./spec.md)（v6.1）。本目录其余文档分为"参考"与"归档"两类；归档文档只读、不再维护，与现行规格冲突时以 `spec.md` 为准。

## 理念

为结构弱势的散户建在 A 股生存的投资体系——**投资纪律外骨骼**；信条是**盯逻辑而非价格**；面向卫星仓，复盘**跑赢宽基才算赢**。（摘自原设计终稿 §1，见 [`archive/design-final.md`](./archive/design-final.md)）

现行规格在此基础上确定：目标是长期超额收益，管理是手段；人、LLM、系统按能力分工；收益来源由分析得出；全部事件驱动。

## 目录

```
docs/investment-agent/
├── README.md                          本文：文档地图与阅读顺序
├── spec.md                            现行规格（v6.1）
├── reference/                         参考：现有实现，迁移时对照
│   ├── implementation-overview.md
│   └── fact-keys.md
└── archive/                           归档：已被 spec.md 取代的历史设计
    ├── README.md                      归档说明（各文档被什么取代）
    └── …
```

| 文档                                                                             | 状态 | 用途                                                                                                             |
| -------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------- |
| [`spec.md`](./spec.md)                                                           | 现行 | 目标与度量、三方分工、逻辑、收益来源、估值、定价与仓位、事件与提醒、业务流程、护栏与决策包、归因、数据模型、路线 |
| [`reference/implementation-overview.md`](./reference/implementation-overview.md) | 参考 | 现有代码结构（2026-06-28 as-built），按 spec §20 迁移时对照                                                      |
| [`reference/fact-keys.md`](./reference/fact-keys.md)                             | 参考 | 现有事实 key 与东财等数据源的字段实证；P2 信息源适配器与指标定义（spec §14.3）迁移时使用                         |
| [`archive/`](./archive/README.md)                                                | 归档 | 2026-06 至 2026-10 的历史设计与 v5.1 规格                                                                        |

## 阅读顺序（spec.md）

| 目的           | 章节                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第一次了解     | §1 一句话模型 → §2 目标与度量 → §4 三方分工 → §10 业务流程（§10.9 端到端示例）→ §11.4 五问                                                               |
| 实现           | 再读 §5 逻辑 → §6 收益来源 → §7 估值 → §8 定价与仓位 → §9 事件与提醒 → §11 护栏 → §14–§18 数据模型、参数、命令、闭合检查、代码分层 → §19 验收 → §20 路线 |
| 评审规则与取舍 | §13 规则清单与附录 B；附录 C 为 v6 → v6.1 的变更记录；§21 未决事项                                                                                       |

## 相关文档（不在本目录）

| 文档                                                                                                                                               | 状态                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`docs/talor-feature-architecture.md`](../talor-feature-architecture.md)                                                                           | 平台 Feature 架构，invest 是其中一个 Feature；标的卡 UI 的落地以它为准       |
| [`docs/superpowers/specs/2026-08-01-invest-data-reliability-design.md`](../superpowers/specs/2026-08-01-invest-data-reliability-design.md)         | 数据来源、新鲜度、准确性设计；已部分并入 spec（H1、§9.2、§14.3），其余作参考 |
| [`docs/superpowers/specs/2026-07-16-invest-agent-design.md`](../superpowers/specs/2026-07-16-invest-agent-design.md)                               | 历史设计，已被 spec 取代                                                     |
| [`docs/superpowers/specs/2026-07-20-invest-agent-system-redesign.md`](../superpowers/specs/2026-07-20-invest-agent-system-redesign.md) 及同名 plan | 历史设计与实施计划，已被 spec 取代                                           |
| `vibe/features/invest-*`、`vibe/features/investment-agent`                                                                                         | 历史实施记录（klook-vibe 编码 prompt）                                       |

## 版本

| 版本       | 日期       | 位置                                                       | 状态         |
| ---------- | ---------- | ---------------------------------------------------------- | ------------ |
| v6.1       | 2026-10-20 | [`spec.md`](./spec.md)                                     | 现行         |
| v6         | 2026-10-20 | git `aa3ca370`（`invest-spec-v6.md`）                      | 被 v6.1 覆盖 |
| v5.1       | 2026-10    | [`archive/invest-spec-v5.md`](./archive/invest-spec-v5.md) | 已取代       |
| 设计终稿等 | 2026-06–07 | [`archive/`](./archive/README.md)                          | 已取代       |
