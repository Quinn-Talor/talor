# 归档说明

本目录的文档都已被现行规格 [`../spec.md`](../spec.md) 取代，只读、不再维护，保留用于追溯设计演进。与现行规格冲突时以 `spec.md` 为准。

| 文档                                                                     | 时期       | 内容                                                              | 被什么取代                                                        |
| ------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`design-final.md`](./design-final.md)                                   | 2026-06    | 原本目录 README：设计终稿（事实 / 逻辑 / 时间线、双闸、九不变量） | §1 理念保留在 [`../README.md`](../README.md)；其余被 spec 取代    |
| [`data-framework.svg`](./data-framework.svg)                             | 2026-06    | 三层数据 → 逻辑图（配 design-final）                              | spec §1、§5                                                       |
| [`mvp-design.md`](./mvp-design.md)                                       | 2026-06    | MVP 完整方案（invest_lib、card 工具、agents 装配）                | spec                                                              |
| [`value-chain-rigor.md`](./value-chain-rigor.md)                         | 2026-06-23 | 价值传导链严谨化与决策系统                                        | spec §5、§8、§11                                                  |
| [`prediction-verification-model.md`](./prediction-verification-model.md) | 2026-06-28 | 锚、预测、对照与复盘对账的字段模型                                | spec §5.5、§9.5、§12                                              |
| [`traceable-valuation-chain.md`](./traceable-valuation-chain.md)         | 2026-06-28 | 估值声明式恒等式与全程可见                                        | spec §5.4、§8.1                                                   |
| [`card-ui-rendering-plan.md`](./card-ui-rendering-plan.md)               | 2026-06    | 标的卡 UI 渲染方案                                                | `docs/talor-feature-architecture.md`                              |
| [`invest-spec-v5.md`](./invest-spec-v5.md)                               | 2026-10    | v5.1 规格：以估值公式为核心的投资研究循环                         | spec（v6.1）；v5.1 各机制的逐项去向见 v6 附录 B（git `aa3ca370`） |

代码注释中仍引用 `design-final.md`、`value-chain-rigor.md`、`mvp-design.md` 的位置（`src/shared/types/invest.ts`、`src/main/invest/store.ts`、`src/main/invest/compute/types.ts`、`src/renderer/invest/*`）描述的是现有实现所依据的旧模型，按 spec §20 迁移时一并更新。
