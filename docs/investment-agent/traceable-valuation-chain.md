# 标的卡估值:声明式恒等式 + 全程可见(逻辑→数据→V·不黑盒)

> 本文 = 在 [`prediction-verification-model.md`](./prediction-verification-model.md)(锚/预期/双锚)基础上,解决
> **"估值计算黑盒、非 canonical 模型不算、链路断"**。核心原则:估值从**逻辑**完整传导到**数据(预期参数)变化**,
> 再**计算**出 V,且**每一步中间量的数值都可见**——不黑盒。日期:2026-06-28。

---

## 0. 原则(不可偏离)

**估值 = 逻辑 → 数据(预期参数)变化 → 逐步计算 → V,全程每个中间量的值都摆在面上。** 任何 agent 自定义的恒等式(不止内置 5 法)都要:能算、能逐步追溯、缺值不臆造。看卡的人能顺着"为什么是这个 V"一路看到底,没有任何一步是黑盒。

## 1. 现状断点

引擎 `computeValuationTrace(method, assumptions)` 有 5 个**固定** pipeline(`pe` 7参 / `dcf` / `pb-roe` / `ddm` / `nav`),各自键名写死。agent 自定义模型(如 `eps_year1 × pe_central`)键名不匹配 `pe` 七参 → `ok:false` → **不算**、回退显存量 V + "恒等式待补参数/配模式"。→ 链断在估值、V 没真算、过程黑盒。(实例:`002594-20260628-e5dddb52`。)

## 2. 数据模型 — 声明式逐参数折叠

`ValuationMethod` 增 `'custom'`;`ValuationAssumption` 增可选 `step`:

```ts
step?: {
  order: number               // 折叠序(1 = 起始项)
  op?: '×' | '÷' | '+' | '−'  // 与累积量的运算(order=1 可省,作起始)
  out: string                 // 本步产出的中间量名(末步通常 'V')
}
```

- 有 `step` → 入恒等式(按 order 折叠);无 `step` → **仅命门审计**(定性支撑,不入式)。
- 非线性(dcf/ddm/pb-roe/nav)保留内置不动;`custom` 走声明式折叠。

## 3. 引擎 — `custom` 折叠(逐步产出可见中间量)

`computeValuationTrace`:`method==='custom'` → 取有 `step` 的参数按 `order` 排序,`acc = 首项预期值;acc = acc op 预期值`,**每步产一个 `TraceStep`**(`out` 名 / `expr` / 三档 bear·base·bull / unit)。

- 复用 `resolveForecast`(锚→预期,双锚)拿每参数预期值 + 复用现有 `TraceStep` 结构(UI 直接渲染)。
- 三档传导:命门(core)随档动撑区间、非命门固定 base(沿用现规则)。
- 缺值 / 不可算 → 该步标缺、`ok:false`、`missing[]` 列出 —— **不臆造**(断环可见)。

## 4. UI — 全链铺卡面,每步中间量可见(不下钻)

决策面把"估值"段展开成两节(参考 value-chain-rigor §B 基准):

**「逻辑 → 预期」(命门:锚 → 估)** — 每命门一行:
`逻辑「成本护城河」▸ 锚 16%@2025-12 → 估 base 14.5(跳变 −1.5)`。跳变大且逻辑弱 → 标红(可疑)。
派生:`summarizeHealth` 取 `anchorValue`(锚)+ resolved base(估);`跳变 = 估 − 锚`。

**「预期 → 估值」(恒等式逐步算 V·三档,全程可见)** — 把 `computeValuationTrace` 每步**完整渲染**(不只 base):

```
参数        EPS 3.76元★ · PE中枢 20x★
— 计算过程(恒等式逐步·三档)——————
EPS年值  = 起始(锚直取)   3.76 元    (熊3.2/牛4.5)
V        = × PE中枢        ¥75.2      (熊48/牛112.5)  ← 命门驱动
```

- **每步中间量的数值都显**(行业销量/营收/净利/EPS/…/V)= 不黑盒。步数随模型:eps×pe 2 步、canonical pe 6 步。
- 校准期:变动的步显「旧→新」高亮(如 `上版¥289 → ¥262`)。
- 缺值/不可算的步标红(断环可见)。
- 位置:**卡面**(不另开下钻);事实序列/时间线等更深细节仍在既有下钻。

## 5. 迁移 + agent + 校验

- 迁 `e5dddb52`:`method→custom`;`eps_year1{order:1,out:'EPS年值'}` + `pe_central{order:2,op:'×',out:'V'}` 加 step;revenue_growth/net_margin 留命门审计。扩 `migrate-card-schema.mjs`。
- agent prompt:非 canonical 模型用 `custom` + 声明 `step`(逐步把命门串成恒等式)。
- `card-tools` zod:加 `step` + `'custom'`。`store` 校验:custom 须 ≥1 step 且末步 `out==='V'`(可算)。

## 6. 范围 / 非目标

- 只做**线性乘除链**(custom 折叠);dcf/ddm/pb-roe/nav 内置不碰。
- 不做公式求值器、不做多输入派生 DAG(YAGNI;eps 卡的 revenue/margin 作定性命门即可)。
- 决策面其余四段(claim/安全边际/决策/健康)不变。

## 7. 验收

- eps 卡:决策面 B2 显 `EPS 3.76 × PE中枢 20 = ¥75.2`,每步中间量可见(不再"恒等式待补")。
- byd 卡:仍 6 步阶梯 + 校准期旧→新。
- 任意 custom 卡:逻辑→锚→估→逐步中间量→V 全程可见;缺值标红不臆造。
- `typecheck` 0 新错;invest 测全绿 + 新增 custom 折叠"触发/缺值"两测。
