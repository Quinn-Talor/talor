# 标的卡估值:声明式恒等式 + 全程可见(逻辑→数据→V·不黑盒)

> 🗄️ **已归档**：本文已被现行规格 [`../spec.md`](../spec.md) 取代，只读、不再维护；归档说明见 [`README.md`](./README.md)。

> 本文 = 在 [`prediction-verification-model.md`](./prediction-verification-model.md)(锚/预期/双锚)基础上,解决
> **"估值计算黑盒、链路断、模型表达不统一"**。核心原则:估值从**逻辑**完整传导到**数据(预期参数)变化**,
> 再**计算**出 V,且**每一步中间量的数值都可见**——不黑盒。**方法无关:任何 method 都同一套处理。**日期:2026-06-28。

---

## 0. 原则(不可偏离)

**估值 = 逻辑 → 数据(预期参数)变化 → 逐步计算 → V,全程每个中间量的值都摆在面上。** 每个估值方法都这样传导——看卡的人能顺着"为什么是这个 V"一路看到底,没有任何一步是黑盒。能算、能逐步追溯、缺值不臆造。

## 1. 现状断点(已解决)

引擎 `computeValuationTrace` 原有 5 个固定 pipeline(`pe` 7参 / `dcf` / `pb-roe` / `ddm` / `nav`),键名写死。agent 的简化模型(如 `eps_year1 × pe_central`)键名不匹配 `pe` 七参 → `ok:false` → 不算、回退显存量 V + "恒等式待补"。链断在估值、V 没真算、过程黑盒。(实例:`002594-…-e5dddb52`。)

## 2. 数据模型 — 声明式逐参数折叠(方法无关)

`ValuationAssumption` 增可选 `step`(**不新增 method**;`custom` 这种特例方法已废除):

```ts
step?: {
  order: number               // 折叠序(1 = 起始项)
  op?: '×' | '÷' | '+' | '−'  // 与累积量的运算(order=1 可省,作起始)
  out: string                 // 本步产出的中间量名(末步必须 'V')
}
```

- 有 `step` → 入恒等式(按 order 折叠);无 `step` → **仅命门审计**(定性支撑,不入式)。
- `method` 退化为**模型标签**(pe/dcf/…),不再是"5 内置 + 1 custom"的分叉。

## 3. 引擎 — 声明式折叠(方法无关·逐步产出可见中间量)

`computeValuationTrace`:**任何 method,只要参数里有 `step` → 走声明式折叠** `stepFoldPipeline`(`acc = 首项;acc = acc op 预期值`),**每步产一个 `TraceStep`**(`out` / `expr` / 三档 / unit),`method` 原样透传。没声明 `step` 的卡(canonical pe 七参漏斗、或 dcf/pb-roe 等**非线性法**)走该 method 的内置 pipeline。

- 复用 `resolveForecast`(锚→预期,双锚)+ 现有 `TraceStep` 结构(UI 直接渲染)。
- 三档传导:命门(core)随档动撑区间、非命门固定 base(沿用现规则)。
- 缺值 / 不可算 → 该步标缺、`ok:false`、`missing[]` 列出 —— **不臆造**(断环可见)。

## 4. UI — 全链铺卡面,每步中间量可见(不下钻,所有 method 同一渲染)

决策面把"估值"段展开成两节:

**「逻辑 → 预期」(命门:锚 → 估)** — 每命门一行:`逻辑「成本护城河」▸ 锚 16%@2025-12 → 估 base 14.5(跳变 −1.5)`。
派生:`summarizeHealth.coreLogicLines` 取 `anchorValue`(锚)+ resolved base(估);**跳变(估−锚)仅 delta/factor 算**(est 由锚推导=同量);absolute(est 独立设定、锚仅立足事实)→ 只显 锚·估 不做减法(免异量臆造)。大跳变(>50%)标黄·需强逻辑;断锚标红。

**「预期 → 估值」(恒等式逐步算 V·三档,全程可见)** — 把 `computeValuationTrace` 每步**完整渲染**(不只 base):

```
② 预期 → 估值   值 ¥75.2   熊48 ~ 牛112.5 · pe
起始 EPS 3.76          = EPS年值 3.76  (熊3.2/牛4.5)  命门
3.76 × PE中枢 20       = V ¥75.2       (熊48/牛112.5) 命门
```

- **每步中间量的数值都显**(EPS / 营收 / … / V)= 不黑盒。步数随模型:EPS×PE 2 步、canonical pe 6 步。
- 校准期:变动的步显「旧→新」高亮(如 `上版¥289 → ¥262`)。缺值/不可算的步标红。
- 位置:**卡面**(不另开下钻);命门逐参数审计 + 版本史仍在既有下钻。

## 5. 迁移 + agent + 校验

- 迁 `migrate-card-schema.mjs`:EPS×PE 卡 → 加 `step`(eps{order:1,out:'EPS年值'} + pe{order:2,op:'×',out:'V'}),`method` 归 **pe**(EPS×PE 就是 PE 估值);历史误用的 `method='custom'` 一律收敛回 `pe`。canonical pe 漏斗(含 ev_pen 等叶子)不碰。
- agent prompt:估值恒等式用 `step` 逐参数声明(任何 method 适用);非线性法不声明 step,用内置公式。
- `card-tools` zod:加 `step`(method enum 无 custom)。`store` 校验:**一旦声明了 step,order 最大的末步 `out` 必须 'V'**(`STEP_CHAIN_NOT_V`)。

## 6. 范围 / 非目标

- 声明式 `step` 折叠只做**线性乘除链**(×÷+−);dcf 折现 / ddm 戈登 / pb-roe / nav 等**非线性法保留内置 pipeline**(它们同样吐逐步 `TraceStep` 阶梯,UI 一视同仁)。
- 不做公式求值器、不做多输入派生 DAG(YAGNI)。
- 决策面其余四段(claim/安全边际/决策/健康)不变。

## 7. 验收

- eps 卡(`e5dddb52`):`method=pe` + 2 step,决策面 B2 显 `EPS 3.76 × PE中枢 20 = ¥75.2`,每步中间量可见(不再"恒等式待补")。
- byd 卡(`sample01`):`method=pe` 无 step → 内置 pipeline 6 步阶梯 + 校准期旧→新。
- 任意卡:逻辑→锚→估→逐步中间量→V 全程可见;缺值标红不臆造;**无 `custom` 特例,每个 method 同一套传导**。
- `typecheck` 0 新错;invest 测全绿 + 折叠"触发/方法无关/缺值"测 + store"末步非 V"测。
