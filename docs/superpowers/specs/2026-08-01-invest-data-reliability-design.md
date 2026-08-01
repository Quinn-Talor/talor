# Invest Agent 数据可靠性保障 — 设计文档

> 状态:draft(待评审)
> 分支:`feature/investment-agent`
> 覆盖三轴:数据来源(provenance)· 数据实效(freshness)· 数据准确性(accuracy)

---

## 1. 背景与诊断

### 1.1 问题的真实形状

对 `src/main/invest` 全链路(store / validators / fetch / tools / agents.ts prompt / 平台 loop 与 delegation 机制)做了 5 轮审计,其中 3 轮用可运行的探针测试直接跑通了绕过路径(非推测)。诊断收敛为一句话:

> **凡关于"提交内容形状"的规则都被代码强制了;凡关于"这个数从哪来"的规则,一条都没有。**

根因是**链路层**,不是校验器写得不够严:

```
stock-specialist 调 fetch_metric → {value, as_of, source, tier, provenance}   结构化
                                 ↓ 子 agent 把结果写成散文总结                  ← 结构在此销毁
stock-research(PM) 读散文 → 手打进 add_facts(连 provenance 一起重新"组装")     ← 校验器在这里检查
```

`delegate_agent` 只返回子 agent 最后一条 assistant 消息的纯文本([delegate-agent.ts:514](../../../src/main/agent/delegate-agent.ts:514)),父 agent 对子 agent 的工具调用/结果回调全是空函数([delegate-agent.ts:469](../../../src/main/agent/delegate-agent.ts:469))——父 agent physically 看不到子 agent 取了什么数。审计数出 **8 处 LLM 重打边界**,其中 6 处是这个形状。

`store.ts` 的校验器链([thesis-validators.ts](../../../src/main/invest/validators/thesis-validators.ts))校验的是"从散文里重构出来的东西",不是原始取数结果——所以无论校验器写得多严,这条链路上真正需要验证的信息早已丢失。

### 1.2 实测跑通的关键绕过(节选,详见附录 A 完整清单)

| #   | 绕过                                                                                                                                                                                                       | 实测结果                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | 编造 `co_share=99%` + 手写 `{method:'fetch', channel:'mcp:totally_made_up'}`                                                                                                                               | 拿到 `tier==='T1'`,成功立命门,零报错                                                      |
| 2   | `parseAsOfMonth` 是 `$` 锚定正则,遇到完整 ISO 时间戳(`2026-03-31T00:00:00.000Z`)返回 `null` —— 而 schema 明确要求 `as_of` 用 ISO 格式([card-tools.ts:77](../../../src/main/invest/tools/card-tools.ts:77)) | **模型老实按文档格式写,新鲜度闸门反而静默关闭**;11 年过期的锚顺利通过                     |
| 3   | 7 个 leaf 估值参数里 6 个用 `absolute` 凭空声明(非 core 参数不需要 anchor/fact/source)                                                                                                                     | `V = {466, 497, 528}` 冻结,真正的命门(有 `logic` 无 `step`)被排除在公式外                 |
| 4   | `gate:{state:'通行'}` 手写,无宏观事实、无 `compute_gate` 调用                                                                                                                                              | 建仓通过                                                                                  |
| 5   | `buy_trigger=0.12`(引擎正确算出)+ 手填 `price=9999, at_buy_point=true`                                                                                                                                     | 建仓通过——算出来的数字算完就被扔了                                                        |
| 6   | `crossCheck` 传两次同一个来源                                                                                                                                                                              | 返回"多源一致"                                                                            |
| 7   | 同 `as_of` 追加第二条不同值的观测(`addFacts` 只 append 不排序;`latestFactValue` 取数组末位)                                                                                                                | `V_now` 静默改变,新鲜度闸门(取 `as_of` 最大值)仍然满足——**闸门担保一个数,估值用另一个数** |

### 1.3 核对了项目自己的规范之后的结论

用 `vibe/project/standards.md` + `patterns.md`(共 ~2100 行)逐条核对了初版方案,发现 7 处会直接违反项目自己的 MUST/NEVER 规则,其中最严重的一条**让最初设想的核心机制失效**:

- `src/main/tools/registry.ts` 的 4-Phase 校验管线(zodSchema parse → validate → execute → verify)**不在运行时路径上**。实际调用链是 `build-tools.ts:139` → `agent-toolset.ts:203` → `tool.execute()` 直接执行,跳过 zod parse、`validate`、`verify` 三步。这套机制目前只在单测里生效。
- 后果:"把 `provenance`/`tier` 从 LLM 可写 schema 移除"是**空操作**——schema 只影响给 LLM 看的 JSON Schema,不影响运行时是否真的做了字段清理;`store.addFacts` 会原样收下模型继续发送的字段。这个设计本身还违反了项目自己的 `J-NEVER-1`(硬约束不能只靠 prompt/schema 层面的"不告诉它",必须代码兜底)。

这个发现把方案拆成了两个必须**顺序执行**的阶段:

> **先修平台的工具校验路径(Phase B),再做 invest 数据可靠性(Phase A)。**

用户已确认此顺序。

---

## 2. 设计原则

1. **不校验散文重构出来的东西,而是不让数据经过散文。** 取数工具的产出直接进卡,不经过"返回给 LLM → LLM 转述 → 另一个 LLM 转录"这条路。
2. **不让 LLM 声明可信,而是让它碰不到那个字段。** `provenance`/`tier` 不是"校验更严的输入",而是服务端职责,LLM 不应该有机会填错或造假。
3. **凡能从卡内已有数据算出来的,不收 LLM 的值。** 沿用项目已有先例(`V`/`buy_trigger` 已经是这么做的)。
4. **全部改动落在项目现有分层契约里。** 不新增表、不新增平台级钩子、不改 delegation 契约——每一处改动都要能对应到某个业务层文件已声明的"允许依赖"清单。
5. **规范冲突不自己拍板。** 遇到 `F-NEVER-1`(结构校验归 Zod)与"Zod 当前不生效"的冲突,先解决冲突源头(Phase B),不绕过。

---

## 3. Phase B — 接通平台工具校验路径

### 3.1 范围

`src/main/tools/registry.ts` 现有的 4-Phase 管线(zodSchema safeParse → `tool.validate` → `execute` → `tool.verify`)在设计上是对的,但从未接入真实调用链。真实链路是:

```
react-loop.ts:569  buildTools(...)
build-tools.ts:139 agent.toolRegistry.execute(name, input, execCtx)
agent-toolset.ts:203-219   直接 dispatch 到 tool.execute() —— 跳过 zod/validate/verify
```

Phase B 把这条真实链路改造成走 `registry.ts` 的完整管线(或把管线逻辑内联到 `agent-toolset.ts` 的 dispatch 点——由实施时按 DRY 原则决定单一实现位置,不允许两份逻辑并存)。

### 3.2 风险评估(已实测量化,不是猜测)

| 面                             | 结论                                                                        | 证据                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 结构校验(JSON Schema 部分)     | **增量风险低**                                                              | SDK 已经按 `z.toJSONSchema(zodSchema)` 生成的 JSON Schema 校验模型入参([build-tools.ts:91](../../../src/main/tools/build-tools.ts:91)),形状约束本来就在生效 |
| `.strict()`                    | **零处使用**                                                                | 全仓库 grep 无命中,未知字段是静默 strip 而非报错,不会因为模型多发字段被新增拒绝                                                                             |
| `.refine()` / `.superRefine()` | **10 处,是新增拒绝的唯一来源**(JSON Schema 表达不了 refine,现在全部失效)    | `bash.ts`(命令长度、危险命令)、`edit/write/read/glob/grep.ts`(非空校验、null 字节) —— 逐条读过,均为合理约束                                                 |
| `tool.verify`                  | **仅 2 个真实实现**,`read.ts:35`、`skill-tool.ts:59`,两者都恒返回 `ok:true` | 接线后不会有任何输出被 block                                                                                                                                |
| `tool.validate`                | **2 个真实实现**,见下                                                       | —                                                                                                                                                           |

### 3.3 顺手闭合的两处休眠安全检查

- **`bash.ts:121` 的工作区写重定向防护**(`checkWritePaths`):拦截 `echo x > /Users/别人/file` 这类越界重定向,已妥善放行 `/dev/`、`/tmp/`、`/var/folders/`。**现在从不执行。**
- **`bash.ts:105` 的 `.refine(s => !isCommandDangerous(s))`**:CLAUDE.md §4.4 要求"高风险工具前置黑名单,不靠用户 confirm 兜底",这条 refine 正是这个要求的实现,**现在是死代码**。

⚠️ 需要在实施时验证的开放问题:`RiskGate`(`risk-gate.ts:120`)另有一套独立的危险命令检测,与 `isCommandDangerous` 覆盖面是否重叠/等价未核实。`autoApprove` 默认 `true`(本项目配置也是 `true`)会把"需确认"降级为"放行并记账",但不会中和 `blocked:true`。Phase B 第一步的影子模式跑一轮后即可知道这条 refine 是否会产生新的真实拒绝。

### 3.4 实施步骤

1. **提取单一实现**:确保 `agent-toolset.ts` 的 dispatch 和 `builtin-registry.ts` 都走同一套 4-Phase 逻辑,不允许两份并存(DRY,对应 `F-MUST-2` 分层要求)。
2. **影子模式**:先只 `log.warn` "本次调用如果走完整管线会被拒绝在 Phase X,原因 Y",不真正拒绝。
3. **影子跑一轮真实会话**,覆盖 invest 建卡全链路(建立→跟踪→决策→复盘),收集所有会被新增拒绝的调用。
4. **按影子结果决定**:是调整过严的 refine,还是确认拒绝合理后转正。
5. **翻开强制**,单独 commit,message 引用 `F-MUST-2`(按 `standards.md:786` 偏离修复独立提交的要求)。

> **实施排序提示**:Phase B 和 Phase A 之间存在验证闸门——Phase B 第 3 步的影子模式结果会决定 Phase A 里"结构性检查放 Zod 还是留在业务层"的具体划分(§5),因此进入实施计划阶段时,两者宜拆成两份独立的实施计划顺序执行,而不是一份计划里的两个任务。

### 3.5 验收标准

- 影子模式跑完一轮 invest 全链路(至少覆盖:建卡、多轮 add_facts、命门锚立论、检查点、决策、复盘),记录所有"影子拒绝"事件。
- 每一条影子拒绝人工过一遍,归类为「合理新增防护」或「误伤需调整」。
- 转正后重跑全量测试(`npm test`)+ typecheck,确认无新增失败(pre-existing 失败需明确列出)。
- `bash` 的两个休眠检查(写重定向、危险命令)转正后各自补"触发+不触发"测试。

---

## 4. Phase A — Invest 数据可靠性

Phase B 完成后,`zodSchema` 真正生效,`F-NEVER-1`(结构校验归 Zod,不在 execute 里重复)才可以被正确执行。以下按 L1(来源)→ L2(准确性派生量)→ L3(实效+准确性其余部分)展开,每一条都已对照 `store.ts`/`card-tools.ts`/`fetch-metric.ts`/`valuation-trace.ts` 等文件头部声明的依赖契约修正。

### 4.1 L1 · Producer 即 Writer(治**来源**)

| #          | 设计                                                                                                                                                                                                                                                                                                                                                   | 落点(契约验证过)                                                                                                                                                                                                                                                                                                                         | 治什么绕过                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1-1       | `fetchMetric()` 保持纯函数不变;新增写卡组装函数放在 `tools/index.ts`                                                                                                                                                                                                                                                                                   | `tools/index.ts` 允许依赖 `../fetch/fetch-metric` **和** `../store`(唯一同时持有两者授权的文件);`fetch-metric.ts` 本身契约不变                                                                                                                                                                                                           | 取数结果不再经过 LLM 转述                                                                                                                                                                         |
| L1-2       | `store.addFacts` 对**每一条**观测的 `provenance`/`tier` 字段做**服务端无条件覆盖**:非服务端来源(即非取数直写路径产生)一律强制 `tier='T3'`,清空/忽略任何 LLM 提供的 `provenance` 声称                                                                                                                                                                   | `store.ts` 已有先例 —— [store.ts:353](../../../src/main/invest/store.ts:353) 的 tier 派生逻辑,注释是"不采信自报";扩展到 provenance 本身                                                                                                                                                                                                  | 编造 `provenance:{method:'fetch',...}` 骗取 T1(实测案例 1)                                                                                                                                        |
| L1-3       | 按 level 授权写卡范围(macro-research → `level:'macro'`;industry-research → `ind_*`/`level:'industry'`;stock-specialist → `level:'company'`),**在 agent 注册时用 per-agent 工具变体固化**,不在运行时查 `session.agent_id`                                                                                                                               | `feature.ts` 已有先例——[feature.ts:76-113](../../../src/main/invest/feature.ts:76) 的 `CARD_WRITE_TOOLS`/`deniedWriteTools`/`narrowTools` 就是这个机制,只是目前只做集合增删,没做"同名不同变体"。`FeatureAgent.tools` 本来就是 per-agent 数组([types.ts:31](../../../src/main/features/types.ts:31)),这是"available but unused"的平台能力 | 顺带修好接线矛盾:`macro-research` 的 prompt 明写要用 `add_facts`([agents.ts:145](../../../src/main/invest/agents.ts:145)),工具却被拿掉了([feature.ts:97](../../../src/main/invest/feature.ts:97)) |
| L1-4       | 可取数的 `metric_key`(`getMetricSource(key) !== null`)禁止手填,拒绝时用**预留错误码 `ANCHOR_MUST_FETCH`**([thesis-validators.ts:199](../../../src/main/invest/validators/thesis-validators.ts:199) 已预留此名),并通过扩展后的 `hint` 通道(见下)告知模型改调 `fetch_metric`;**若 `fetch_metric` 返回 `METRIC_UNAVAILABLE`,允许走"暂缺+原因"的手填路径** | 组装点同 L1-1                                                                                                                                                                                                                                                                                                                            | 堵住"偷懒手填一个本来能取到的数",同时不堵死 agent 在真实取数失败时的合法出口                                                                                                                      |
| L1-5       | 来源白名单:**不删除 `/compute/i`**,改为"仅当 `provenance.method==='compute'`(服务端盖章)才认 `source==='compute'`";新增黑名单先行(股吧/雪球/自媒体/记忆/推算/爬虫/未核实等关键词命中即拒);**白名单不改整串锚定**,维持子串匹配                                                                                                                          | `store.ts` 契约不变                                                                                                                                                                                                                                                                                                                      | 保留合法的 compute 派生事实(不破坏不变量③"价值由 compute 算");不误杀真实来源串(`上交所公告 2026-03-31 比亚迪年报`这类)                                                                            |
| L1-6(前置) | 扩展 `CardValidationError` 和 `envelope()` 携带可选 `hint` 字段,贯通到 `ToolErrorEnvelope.hint`                                                                                                                                                                                                                                                        | `card-tools.ts` 契约不变(`hint` 是 `ToolErrorEnvelope` 已有的可选字段,`patterns.md` P2 范式)                                                                                                                                                                                                                                             | L1-4 依赖这个通道才能实现"告诉模型怎么改"                                                                                                                                                         |

**明线**:T1/T2 只有一条路——代码去取。手填一律 T3;可取数的 key 连手填都不许(除非取数本身失败,允许"暂缺"路径)。

### 4.2 L2 · 落库重算(治**准确性**的派生量)

`V`/`value_now.V`/`buy_trigger` 现状已经是服务端重算并覆盖([store.ts:422](../../../src/main/invest/store.ts:422)、[:492](../../../src/main/invest/store.ts:492)、[:500](../../../src/main/invest/store.ts:500))。铺开到:

| 字段                                            | 现状问题                                                    | 改为                                                               | 备注                              |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `at_buy_point`                                  | 算出 `buy_trigger` 却不比较,LLM 自填布尔值决定建仓          | 服务端从 `price` vs `buy_trigger` 派生                             | —                                 |
| `gate.state`                                    | LLM 自签 `{state:'通行'}`,`compute_gate` 是否被调过从不核验 | 服务端从卡内宏观事实重算;无宏观事实 → 拒绝                         | —                                 |
| `value_now.V` 兜底                              | 引擎失败时静默保留手填值,再洗出 `buy_trigger`               | 补 `else` 分支 → 拒绝(与 `addThesisVersion` 现有的 fail-loud 对称) | fail-loud + `log.error`(G-MUST-2) |
| `red_flags`                                     | `z.number()` 原样存,可与 `pass`/`grade` 互相矛盾            | 调用 `computeRedFlags` 重算                                        | —                                 |
| `percentile`/`trend`/`momentum`/`turnover_days` | LLM 自填,从不重算                                           | 从事实序列重算                                                     | —                                 |
| `weight`/`realized_pct`                         | LLM 自填                                                    | 服务端派生                                                         | —                                 |
| `conviction`                                    | **待定,见下**                                               | **待定**                                                           | 见 §6.2                           |

**每处覆盖必须落审计日志**([E-MUST-3](../../../vibe/project/standards.md)/G-MUST-2 要求):格式对齐 `[CardRepo] <Action> <entity>: <id>, <覆盖前值>→<覆盖后值>`。

### 4.3 L3 · 三轴独立修复

**实效(freshness)**:

- `parseAsOfMonth`(`src/shared/invest/freshness.ts`)修正为接受完整 ISO 时间戳格式(当前正则 `$` 锚定,对 `2026-03-31T00:00:00.000Z` 返回 `null`)。
- 解析失败 → 拒绝(`FACT_ASOF_UNPARSEABLE`);**"拒绝未来 as_of"需要重新设计测试基线**——`store.test.ts` 现有的整套时钟策略(`CLOCK = new Date('2026-01-15')`)刻意使用晚于时钟的 `as_of` 表示"未来数据",这套 fixture 需要重写,同时必须保留一个不触发场景:**报告期落在当月的季报仍必须正常通过**(不能把"当期"误判为"未来")。
- `cadence` 对有取数通道的 metric_key 由 registry 派生,不再信任 LLM 自填;`irregular` 不再等价于"无新鲜度检查"。
- **排序放在写入侧**:`store.addFacts` 写入时按 `as_of` 排序;**不改** `valuation-trace.ts` 的 `latestFactValue`/`factValueAt`(该文件契约是`禁止依赖任何运行时模块`,`parseAsOfMonth` 是运行时模块)。同 key 同 `as_of` 值冲突 → 拒绝。
- `add_facts` 补上新鲜度检查(目前只有 `add_thesis`/`add_checkpoint` 的命门锚在查);`add_checkpoint` 补运行校验器链,但**必须先把 `ASSUMPTION_VALIDATORS` 拆成时间相关(如 `coreAnchorFresh`)和时间无关两组**——复查时能拿到的只是冻结版本的历史 assumptions([store.ts:490](../../../src/main/invest/store.ts:490)),直接跑时间相关校验会导致历史版本纯粹因为时间流逝报 `STALE_ANCHOR`,与不变量④"复查锚出身版本不回溯"冲突。

**准确性**:

- `crossCheck` 按 `source` 归一去重后再比较数值(而非只数不同字符串的个数);`tolerance` 由 LLM 提供时服务端 clamp 到合理范围并落库记录(当前无默认无上限且不落库)。
- `coreAnchorTrusted` 的双源交叉检查改为比较**数值**(容差内视为一致),而非只数来源字符串的去重个数(现状 `'定期报告'` vs `'年报'` 算两个不同来源)。
- 进入 `step` 折叠链参与计算 V 的参数,一律必须锚定 fact(不再限定"仅 core 参数")。**此项力度需用户确认(见 §6.1)。**
- `add_facts` 增加基于 registry sanity range 的数值校验(该项放业务层而非 Zod,因为 `FactsZ` 是任意 key 的 `z.record`,static schema 无法表达每个 key 各自的合理范围;commit message 需说明此点以免被误判为违反 `F-NEVER-1`)。
- `set_eligibility` 增加内部一致性校验(如 `red_flags` 计数与 `pass`/`grade` 不能矛盾)。
- `checks: []` 对含 core assumption 的 thesis 拒绝提交(结构性检查,Phase B 完成后应迁移到 Zod `.min(1)`)。
- `actual_value` 必须能从 `facts` 解析并与 `predicted_value` 比对,偏差超阈值时 `outcome` 由服务端派生而非信任 LLM 自报。

---

## 5. 强制点

Phase A 全部改动落在 invest 已有的两个强制点上,不新增平台钩子:

```
card-tools.ts:30-37   execute() 捕获 CardValidationError → 转 ToolErrorEnvelope(含 hint)
   → store.apply → ASSUMPTION_VALIDATORS(thesis-validators.ts:201,注册制,为扩展设计)
```

Phase B 完成后,结构性检查(`checks:[]`、tolerance 数值范围、`as_of` 格式)迁移至各工具的 `zodSchema`,业务性检查(涉及 `facts`/`session.agent_id` 等上下文)留在 `store.apply`。

---

## 6. 需要确认的设计决策

### 6.1 老卡处理 —— 已确认

用户已选择:**删除所有老卡**,即让 `recreateCardTablesIfOutdated`([store.ts:82](../../../src/main/invest/store.ts:82))触发 DROP 路径(通过修改 `STOCK_CARDS_REQUIRED_COLS` 或等效的 schema-version 标记),不做值级迁移/归一。

这是显式的破坏性操作确认(CLAUDE.md §7.1),记录在此作为决策留痕。实施时需要在 PR/commit message 中重申此决策及生效范围(仅本地开发环境的 `stock_cards`/`card_timeline` 表)。

### 6.2 待定 A —— step 链强制锚定 fact 的力度

**方案默认选择:采纳全力度版本**——进入 `step` 折叠链参与计算 V 的参数,不论是否 core,一律要求锚定一条真实 fact 做 delta/factor;`absolute` 模式仅允许用于**不参与** V 计算的纯定性/展示性参数。

**影响**:"先假设一个 PE 中枢 30 倍"这类建模习惯将不再合法,必须改为"锚定历史 PE 的真实观测值,再做相对调整"。这是审计中唯一一处会明显改变分析师建模方式的改动,评审时请重点确认这个取舍是否可接受;若认为过严,替代方案是仅对**多于一个**leaf 参数使用 `absolute` 时触发拒绝(允许单点定性假设,不允许整条估值链凭空搭建)。

### 6.3 待定 B —— `conviction` 是否服务端重算

`conviction`(`card-tools.ts:222`,`z.enum(['high','mid','low'])`,描述"确信度(强化累积↑)→ 喂仓位")是 L2 列表里唯一性质不同的字段:

- 若它的语义可以严格定义为"某个可数事件(如强化次数)的纯函数",则应纳入 L2 服务端重算,与其余字段一致。
- 若它承载了 LLM 对定性信息的综合判断(而非单纯计数),服务端重算会构成 `J-SHOULD-2` 定义的反模式("系统抢 LLM 该做的判断活")。

**方案默认选择:本轮不重算,保持 LLM 自填**,原因是当前 `agents.ts`/`card-tools.ts` 均未把它定义为可数事件的严格函数。如果后续要收编,需要先在 prompt/schema 层明确这个字段的计算规则,再讨论是否代码化。

---

## 7. 存量测试变更

Phase A 会让以下测试从"验证绕过被接受"变为"验证绕过被拒绝",属于有意的行为改变,不是无意破坏:

| 测试                                                       | 现在锁定的行为                                                                                                  | 改为                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `store.redesign.test.ts:378`(AC-007 fetch·mcp → T1)        | 手写 provenance → 直接采信为 T1                                                                                 | provenance 由服务端在取数直写路径盖章,手写路径一律 T3                    |
| `store.redesign.test.ts:353`(AC-005 不可解析 as_of 不抛)   | 乱串 as_of 静默跳过新鲜度检查                                                                                   | 抛 `FACT_ASOF_UNPARSEABLE`                                               |
| `store.test.ts:161-164`                                    | 未来 as_of 永不 stale(整个文件的 fixture 时钟策略)                                                              | 需重写 fixture:拒绝真正的未来日期,同时保留"当期季报正常通过"的不触发场景 |
| `store.redesign.test.ts:349-351`                           | `irregular` cadence + 2020 年数据通过新鲜度检查                                                                 | 退回按 level 推断的默认窗口后应判定过时                                  |
| `store.redesign.test.ts:388-395`(AC-007 compute → compute) | 需要确认此测试在 L1-5 修改后仍然通过(不应受影响,因为该项只重新限定"谁能声称 compute",不改变 compute 本身被信任) | 保持通过,作为回归验证点                                                  |

每处变更需在测试文件内联注释或 commit message 中说明变更原因(不写"原本 X 现在 Y"式的修复痕迹注释,遵守 `A-MUST-3`)。

---

## 8. 测试策略

按 `L-MUST-3`(每条运行时防御必须有"触发"与"不触发"两条测试),Phase A 预计新增约 25 条独立防御点(L1 六条 + L2 七条 + L3 十二条左右),对应约 50 条测试,而非早期估计的个位数。重点覆盖:

- **不触发场景是审计已经证明会出问题的地方**,必须显式覆盖:
  - 白名单黑名单化后,合法来源串(如"上交所公告 2026-03-31 比亚迪年报")必须仍能通过。
  - 拒绝未来 `as_of` 后,当期季报(报告期为当月)必须仍能通过。
  - `add_checkpoint` 跑校验器链后,冻结的历史版本不应因时间流逝新增报错。
- 每个新增错误码需要在 `thesis-validators.ts` 或对应文件补充 docstring,说明何时触发。

---

## 9. 本轮不做(附理由)

| 项                                                                                                                               | 理由                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工具范围收紧(bash/write/edit 对全部 invest agent 开放)                                                                           | 用户已定本轮不动,单独话题                                                                                                                           |
| 推理深度配置作为可靠性保障手段                                                                                                   | 探索确认:reasoning 是"调多想",不是"调可能性空间";schema 仍在请求模型自报 provenance,推理深度不改变这一点。可作为独立的研究质量提升项,但不能作为闸门 |
| `falsify_if`/`logic` 内容空话判定                                                                                                | 语义判断,代码难以严谨表达(`logic:'x'` 现在即可立命门)                                                                                               |
| `challenge` 与真实 short-thesis 子 agent 的绑定核验                                                                              | 需要 delegation 结果回执机制,依赖平台 loop 层改动,超出本轮范围                                                                                      |
| 股票代码存在性校验                                                                                                               | 需要外部查询能力                                                                                                                                    |
| `quote-verifier` 的 `tool_result`/`tool-result` 格式错配(平台级 bug,导致引用验证器从未运行,且兜底摘要把所有长引用误标为不可验证) | 已作为独立任务卡跟踪,与本设计的强制点无关(quote-verifier 面向最终文本,不面向数值落库)                                                               |

---

## 附录 A · 完整实测绕过清单

见审计原始记录(会话内已产出四份 agent 审计报告 + 一份合规审计报告,均含可复现的探针测试)。主要条目:

1. `provenance` 伪造 → T1 命门锚(`store.ts:353`/`thesis-validators.ts:123-151`)
2. 来源白名单子串误判(`'我自己记忆里的年报'`、`'雪球大V的研报解读'`、裸字符串 `'compute'` 全部通过)
3. `at_buy_point`/`gate.state` 自签绕过硬门(`store.ts:558`/`store.ts:551`)
4. `V` 由多数凭空 `absolute` leaf 参数拼出,真命门被排除在公式外(`valuation-trace.ts:258`/`store.ts:411-419`)
5. `V_now` 引擎失败时静默保留手填值(`store.ts:496-498`,无 `else`)
6. `crossCheck` 同源两次算"多源一致"(`cross-check.ts:24`丢弃 source)
7. `as_of` 排序 bug:新鲜度闸门取 `Math.max(as_of)`,估值引擎取数组末位,`addFacts` 不排序(`thesis-validators.ts:163`/`valuation-trace.ts:338`/`store.ts:360`)
8. `parseAsOfMonth` 拒绝完整 ISO 格式,新鲜度闸门对按文档要求写的数据静默失效(`freshness.ts:9`)
9. `set_eligibility` 零校验,`red_flags`/`pass`/`grade` 可互相矛盾(`store.ts:326-332`)
10. `checks: []` 跳过全部对账要求(`card-tools.ts:223`)
11. `actual_value` 从不与 `predicted_value`/`facts` 比对,`outcome` 可与十倍偏差并存
