> ⚠️ **已被取代**:本方案升级为平台级 Feature 架构,见 `docs/talor-feature-architecture.md`(标的卡 UI = 其中 invest Feature 的 Artifact 投影,§4–5)。本文保留作演进记录。

# 标的卡 UI 渲染 — 完整实施方案(A + B)

> 补齐"建卡 / 获取卡 / **展示卡**"闭环里缺失的**渲染层**。依据:requirements §1.8 **AC-9** + mvp-design §9.4。
> **架构纠正(关键)**:卡渲染是**独立的、由 card 数据驱动的 UI**,**不是 agent 在 prose 里 emit 的 talor block**。
> 卡是一等数据实体(card-repo = 单一真相);UI 独立读它渲染;LLM 只通过 **card 工具写**,**不**通过文本 emit 卡。
> 因此:talor block 协议(schema / parser / UiBlockPlugin)**完全不动**。

---

## 0. 缺口、AC 与架构判定

**AC-9 原文**:卡以 **chip(对话流)/ 案卷(右侧)两态**呈现;时间线可跳转查看历史快照(只读 + as_of);决策经对账(强制理由、情绪型软拦)。

| 环节                           | 现状           | 本方案                    |
| ------------------------------ | -------------- | ------------------------- |
| 建卡 / 获取卡(工具)            | ✅ 写读 SQLite | 不动                      |
| **展示卡(渲染)**               | ❌ 全缺        | A:对话流内嵌卡(chip⇄展开) |
| **常驻案卷 + 时光机 + 三介入** | ❌ 全缺        | B:右侧案卷面板            |

**为什么"独立渲染"而非 block(纠正上一版)**:

- 卡数据已是结构化一等实体(`stock_cards` + `card_timeline`),渲染只需**读数据**,无需 LLM 把卡内容序列化成 block JSON(既膨胀、又制造"卡有两份真相")。
- 渲染层**已能拿到 card 工具的调用结果**:`message.content` 含 `ToolUseBlock`/`ToolResultBlock`,`create_card` 结果含 `id`、`append_*` 入参/结果含 `card_id`。→ 系统据此**自行**在对应位置渲染卡 chip,不依赖 LLM emit。
- 案卷面板更是纯数据视图:独立读 card-repo,与对话流解耦。
- 对照 AC-9:chip + 案卷两态仍满足,但**渲染来源 = card-repo 数据 + 工具调用检测**,不是 talor block。

**关键约束(贯穿)**:

- 卡标识 = `代码-日期-唯一`,所有读取严格按精确 id;UI 拿到的 id 来自 card 工具结果,不自造。
- card-repo = 单一真相;UI 经 IPC 现拉,不缓存第二份。
- 历史快照只渲染其自身 payload,不 merge 后续 → §11 无后视镜在 UI 自动成立。
- 全程**非荐股**:只展示 + 质询一致性,无方向性买卖 CTA。

---

## 1. 公共前置(A、B 共用)

### 1.1 暴露 CardRepo 单例 — `src/main/invest/register.ts`

```ts
let cardRepo: CardRepo | null = null
export function registerInvestFeature(db: Database): void {
  if (registered) return
  createCardTables(db)
  cardRepo = new CardRepo(db)
  for (const t of createInvestTools({ repo: cardRepo })) {
    if (!toolRegistry.getTool(t.name)) toolRegistry.register(t)
  }
  registered = true
}
/** 供 cards IPC 只读。启动期 registerInvestFeature 后可用。 */
export function getCardRepo(): CardRepo {
  if (!cardRepo) throw new Error('invest feature not registered')
  return cardRepo
}
```

### 1.2 卡类型迁到 shared — 新建 `src/shared/types/invest.ts`

把 `repo/types.ts` 的 `CardHead / CardStatus / Fact / Fulcrum / FulcrumStatus / Judgment / Snapshot / Decision / Review / TimelineEntry` 迁到 `shared/types/invest.ts`;`repo/types.ts` 改为 re-export(`export * from '@shared/types/invest'`)。
原因:renderer 要类型安全消费卡,但不能反向依赖 main。

### 1.3 cards IPC(只读)— 新建 `src/main/ipc/cards.ts`(范式 `ipc/skills.ts`)

```ts
import { ipcMain } from 'electron'
import { getCardRepo } from '../invest/register'

export function registerCardHandlers(): void {
  ipcMain.handle('cards:get', (_e, id: string) => getCardRepo().getCard(id)) // CardHead | null
  ipcMain.handle('cards:timeline', (_e, id: string) => getCardRepo().getTimeline(id)) // TimelineEntry[]
  ipcMain.handle('cards:latest', (_e, id: string) => getCardRepo().getLatestSnapshot(id)) // Snapshot | null
}
```

- `index.ts`:`registerInvestFeature(getDb())` 之后 `registerCardHandlers()`。

### 1.4 preload + renderer api

- `preload/index.ts` talorAPI 加 `cards: { get, timeline, latest }`(`ipcRenderer.invoke('cards:...')`)+ 同步 `.d.ts`(类型用 shared/types/invest)。
- `renderer/api/talorAPI.ts` 封装。

### 1.5 从消息提取 card 触达 — 新建 `src/renderer/lib/card-refs.ts`(纯函数,可测)

```ts
// 扫一条/一组 message 的 content,提取被 card 工具触达的 card_id(去重,保序)。
// create_card → 结果含 id;append_snapshot/decision/review、get_card → 入参/结果含 card_id。
export function extractCardRefs(content: ContentBlock[]): string[]
```

这是"独立渲染"的锚:**系统从工具调用结果得知本轮碰了哪些卡**,据此渲染——不依赖 LLM emit。

---

## A 阶段:对话流内嵌卡(独立渲染,端到端"看得到卡")

### A1. 内嵌卡组件 — 新建 `src/renderer/components/invest/StockCardInline.tsx`

- props: `{ cardId: string }`(由 A2 从消息提取并传入)。
- 挂载 `useEffect` → `talorAPI.cards.get(cardId)` + `cards.latest(cardId)`;loading / not-found / 正常三态。
- **Chip(默认收起)**:`{code} {name} · status badge · 逻辑健康度🟢🟡🔴 · 一句 thesis`。
  - 健康度 = 最新快照所有支点状态汇总(纯函数 `summarizeHealth(snapshot)`:全 holding→🟢 / 有 shaken→🟡 / 有 broken→🔴)。
- **展开(点 chip)**:两区 —— 事实区(折叠,按 stock/industry/macro 分组)+ 判断区(展开,每条判断 conclusion + 其 fulcrums:statement / ref / 状态色)。
- 纯只读;无买卖 CTA。

### A2. 在消息流挂载内嵌卡 — 改 `src/renderer/components/MessageBubble.tsx`

- 用 `extractCardRefs(message.content)` 取本条消息触达的 card_id;在该 assistant 消息**末尾**渲染对应 `<StockCardInline cardId=...>`(去重,每卡一个)。
- 不改 talor block 渲染路径;这是**并行的、数据驱动的**附加渲染。

### A3. (可选)轻量引导 — agent prompt

不新增 block。可在主理 `prompt.md` 提一句"建/复查卡后,卡会自动在对话流以 chip 呈现,你只需用 card 工具落库,不必复述卡内容"。**无 schema/parser/UiBlockPlugin 改动**。

### A 阶段验证(退出标准)

`[用户触发建卡] → [该轮回复末尾出现卡 chip(代码+状态+健康度+thesis),点开看到事实区/判断区/支点状态色]`

- 单测:`extractCardRefs`(create/append/get 各场景提取 card_id);`summarizeHealth`(全 holding→🟢 / 含 broken→🔴);cards IPC(注入 fake repo)。
- 手验:运行 app,主理建卡 → chip 渲染 → 展开两区。

---

## B 阶段:右侧常驻案卷 + 时光机 + 三介入(§9.4 完整态)

### B1. 布局 — 改 `src/renderer/pages/Chat/index.tsx`

左对话 + 右**可收起案卷面板** `CaseFilePanel`。当前卡 = 本会话最近触达的 card(`extractCardRefs` 扫全会话消息取最新),或点对话流 chip 切换选中。

### B2. 案卷面板 — 新建 `src/renderer/components/invest/CaseFilePanel.tsx`

读 `cards:get` + `cards:timeline`(全时间线)。布局(§9.4):

- **时间线轨**:`● snapshot`(摘要=健康度变化)/ `◆ decision`(加减@价+理由,**情绪型理由标红**)/ `★ review`(四象限+lesson),按 at 升序。
- **主区时光机**:默认=最新快照(当前态);点历史节点 → 主区切到该快照(只读+标 as_of),"回到当前"返回。全快照已存,跳转即渲染 → 无后视镜自动成立。
- **派生支点视图**(`FulcrumHealthList`):全部判断的支点**按事实去重**汇总成"命门清单 + 健康度🟢🟡🔴",一眼扫"逻辑还成立吗"。
- 不做快照可视化对比(留 v2)。

### B3. 三个主动介入(均独立渲染 / 面板交互,非 LLM block)

| 介入         | 渲染/交互                                                                                                                        | 数据来源                        | 边界                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **跟踪提醒** | 对话流 alert chip(`extractCardRefs` 命中 + 最新快照有 `delta_vs_prev.fulcrum_shifts`/支点转 shaken)+ 案卷高亮                    | card-repo(支点状态/delta)       | 只推**支点层**变化,不推盘面;MVP 降级"打开案卷主动复查",后台 push 留 v2                                 |
| **决策对账** | **案卷内"决策"动作 → 弹对账表单**:列「当初支点 vs 现在」+ 强制理由输入 + **情绪型理由软拦**("要不要再想想",可 override 照实记录) | card-repo(当前 vs ref_snapshot) | 质询一致性**不评方向**(非荐股);确认 → 经 `talorAPI`/工具链调 `append_decision`(reason 必填校验在 repo) |
| **复盘对账** | 案卷 review 节点 + 复盘对话                                                                                                      | card-repo(timeline 重放)        | 对过程不对结果;四象限归因 + lesson                                                                     |

> 决策对账是**面板内的独立交互表单**(读卡数据 + 收集理由 → 调 append_decision 工具),不是对话里 LLM emit 的 need_input block。

### B4. 跟踪触发(MVP 降级)

打开案卷 → 主理跟踪模式遍历支点产出新快照(delta)→ 案卷渲染 fulcrum_shifts 高亮 + 对话流 alert chip。无后台定时器。

### B 阶段验证(退出标准)

- `[打开某卡案卷] → [右侧见两区 + 时间线轨;点历史节点主区切只读快照;命门清单显示支点健康度]`
- `[案卷内发起决策] → [弹对账表单:当初vs现在 + 强制理由 + 情绪型软拦,确认后 append_decision 落库,时间线出现 ◆ 节点]`

---

## 4. 风险与陷阱(Gotchas)

| ⚠️                                  | 正确做法                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| 把卡做成 LLM emit 的 talor block    | ❌ 不做。卡是数据驱动的独立渲染;LLM 只用 card 工具写;schema/parser/UiBlockPlugin 不碰 |
| renderer 反向依赖 main 的 repo 类型 | 卡类型迁 `shared/types/invest.ts`,两端共用                                            |
| 把整卡塞进消息/block(双真相 + 膨胀) | UI 只拿 card_id,数据经 IPC 现拉(单一真相 = card-repo)                                 |
| 历史快照渲染掺入后续信息            | 时光机严格渲染该 snapshot 自身 payload                                                |
| 决策对账绕过校验直接写库            | 确认动作走 `append_decision` 工具(reason 必填等校验在 repo)                           |
| 出现荐股/买卖 CTA                   | 全程非荐股:只展示 + 质询一致性                                                        |
| card_id 用代码/模糊匹配             | 严格按精确 id(来自 card 工具结果)                                                     |

## 5. 文件清单

**公共前置**:改 `invest/register.ts`、`main/index.ts`、`preload/index.ts`、`renderer/api/talorAPI.ts`;新建 `main/ipc/cards.ts`、`shared/types/invest.ts`(类型迁移,`repo/types.ts` re-export)、`renderer/lib/card-refs.ts`。
**A 阶段**:新建 `renderer/components/invest/StockCardInline.tsx`;改 `MessageBubble.tsx`。
**B 阶段**:新建 `renderer/components/invest/{CaseFilePanel,Timeline,FulcrumHealthList,DecisionReconcile}.tsx`;改 `pages/Chat/index.tsx`。
**测试**:`card-refs`(提取)、`summarizeHealth`(健康度)、cards IPC(fake repo)、时光机快照切换(只读)。
**不改**:`shared/talor-blocks/*`、`UiBlockPlugin.ts`、`TalorBlockRenderer.tsx`(卡不走 block)。

## 6. 实施顺序

公共前置(getCardRepo → 类型迁移 → cards IPC → preload/api → card-refs)→ A1 内嵌卡组件 → A2 挂载 → A 手验 → B1 布局 → B2 案卷+时光机 → B3 三介入 → B4 跟踪降级 → B 手验。

> A 独立可交付(对话流看到卡 chip/展开);B 在 A 之上加右侧常驻案卷与三介入。

## 7. 设计文档一致性

mvp-design §9.4 "Talor 落地"段写的"复用 TalorBlockRenderer,新增 block 类型 stock_card / tracking_alert / decision / review" 与本纠正冲突 —— 卡**不走 block**。实施时需把 §9.4 该句改为"独立卡组件(读 card-repo)+ 案卷面板;不新增 talor block 类型"。
