# Talor Feature 架构 — 业务对象融入平台(完整方案 · 含 invest 实例)

> **目标**:任意业务(投资卡片 / 机器人 …)以 Feature 融入 Talor,同时:① 平台业务无关(可独立)② LLM 经**指令(工具)**正确操作业务对象 ③ 页面独立渲染业务对象。
> **设计基调(经讨论收敛)**:面向接口 + 低耦合 + **声明式契约,平台拥有注册**。一个 Feature = 一类业务的完全封装,声明**五类贡献(agent / tool / mcp / ui / 数据读口)**;平台只依赖 `TalorFeatureMain` / `TalorFeatureRenderer` 接口,经 `installFeatures` 统一注册。加新业务 = 实现两半接口 + 组合根各登记一行,平台核心零改动。抽象三件(对象 / 读 / 渲染),写不抽象成通用 CRUD(写=工具);对象读写一律走 LLM 指令,不做平台自动注入/溯源/焦点。

---

## 1. 原理:对象一份真相,三种投影,LLM 经指令

业务对象 = **唯一真相的共享资源**(store),会话只**引用**它(传 id,不传内容)。它对三方各是一个投影:

| 投影         | 给谁     | 怎么来                           | 进上下文/界面的是 |
| ------------ | -------- | -------------------------------- | ----------------- |
| **写(指令)** | LLM→对象 | **工具**(domain 校验 + 强 id)    | 工具结果回执切片  |
| **读(指令)** | LLM←对象 | **get 工具**(LLM 自己决定何时读) | 请求的切片        |
| **渲染**     | 人←对象  | feature 组件(读自有 IPC)         | 富 UI(静态/活)    |

铁律:**LLM 永不持整对象、不持真相、不产 UI、不产渲染**;它只发意图(工具)+ 按需读切片。真相只在 store。

> 不做的事(经讨论否决,避免平台机器堆积与越权):平台**不**自动往 prompt 注入对象(违背"LLM 经指令读");**不**建 focus 绑定 / `artifact_refs` 溯源 / `resolveRootSession`。"跨轮记住在搞哪张卡" = 对话历史 + 已有 memory anchor(agent 自记),不新造平台件。

---

## 2. 三个框架级抽象(card 与 robot 共同基座)

`src/shared/artifact/types.ts`(纯抽象,无实现):

```ts
// ① 业务对象:最小恒等(一切对象的基)
export interface Artifact {
  readonly id: string
  readonly type: string
}

// ② 存储端口(main 侧):读 + 写 + 可选订阅都在一个抽象里
export interface ArtifactStore<T extends Artifact = Artifact, Cmd = unknown> {
  read(id: string): T | null
  subscribe?(id: string, onChange: (t: T) => void): () => void // 活对象(robot)实现;静态(card)不实现
  apply(cmd: Cmd): T // 写:统一入口;Cmd 按 feature 定型;返回写后当前态;domain 校验在实现内按 cmd.kind 分发
}

// ③ 渲染端口(renderer 侧):按 type 注册的 UI;chip 从消息自识别,panel 渲选中 id
export interface ArtifactUI {
  type: string
  Inline?(props: { message: ChatMessage; onSelect: (id: string) => void }): UINode | null // 对话流 chip
  Panel?(props: { id: string }): UINode // 案卷/面板
}
```

**读写都抽象,但不造假 CRUD**:写的**形状**统一(`apply`),写的**内容**按业务定型(`Cmd` 联合)。卡的 `{kind:'appendSnapshot'}` 与机器人的 `{kind:'moveTo'}` 是各自的命令,经各自 `apply` 实现校验+落库;返回写后当前态(read-after-write,统一返回 `T`)。

**写仍走工具**(不冲突):工具 = "LLM 意图 → Cmd → `store.apply`" 的薄适配器;校验集中在 `apply`。读工具 = `store.read`。"写的 LLM 暴露面"仍是 `ToolDefinition`。

`subscribe?` 可选 capability:card 不实现(pull 快照),robot 实现(push 流)——抽象不强加"卡形状(pull-only)",活对象自然落位。

---

## 3. 平台新增:几乎归零(只一个 UI 槽)

操作平面已成立(`toolRegistry` + risk-gate + `ToolErrorEnvelope` + domain 校验 + compute 确定性),**不动**。读写全走工具。平台**唯一新增 = UI 挂载槽**:

`src/renderer/artifacts/registry.ts`(新):

```ts
class ArtifactUIRegistry {
  register(ui: ArtifactUI): void
  all(): ArtifactUI[]
  get(type): ArtifactUI | undefined
}
export const artifactUI = new ArtifactUIRegistry()
```

两个挂载点(均按 `type` 派发,平台不认识具体业务):

- **对话流(inline)**:`MessageBubble` 对每条消息调所有 `artifactUI.all()` 的 `Inline(message)`,渲出 chip;点击 → `openArtifact(type,id)` 派发通用 `artifact:open` 事件。
- **案卷面板(panel)**:平台 `ArtifactDrawer`(`renderer/artifacts/`)听 `artifact:open` → `artifactUI.get(type).Panel({id})` 渲右侧抽屉(低耦合,不穿 props 链)。

> 平台**不认识** card/robot:只认 `ArtifactUI.type` 字符串 + 抽象组件;不读对象数据(组件自己经 feature IPC 取)。

---

## 4. Feature 契约 + 启动融合

### 4.0 理念:一个 Feature = 一束完整业务(四支柱 · agent 中枢 · 单一真相)

平台核心**无任何业务**;一个业务以 **Feature** 整体接入,**四支柱**缺一不可:

```
① 数据  init 建表 + ArtifactStore(read/apply)      —— 业务数据(一份真相)
② agent agents(): FeatureAgent[](profile + 工具)    —— 谁来操作(连其工具,内聚声明)
③ 读口  artifacts(): FeatureArtifact[](按 type)     —— UI 怎么取数(平台通用 artifact:read 路由)
④ 渲染  TalorFeatureRenderer.ui(): ArtifactUI[]      —— 怎么呈现(renderer 半)
（+ mcpDeps() 声明依赖的 MCP server,installFeatures 校验缺失即告警)
```

**feature 只声明,平台拥有注册**:feature 的 `agents()` / `artifacts()` 返回**纯数据**(可枚举 / 可测);平台 `installFeatures` 经 `FeaturePorts` 逐条注册(`registerFeatureAgent` / `registerArtifactReader`),校验 / 去重 / origin 都在平台一处。

**agent 与工具内聚**:`FeatureAgent = { profile, tools? }` —— agent 声明时连它的工具一起给,平台注册时把 tools 作为 per-agent `featureTools` 注入(不进全局 builtin)。

**注册 Feature = fan-out**:`installFeatures` 对每个 Feature 依次 init(建数据)→ agents(声明,平台 registerAgent)→ artifacts(声明读口,平台 registerArtifactReader)→ registerIpc → mcpDeps(校验);renderer 半另注册 ArtifactUI。

**关键不变量**:

- **工具作用域化(S1)**:featureTools **不进全局 builtin**,按 agent 注入 `agentTools` → `__chat__` 等通用 agent **拿不到业务工具**,只能 `delegate_agent` 给业务 agent(领域入口自然收敛,方法论 prompt 必生效)。
- **对象根归属(S3)**:对象 `create` 的 origin 取**根会话**(沿 parent_session 链),委托子会话建的对象仍归用户主会话 → 跨委托树幂等 + 归属正确。

### 4.1 契约

```ts
// src/main/features/types.ts
export interface FeatureInitCtx {
  db: Database
} // init 建数据用
export interface FeatureAgent {
  profile: AgentProfile
  tools?: ToolDefinition[]
} // agent + 其工具(内聚)
export interface FeatureArtifact {
  type: string
  read(id: string): unknown
} // 业务对象读口(按 type)

export interface TalorFeatureMain {
  id: string
  init(ctx: FeatureInitCtx): void // ① 建表 + 构造 store(只数据)
  agents?(): FeatureAgent[] // ② 声明 agent(连工具),平台注册 origin=feature
  artifacts?(): FeatureArtifact[] // ③ 声明读口,平台经通用 artifact:read 暴露
  registerIpc?(): void // 其他自有 IPC(读口走 artifacts() 时可省)
  mcpDeps?(): { name: string; hint: string }[] // 依赖声明(installFeatures 校验)
  dispose?(): void // 预留:停用注销
}
// 平台注入给 installFeatures 的注册端口(feature 看不到,保持只声明)
export interface FeaturePorts {
  registerAgent(agent: FeatureAgent): void
  registerArtifactReader(artifact: FeatureArtifact): void
  isMcpConfigured(serverName: string): boolean
}
export interface TalorFeatureRenderer {
  id: string
  ui(): ArtifactUI[]
} // ④ 渲染:注册 ArtifactUI
```

组合根(唯一认识业务的地方):

```ts
// main index.ts(app.whenReady)—— 唯一认识具体业务的地方
agentManager.init({ ...deps, agentsDir }) // 平台 + 用户池 agent 先就位
const artifactReaders = new ArtifactReaderRegistry()
ipcMain.handle('artifact:read', (_e, { type, id }) => artifactReaders.read(type, id)) // 通用读口
const FEATURES: TalorFeatureMain[] = [investFeatureMain]
installFeatures(
  FEATURES,
  { db: getDb() },
  {
    registerAgent: (fa) => agentManager.registerFeatureAgent(fa.profile, fa.tools ?? []), // 内存注册,不落盘
    registerArtifactReader: (a) => artifactReaders.register(a),
    isMcpConfigured: (name) => mcpServerRepo.list().some((s) => s.name === name),
  },
)
// renderer bootstrap(main.tsx)
const RENDERER_FEATURES: TalorFeatureRenderer[] = [investFeatureRenderer]
for (const f of RENDERER_FEATURES) for (const ui of f.ui()) artifactUI.register(ui)
```

> 演进说明(依次取代):① `seedAgents(){id,dir}[]`(dir-based)→ `agents(): AgentProfile[]`(嵌入式);
> ② 方案3 工具进全局 builtin → S1 作用域化注入(防泄漏);
> ③ feature agent "幂等种到 ~/.talor/agents" → **内存注册**(参考平台 agent;feature 自管、升级随码、卸载随移除;用户池保持纯 Crystallizer);
> ④ **声明式收口(当前)**:`agents()` 改返 `FeatureAgent{profile,tools}`(agent 与工具内聚)、新增 `artifacts()` 读口 + 平台通用 `artifact:read`;`installFeatures` 不再聚合返回,改经 `FeaturePorts` 由平台逐条注册(`registerFeatureAgent` / `registerArtifactReader`)。**feature 只声明、平台拥有注册**。
> fork 定制:用户在用户池放同 id 副本即覆盖 feature 版(feature 注册时同 id 已存在 → 跳过)。

---

## 5. invest 作为第一个完整 Feature(结合投资业务实例化)

### 5.1 对象存储抽象(feature 内 DIP)— `src/main/invest/store.ts`

```ts
// 卡 = ArtifactStore<CardBundle, CardCmd>:读写都在一个抽象里
export type CardBundle = { head: CardHead; timeline: TimelineEntry[]; latest: Snapshot | null }
export type CardCmd =
  | { kind: 'create'; code: string; name: string; originSessionId: string }
  | { kind: 'appendSnapshot'; id: string; snapshot: Snapshot }
  | { kind: 'appendDecision'; id: string; decision: Decision }
  | { kind: 'appendReview'; id: string; review: Review }

export class CardRepo implements ArtifactStore<CardBundle, CardCmd> {
  read(id): CardBundle | null {
    /* head + timeline + latest;无 subscribe(静态文档) */
  }
  apply(cmd: CardCmd): CardBundle {
    /* switch(cmd.kind):create 戳 origin_session_id / append* 校验 BR;return read-after */
  }
  // 面板回退:listBySession(sid) 作为附加方法(非抽象的一部分)
  listBySession(sessionId: string): CardHead[]
}
```

- **card 工具** 依赖抽象 `ArtifactStore<CardBundle, CardCmd>`(不依赖 sqlite)。
- **读** = `store.read(id)` → `CardBundle`(无 subscribe,卡是静态文档)。
- **写** = `store.apply(cmd)`;校验(BR:判断挂支点/reason 必填…)在 `apply` 内按 `cmd.kind` 分发。
- **对象↔会话关联在 create 时成立**:`create_card` 工具拿 `ctx.sessionId` → `store.apply({kind:'create', …, originSessionId: ctx.sessionId})` → 卡库存 `origin_session_id`;create 结果落进该 session 持久 transcript。**不引入平台溯源/focus**。

### 5.2 stock_card 满足三抽象 + 写工具

- `Artifact`:`{ id:'002594-20260612-xxx', type:'stock_card' }`(强标识=代码-日期-唯一)。
- 读:`store.read(id)` 返 `CardBundle`;无 `subscribe`(静态文档)。
- 写工具(LLM 指令)= 薄适配器,**建 `CardCmd` → `store.apply`**:`create_card`(`{kind:'create',…}`)/ `append_snapshot` / `append_decision` / `append_review`;读工具 `get_card / get_timeline` → `store.read`。校验在 `apply` 内(BR)。
- `create_card` 的 `execute(input, ctx)` 读 **`ctx.sessionId`** → `store.apply({kind:'create', …input, originSessionId: ctx.sessionId})`,完成对象↔会话关联。

### 5.3 读口经平台通用 IPC(给 UI)

invest 不自开 IPC,改在 `artifacts()` 声明读口:

```ts
artifacts: () => [{ type: 'stock_card', read: (id) => cardStore.read(id) }] // CardBundle | null
```

平台 `ArtifactReaderRegistry` 按 type 收口 → 通用 `ipcMain.handle('artifact:read', {type,id})` 路由;preload + `renderer/api` 封装 `talorAPI.artifact.read('stock_card', id)`。**加 Feature#2 的读口零改平台 IPC**。

### 5.4 main/renderer feature 清单

```ts
investFeatureMain = {
  id: 'invest',
  init({ db }) {
    createCardTables(db)
    investStore = new CardRepo(db)
  }, // 只建数据
  agents: () => INVEST_SEED_AGENTS.map((p) => ({ profile: p, tools: investTools })), // 5 agent 连 23 工具
  artifacts: () => [{ type: 'stock_card', read: (id) => investStore.read(id) }], // 读口
  mcpDeps: () => [{ name: 'Playwright', hint }],
}
investFeatureRenderer = { id: 'invest', ui: () => [stockCardUI] } // stockCardUI: {type:'stock_card', Inline, Panel}
```

---

## 6. 标的卡 UI(invest 的 ArtifactUI 实现)

`src/renderer/invest/stockCardUI.tsx`:

- **`Inline(message)`**:扫 `message.content` 的工具结果,命中 `create_card/get_card/append_*` → 取 card_id → 渲 chip(`code name · status · 健康度🟢🟡🔴 · thesis`);点击 `onSelect(id)`。健康度 = `summarizeHealth(latest)` 纯函数。
- **`Panel({id})`**:`talorAPI.artifact.read('stock_card', id)` 取 `CardBundle` → 渲案卷(§9.4):
  - **两区**:事实区(折叠,stock/industry/macro)+ 判断区(每判断 conclusion + fulcrums:statement/ref/状态色)。
  - **时间线时光机**:`●snapshot ◆decision ★review`(at 升序);点历史节点 → 主区切该 snapshot(**只读 + as_of**,只渲该节点 payload,无后视镜);"回到当前"。
  - **命门清单**:全判断支点按 ref 事实去重 + 健康度。
  - **决策对账**(面板内交互表单,非 LLM):列「当初支点 vs 现在」+ 强制理由 + 情绪型软拦 → 确认调 `append_decision`(经工具链,reason 必填在 repo)。**非荐股,不评方向**。
- **当前卡 = 用户点选**(UI state `selectedArtifact`);默认可选最近一个 inline chip。

---

## 7. 泛化验证:机器人对象**基于同一基座**(证明不是为卡定制)

|                    | 投资卡片                                          | 机器人(将来)                                  |
| ------------------ | ------------------------------------------------- | --------------------------------------------- |
| `Artifact`         | `{id, type:'stock_card'}`                         | `{id:'arm-01', type:'robot'}`                 |
| `ArtifactStore`    | `read`=卡快照 + `apply(CardCmd)`,**无 subscribe** | `read`/`subscribe`=遥测流 + `apply(RobotCmd)` |
| `ArtifactUI.Panel` | 案卷(两区+时光机)                                 | 实时仪表盘(订阅关节/相机)                     |
| store 实现         | `CardRepo`(sqlite)                                | `RobotConn`(活连接)                           |
| 写工具             | create/append\_\*(校验:支点/理由)                 | move_to/grasp(校验:限位/碰撞/急停)            |
| 读工具(LLM)        | `get_card`                                        | `get_robot_state`                             |

**平台 / `shared/artifact` 基座 / 其它 feature 零改动**;robot 实现 `subscribe` 即获得实时渲染——`subscribe?` 可选这一设计让活对象天然落位。

---

## 8. 对象 ↔ 会话关联(不引入平台溯源)

对象是跨会话的一等实体(S0 建 → S5 跟踪 → S9 复盘),**不归属单个会话**;会话只按 id 引用它。关联落在两个**现成事实**上:

1. **创建即关联(显式)**:`create` 工具执行时手握 `ctx.sessionId` → 戳 `origin_session_id` 在对象上(feature 库)。"某会话出生的卡" = `listBySession(sid)`。
2. **transcript 自然留痕(持久)**:create/append/get 的工具结果含 id,**持久化在该会话 messages**(LLM 上下文压缩不动 DB transcript)。"某会话用过哪些卡" = 扫该会话 transcript 的 card 工具结果(`Inline` 自识别)。

**两者都不需要平台溯源表 / focus 绑定。** 创建答 ①,跨会话引用答 ②。

**子会话边界**:

- invest **不踩**:卡由主理(= 用户会话)create/维护,specialist 只回事实、不碰卡 → `origin_session_id` = 用户会话,transcript 也在用户会话。
- 通法(将来"子会话改对象"):`ctx.sessionId` = 子会话;要在父会话浮现,**delegate 指令把目标会话 id 传下去**(戳父会话)或 **delegate 返回带 `produced:{type,id}`**(父 LLM 看到 → 需要就 get)。仅此场景可能需要一个会话血缘 helper,invest 用不到。

---

## 9. 实施分阶段

| 阶段                       | 内容                                                                                                                                                                                                                                                           | 退出标准                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **P1 抽象基 + 平台 UI 槽** | `shared/artifact/types.ts`(三抽象)+ `shared/types/feature.ts` + `renderer/artifacts/registry.ts`(UI 槽)+ `MessageBubble` inline 派发 + `Chat` panel 槽 + FEATURES 循环                                                                                         | 空 feature 注册不报错;槽可挂占位组件                                                                                                |
| **P2 invest 接入**         | `CardRepo implements ArtifactStore<CardBundle,CardCmd>`(read/apply)+ **`stock_cards` 加 `origin_session_id`** + `listBySession` + 工具改"建 Cmd→apply" + 类型迁 `shared/types/invest.ts` + `invest:card:read` IPC + feature 清单(取代 register.ts)+ seedAgents | 单测:`read`/各 `apply(cmd)`、**create 戳 origin_session_id / listBySession 命中**、BR 校验仍拦;启动种 agent;建卡后 read 拿到 bundle |
| **P3 案卷面板(主交付)**    | `stockCardUI.Panel`(两区+时光机+命门清单+决策对账)+ Chat 右栏                                                                                                                                                                                                  | 手验:点卡→案卷两区+时间线;历史节点只读切快照;决策对账→append_decision 落库                                                          |
| **P4 对话流 chip**         | `stockCardUI.Inline`(扫消息识别+chip)+ `summarizeHealth`                                                                                                                                                                                                       | 手验:建卡轮出 chip,点开/点选进面板                                                                                                  |
| **P5 跟踪介入**            | 复查产 delta → 命门清单高亮 + chip 提示(数据驱动,MVP 打开主动复查)                                                                                                                                                                                             | 手验:复查后支点状态变                                                                                                               |
| **P6 L1 沉淀**             | standards/patterns/overview 补 Feature+三抽象;"如何新增业务对象"指南                                                                                                                                                                                           | 文档                                                                                                                                |

P1→P2 打通"工具读写 + UI 能读卡";P3 出主交付;P4/P5 增量;P6 固化。

---

## 10. 风险与边界(Gotchas)

| ⚠️                            | 正确做法                                                     |
| ----------------------------- | ------------------------------------------------------------ |
| 把写抽象成通用 CRUD/schema    | ❌ 写=工具(per-业务签名+校验);只抽象 对象/读/渲染 三件       |
| 抽象假设"卡形状"(pull-only)   | `subscribe?` 可选;活对象(robot)实现它                        |
| 平台自动往 prompt 注入对象    | ❌ 不做;LLM 经 get 工具自取;跨轮记忆用 memory anchor         |
| 平台建溯源/focus 绑定         | ❌ 不做;UI 当前卡=用户点选;子产物=delegate 返回带 id         |
| renderer 反向依赖 main repo   | 卡类型迁 `shared/types/invest.ts`;renderer 经 feature IPC 取 |
| 历史快照掺后续信息            | 时光机只渲该 snapshot payload                                |
| 决策对账绕过校验              | 经 `append_decision` 工具(reason 必填在 repo)                |
| 平台核心出现业务词            | 业务只在 feature 包 + FEATURES 两行;CI grep 自检             |
| 方案3 工具门禁(空 tools 泄漏) | 维持现状,per-agent 门禁留 v2                                 |

## 11. 文件清单

**平台新增**:`shared/artifact/types.ts`(三抽象)· `shared/types/feature.ts` · `renderer/artifacts/registry.ts`(UI 槽);改 `MessageBubble.tsx`(inline 派发)· `Chat/index.tsx`(panel 槽)· `index.ts`(main FEATURES)· renderer bootstrap(FEATURES)。
**invest 新增/改**:`main/invest/store.ts`(`CardRepo implements ArtifactStore<CardBundle,CardCmd>` + `CardCmd`)· `main/invest/feature.ts`(清单,并入 register.ts)· `main/ipc/invest.ts`(只读 IPC,调 store.read)· `shared/types/invest.ts`(类型迁移 + `CardBundle`/`CardCmd`)· `renderer/invest/stockCardUI.tsx`(Inline+Panel)· `renderer/invest/{CaseFilePanel,Timeline,FulcrumHealthList,DecisionReconcile}.tsx` · `renderer/invest/summarizeHealth.ts`;`repo/types.ts` re-export shared;card 工具改"建 Cmd→apply"。
**测试**:`store.read`/各 `apply(cmd)` + BR 校验、summarizeHealth、时光机只读快照、Inline 识别 card_id、create 戳 origin_session_id。
**不改**:`shared/talor-blocks/*` · `UiBlockPlugin` · `TalorBlockRenderer`(业务对象不走 block)· card-repo 校验 · compute(操作平面已成立)。

## 12. 设计文档一致性

本文取代 `docs/investment-agent/card-ui-rendering-plan.md`(其 §4–5 = 本文 invest 实例的早期版)。mvp-design §9.4 的"落地"以本文为准:**卡 = ArtifactUI 实现(Inline/Panel),读经 feature IPC,写经工具,不走 talor block、无平台溯源/自动注入**。
