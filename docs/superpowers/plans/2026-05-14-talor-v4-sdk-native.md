# Talor v4 — SDK-Native 大改造:彻底挖掘 AI SDK v6 能力,参数输入输出系统化优化

> 起草日期: 2026-05-14
> 状态: 待 review (大改动 plan,需逐 Phase 落地)
> 前置:
>
> - v3.6 [talor block protocol](2026-05-12-talor-block-protocol.md)
> - v3.7 [fault tolerance rebalance](2026-05-13-talor-v3.7-fault-tolerance-rebalance.md)
> - v3.7.1 [LLM × 系统 协作模型](2026-05-13-talor-v3.7.1-collaboration-model.md)
> - v3.7.2 [A2/B2 清理 + RiskGate 路径统一](2026-05-13-talor-v3.7.2-cleanup-residual.md)
> - v3.7.3 [Turn-end policy + SDK 信号一等化](2026-05-14-talor-v3.7.3-completion-fulfillment.md)
>
> 目标: 把 Talor 自造的 ReAct loop / RiskGate / fetch 拦截 / 字符串解析等机制,逐项替换为 AI SDK v6 原生能力。同时把 talor block 协议中"系统消费"的两个 block (pending_confirm / pending_continuation) 用 SDK 原生 approval / virtual tool 替代,UI 卡片类 block 保留。
>
> 总收益预估: 删 **~2000 行** 自造代码,SDK 升级自动受益,职责更清晰。
>
> 风险等级: **大改动 — 必须分 Phase 渐进落地,每 Phase 可独立 ship + 可回滚**

---

## 0. TL;DR

Talor v3.7.x 演化到现在,核心架构问题是**大量自造了 SDK 已经提供的能力**:

| Talor 自造                                                    | SDK 原生等价                                                                    | 行数估算    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| `react-loop.ts` 主循环 + detector 链                          | `streamText({ stopWhen, prepareStep, onStepFinish })`                           | ~400 行可删 |
| `RiskGate.gate` 5 路径分发                                    | `tool({ needsApproval: fn })`                                                   | ~200 行可删 |
| `openai-adapter.ts:createDeepSeekFetch` fetch 拦截            | `wrapLanguageModel({ middleware })`                                             | ~30 行重构  |
| `tools/registry.ts` 4-phase 校验 + 错误信封                   | `tool({ inputSchema, execute, toModelOutput })` + `experimental_repairToolCall` | ~100 行简化 |
| `JudgePolicy`(PR 2 计划字符串解析)                            | `generateObject({ schema })`                                                    | -50/+20 行  |
| `pending_confirm` block + parser + RiskGate path 2            | SDK approval flow                                                               | ~150 行可删 |
| `pending_continuation` block + PendingContinuationBlockPolicy | SDK 默认行为 + virtual tool                                                     | ~80 行可删  |
| `stream-utils` wrap/extract/truncate                          | `tool({ toModelOutput })`                                                       | ~80 行简化  |

**v4 核心原则**:

1. **SDK 原生优先** — 凡 SDK 已实现的能力,Talor 不再自造
2. **保留 Talor 业务价值** — Agent / MCP / Memory / Skill / UI 卡片是产品差异化,不动
3. **协议瘦身** — talor block 从 6 个降到 4 个(仅 UI 装饰),loop 不消费任何 block
4. **职责更清晰** — SDK 管 ReAct + tools + approval,Talor 管业务编排 + UI + 持久化
5. **渐进落地** — 5 个 Phase,每个独立 ship,可中途暂停可回滚

**实施周期**: ~3-4 周(5 个 Phase 串行)。

---

## 1. 背景与动机

### 1.1 为什么是 v4 而不是 v3.7.4

v3.7.x 的迭代都是"修补当前架构"。v4 是**架构方向调整**:

| v3.7.x 改动模式                             | v4 改动模式                                         |
| ------------------------------------------- | --------------------------------------------------- |
| 在 react-loop 内加 detector / policy / hint | **删 react-loop 主循环**,用 SDK 原生                |
| 在 RiskGate 加路径 / 兼容                   | **删 RiskGate.gate**,用 tool needsApproval          |
| 加 talor block 类型 + parser case           | **删 pending_confirm / pending_continuation block** |
| fetch 拦截改 body                           | **wrapLanguageModel middleware**                    |

v3.7.x 是"补丁";v4 是"换地基"。版本号跳到 4 是**显式信号**:重大架构 reset。

### 1.2 触发本次重构的关键观察(2026-05-14 dev session)

实测 DeepSeek V4 Flash "40 表 SHOW CREATE TABLE + 写 MD" 时遇到的问题,**几乎全是 SDK 已有解法但 Talor 没用**:

| 实测问题                                | 根因                           | SDK 原生解                           |
| --------------------------------------- | ------------------------------ | ------------------------------------ |
| max_tokens 默认 4-8K,reasoning 烧光预算 | Talor 不显式设 maxOutputTokens | 显式 `maxOutputTokens`               |
| finishReason='length' 后续做无限 loop   | Talor 没消费 finishReason      | `prepareStep` + 自定义 stopCondition |
| tool 参数错 → LLM 下步重试              | Talor 用错误信封被动重试       | `experimental_repairToolCall` 同步修 |
| RiskGate 5 路径分发复杂                 | 自造 confirm 流程协调          | `tool({ needsApproval })` SDK 内置   |
| `pending_confirm` block 需要 fence 解析 | LLM 配合度不均,parser 脆       | needsApproval 函数直接读 input       |

v3.7.3 在 v3.7.x 架构内已经做到极限。继续向前必须升维到 SDK 原生。

### 1.3 v3.7.x 协议演化的累积代价

```
v3.6: 引入 talor block (5 个类型)         + RiskGate (4 路径)
v3.7: 删 forced-closure                  + 删 marker-streak
v3.7.1: 形式化 J-SHOULD-2 协作矩阵        + 删 WaitAndAct/HallucinatedConfirm
v3.7.2: 删 delegate A2/B2 + RiskGate path 统一
v3.7.3: 加 pending_continuation block    + TurnEndPolicy chain (4 个 policy)
                                         + 2 个新 detector
```

每个版本都在加 / 删,但**没有一次根本性反思**:这些机制 SDK 是否已经提供?

v4 的回答是:**大部分提供了,且 SDK 实现质量比我们高**(更多 provider 兼容性、更稳定、更可观测)。

---

## 2. SDK v6 能力完整清单 — Talor 用了多少

### 2.1 `streamText` 参数

| 参数                                  | SDK 默认 / 含义             | Talor 当前用法                    | v4 用法                                            |
| ------------------------------------- | --------------------------- | --------------------------------- | -------------------------------------------------- |
| `model`                               | 必填                        | ✅ 用                             | 保持                                               |
| `messages`                            | 必填                        | ✅ 用                             | 保持                                               |
| `tools`                               | 工具集                      | ✅ 用(dynamicTool 包装)           | **改用 `tool()` + needsApproval**                  |
| `toolChoice`                          | `'auto'`/`'required'`/特定  | ❌ 不设(默认 auto)                | 保持                                               |
| `system`                              | 系统消息                    | ❌ 不用(放 messages 里)           | **改用 `system`**(避免 v6 system-in-messages 警告) |
| `allowSystemInMessages`               | 是否允许 system in messages | ❌ 不设(被警告)                   | 设 `false`(强制走 `system`)                        |
| `maxOutputTokens`                     | 输出预算                    | ⚠️ v3.7.3 后设 64K                | **per-provider 可配**                              |
| `temperature` / `topP` / `topK`       | 采样参数                    | ❌ 不设                           | per-agent 可配                                     |
| `stopSequences`                       | 停止序列                    | ❌ 不用                           | 保留不用                                           |
| `seed`                                | 确定性 seed                 | ❌ 不用                           | 保留(测试场景可启用)                               |
| `maxRetries`                          | SDK 自动重试次数            | ❌ 默认 2                         | per-provider 可配                                  |
| `abortSignal`                         | 取消信号                    | ✅ 用                             | 保持                                               |
| `timeout`                             | 超时                        | ❌ 不设                           | per-provider 可配                                  |
| `headers`                             | HTTP 头                     | ❌ 不设(走 fetch 拦截)            | **改用 headers**(显式 + 类型安全)                  |
| **`stopWhen`**                        | 多步停止条件                | ❌ **没用 → 自造 for loop**       | **核心改造点 1**                                   |
| **`prepareStep`**                     | 每步前 hook                 | ❌ 没用                           | **核心改造点 2**                                   |
| `experimental_telemetry`              | OpenTelemetry               | ❌ 不用                           | 保留(v4.1 启用)                                    |
| `providerOptions`                     | provider 特定参数           | ⚠️ 仅 OpenAI 设 parallelToolCalls | **per-provider 可配**(Anthropic cacheControl 等)   |
| `activeTools`                         | 限制可调工具子集            | ❌ 不用(用 toolSchemas 过滤)      | **改用 `activeTools`**                             |
| `output` / `experimental_output`      | 结构化输出                  | ❌ 不用                           | 保留(judge / specific 场景用)                      |
| **`experimental_repairToolCall`**     | 工具调用修复                | ❌ **没用**                       | **核心改造点 3**                                   |
| `experimental_transform`              | 流转换                      | ❌ 不用                           | 保留                                               |
| **`onChunk`**                         | chunk 流式回调              | ✅ 用(累积 stepText)              | 保持                                               |
| **`onStepFinish`**                    | 每步完成回调                | ❌ 没用(自己 await result.steps)  | **核心改造点 4**                                   |
| **`onFinish`**                        | 整轮完成回调                | ❌ 没用                           | **加上**(精确 usage 总和 + Ledger)                 |
| `onError`                             | 错误回调                    | ⚠️ 只 log,不动其他                | 保持                                               |
| `experimental_onStepStart`            | 每步开始                    | ❌ 不用                           | 保留                                               |
| `experimental_onToolCallStart/Finish` | 工具调用回调                | ✅ 用                             | 保持                                               |

**统计**: SDK 的 `streamText` 暴露 ~30 个参数,Talor 当前**只用了 8 个**。v4 增加使用 ~12 个核心参数。

### 2.2 `tool()` 工厂参数

| 参数                | SDK 默认 / 含义          | Talor 当前用法              | v4 用法                    |
| ------------------- | ------------------------ | --------------------------- | -------------------------- |
| `description`       | 工具描述                 | ✅ 用                       | 保持                       |
| `inputSchema`       | 输入 Zod / JSON Schema   | ✅ 用                       | 保持                       |
| `execute`           | 执行函数                 | ✅ 用                       | 保持                       |
| **`needsApproval`** | 审批函数 (boolean 或 fn) | ❌ **没用!**自造 RiskGate   | **核心改造点 5**           |
| `onInputStart`      | 参数流式开始             | ❌ 不用                     | 保留                       |
| `onInputDelta`      | 参数流式增量             | ❌ 不用                     | 保留                       |
| `onInputAvailable`  | 参数完整可用             | ❌ 不用                     | 保留(可用于前置 risk hint) |
| `toModelOutput`     | 自定义 output 格式       | ❌ 不用,自造 wrapToolOutput | **核心改造点 6**           |
| `outputSchema`      | 输出 Zod schema          | ❌ 不用                     | 保留                       |
| `strict`            | 严格模式                 | ❌ 不用                     | provider 支持时启用        |
| `providerOptions`   | 工具级 provider 选项     | ❌ 不用                     | 保留                       |

### 2.3 Helper 函数

| 函数                                                             | 用途                              | Talor 当前                | v4                                                                                                                                             |
| ---------------------------------------------------------------- | --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepCountIs(N)`                                                 | StopCondition,N 步即停            | ❌ 自造 maxSteps for      | **stopWhen 用**                                                                                                                                |
| `hasToolCall(name)`                                              | StopCondition,调到工具即停        | ❌ 不用                   | 必要时用                                                                                                                                       |
| `isLoopFinished()`                                               | SDK 内置完成判断                  | ❌ 不用                   | 评估后启用                                                                                                                                     |
| `generateObject({ schema, model })`                              | 非流式结构化输出                  | ❌ 不用                   | **核心改造点 7**                                                                                                                               |
| ~~`streamObject`~~                                               | ~~流式结构化输出~~                | ❌ 不用                   | **永不引入**(SDK v6 标 `@deprecated`,且无 tools/stopWhen/prepareStep — 与 ReAct 不兼容;需要流式结构化用 `streamText({ experimental_output })`) |
| `streamText({ experimental_output: Output.object({ schema }) })` | text + tools + 流式结构化最终输出 | ❌ 不用                   | 保留(仅极少数"必须流式且必须 schema"场景启用)                                                                                                  |
| `wrapLanguageModel({ middleware })`                              | provider middleware               | ❌ 自造 fetch 拦截        | **核心改造点 8**                                                                                                                               |
| `extractReasoningMiddleware`                                     | 提取 reasoning                    | ❌ 自处理 reasoning-delta | 评估替换                                                                                                                                       |
| `smoothStream`                                                   | UI chunk 平滑                     | ❌ 不用                   | UI 改进                                                                                                                                        |
| `consumeStream`                                                  | 流消费助手                        | ✅ 用                     | 保持                                                                                                                                           |
| `convertToModelMessages`                                         | 消息格式转换                      | ❌ 不用                   | 评估                                                                                                                                           |
| `Agent` / `ToolLoopAgent`                                        | 一等 Agent 抽象                   | ❌ 自造 Agent             | **不用**(Talor Agent 是业务概念,与 SDK Agent 不同)                                                                                             |

### 2.4 类型与协议

| SDK 类型                             | 用途                      | Talor 当前             | v4                                   |
| ------------------------------------ | ------------------------- | ---------------------- | ------------------------------------ |
| `ToolApprovalRequestOutput<T>`       | approval 请求 output part | ❌ 不知道              | **替代 pending_confirm block**       |
| `ChatAddToolApproveResponseFunction` | 添加 approval 响应        | ❌ 不知道              | 用于 IPC                             |
| `ChatAddToolOutputFunction`          | 添加 tool output          | ❌ 不知道              | 可用                                 |
| `ToolCallRepairFunction`             | tool 修复函数签名         | ❌ 不知道              | **配合 experimental_repairToolCall** |
| `PrepareStepFunction`                | prepare 钩子签名          | ❌ 不知道              | **配合 prepareStep**                 |
| `StepResult`                         | 每步结果完整结构          | ⚠️ 部分用 result.steps | 完整用                               |
| `LanguageModelUsage`                 | 精确 token usage          | ⚠️ v3.7.3 开始用       | 保持                                 |
| `LanguageModelMiddleware`            | middleware 接口           | ❌ 自造 fetch 拦截     | **改用 middleware**                  |
| `StopCondition`                      | stopWhen 条件类型         | ❌ 不用                | **核心**                             |
| `FinishReason`                       | finishReason 类型         | ✅ 用                  | 保持                                 |

---

## 3. 核心改造点详解

### 3.1 改造点 1+2+4:react-loop 改用 `streamText` 内置多步

#### 当前实现(简化)

```ts
// react-loop.ts (~600 行)
for (let step = 0; step < maxSteps; step++) {
  if (abortSignal.aborted) break
  const hint = composeHint(detectors)
  const { messages, tools } = await pipeline.build(ctx)
  const result = streamText({
    model, messages, tools, maxOutputTokens: 64_000,
    onChunk(chunk) { /* 累积 stepText / stepReasoning */ },
    experimental_onToolCallStart(...) { /* UI */ },
    experimental_onToolCallFinish(...) { /* UI */ },
  })
  await result.consumeStream()
  // 拉 finishReason / usage / warnings / providerMetadata
  // 持久化 assistant + tool 配对
  // 跑 detector 链
  // 跑 turn-end policy 链
  // 注入 nextStepHint
}
```

#### v4 实现

```ts
// react-loop-v4.ts (~150 行)
const detectorState = makeDetectorState()
let policyHint: string | null = null

const result = streamText({
  model,
  system: systemMessage, // ← 改用 system 参数
  messages: nonSystemMessages,
  tools,
  maxOutputTokens: provider.max_output_tokens ?? 64_000,
  abortSignal,

  // 多步停止条件:N 步上限 + 死循环 detector + 截断 streak detector
  stopWhen: [
    stepCountIs(opts.maxSteps ?? 1000),
    customStopCondition('signature-dead-loop', detectorState),
    customStopCondition('failure-streak', detectorState),
    customStopCondition('tool-only-loop', detectorState),
    customStopCondition('length-truncation-streak', detectorState),
  ],

  // 每步前 hook:注入 hint
  prepareStep: async ({ steps, stepNumber }) => {
    const hint = composeHint(detectorState) ?? policyHint
    policyHint = null
    if (!hint) return undefined
    return {
      // SDK 允许改 messages 仅本步用
      messages: [...originalMessages, { role: 'system', content: hint }],
    }
  },

  // 每步完成 hook:持久化 + 更新 detector 状态
  onStepFinish: async (event) => {
    await persistStepMessages(event)
    updateDetectorState(detectorState, event)
    ctx.lastInputTokens = event.usage.inputTokens
  },

  // 整轮完成 hook:总 usage 入 Ledger
  onFinish: async ({ usage, totalUsage, warnings }) => {
    log.info(`[ReactLoop] turn done. total tokens: ${totalUsage.totalTokens}`)
    if (warnings) ledger.recordWarnings(warnings)
  },

  // 工具修复(SDK 内同步修,不浪费 step)
  experimental_repairToolCall: makeRepairFn(repairModel),

  onChunk: ctx.callbacks.onTextDelta, // UI 流式回调
})

await result.consumeStream()
```

**外层只保留 turn-end policy 续做**(SDK 没有"无 tool 但续做"原生能力):

```ts
let turnDone = false
while (!turnDone) {
  await runStreamWithSdkMultiStep(...)  // ← 上面那段
  // SDK 跑完(stopWhen 触发或 LLM 无 tool 自然停)
  const lastStep = result.steps[result.steps.length - 1]
  const decision = await runPolicyChain([
    SdkFinishReasonPolicy,
    PendingContinuationVirtualToolPolicy,
    JudgeCompletionPolicy,
    LegacyNaturalFinalPolicy,
  ], lastStep)
  if (decision.action === 'final') {
    turnDone = true
  } else {
    // continue: 注入 hint,重新跑一次 SDK 多步
    policyHint = decision.injectHint
  }
}
```

**代码量对比**:

| 模块                     | 当前行数 | v4 行数                 | 删减     |
| ------------------------ | -------- | ----------------------- | -------- |
| `react-loop.ts` 单步函数 | ~500     | ~50                     | -450     |
| `react-loop.ts` 主循环   | ~100     | ~30                     | -70      |
| detector chain wiring    | ~50      | ~30 (stopWhen 函数包装) | -20      |
| forced-summary fallback  | ~150     | 保留                    | 0        |
| **subtotal**             | **~800** | **~260**                | **-540** |

**保留**:

- forced-summary 整体路径(SDK 不管)
- 持久化(SDK onStepFinish 可调 messageRepo.createBatch)
- turn-end policy 外循环(SDK 不能在"无 tool"时续做)

#### v4 与 v3.7.3 行为兼容性

| 场景                       | v3.7.3                         | v4                                           |
| -------------------------- | ------------------------------ | -------------------------------------------- |
| 单步无工具有文本           | policy 链 → P3 legacy final    | SDK 自然 stop → 外层 policy 链 → final       |
| 多步链工具调用             | for loop 每步独立 streamText   | SDK 内置一次 streamText 自动多步             |
| 死循环检测                 | detector observe + accumulator | stopWhen 函数 + detectorState 闭包           |
| failure-streak hint 注入   | 主循环 composeHint → 注入下步  | prepareStep 注入                             |
| pending_continuation 续做  | TurnEndPolicy 链               | 外层 while 循环 + virtual tool / 外层 policy |
| finishReason='length' 处理 | SdkFinishReasonPolicy          | stopWhen 自定义函数 + prepareStep 注入       |
| 工具参数错误               | Zod 错 envelope → LLM 下步重试 | experimental_repairToolCall 同步修           |

---

### 3.2 改造点 5:`tool({ needsApproval })` 替代 RiskGate

#### 当前 RiskGate.gate() 5 条路径

```
路径 1: HIGH static (bash/write/edit)  → 系统生成 summary + confirmTool
路径 2: LLM emit pending_confirm block → confirmTool + 可记忆
路径 3: fallback regex (DROP/INSERT)   → confirmTool
路径 4: memory pattern 命中            → 自动通过
路径 5: auto-low                       → 直通
```

**问题**:5 条路径 = 5 套独立的 confirm 协调代码(暂停 - 等用户 - 恢复)。Talor 自己写了 promise 阻塞 + UI 响应桥接,这些 SDK 已经做了。

#### v4 实现 — `needsApproval` 函数

```ts
// src/main/tools/registry.ts 改造
function buildToolForSdk(toolDef: ToolDefinition, ctx: ToolExecuteContext): SdkTool {
  return tool({
    description: toolDef.description,
    inputSchema: toolDef.zodSchema ?? jsonSchemaToZod(toolDef.parameters),
    needsApproval: async (input, { toolCallId, messages }) => {
      // ← Talor 的 RiskGate 决策函数收敛到这里
      const decision = await riskGate.decide(toolDef, input, ctx, { toolCallId, messages })
      // decision: { needsApproval: boolean, summary?: string, pattern?: string }
      return decision.needsApproval
    },
    execute: async (input, options) => {
      const result = await runTool4Phase(toolDef, input, ctx, options)
      return result.output
    },
    toModelOutput: (output) => {
      // ← 替代 stream-utils 的 wrapToolOutput
      return { type: 'text', value: wrapToolOutput(toolDef.name, output) }
    },
  })
}
```

**SDK 处理流程**(自动):

```
1. LLM emit tool_call
2. SDK 调 needsApproval(input)
3. needsApproval 返 true → SDK emit ToolApprovalRequestOutput part
                          → 流暂停,等 IPC 上来的 approval 响应
4. 用户在 UI 点 approve / deny → 通过 chatAddToolApproveResponseFunction 写回
5. SDK 收到响应:
   - approved → 调 execute
   - denied   → tool result = denial output (SDK 自动)
```

#### Talor 侧需要做的(简化版 RiskGate)

```ts
// risk-gate-v4.ts (~80 行,从 387 行简化)
export const riskGate = {
  async decide(tool, input, ctx, { toolCallId, messages }): Promise<RiskDecision> {
    // 1. 静态 high-risk (bash/write/edit) → 必审批
    if (tool.riskLevel === 'HIGH') {
      const summary = buildHighStaticSummary(tool.name, input)
      return { needsApproval: true, summary, allowRemember: false }
    }
    // 2. LLM 在最近 text 里 emit pending_confirm block → 用 block 字段
    //    (v4 Phase 4 整体删除此路径,见 §4.2)
    const block = findPendingConfirmInRecentMessages(messages)
    if (block) {
      if (this.memory.isApproved(ctx.sessionId, block.pattern)) {
        return { needsApproval: false, viaMemory: true }
      }
      return {
        needsApproval: true,
        summary: block.summary,
        pattern: block.pattern,
        allowRemember: block.risk_level !== 'destructive',
      }
    }
    // 3. fallback regex 兜底
    const fallback = detectFallbackRisk(input)
    if (fallback) {
      return { needsApproval: true, summary: fallback.reason, allowRemember: false }
    }
    // 4. auto-low
    return { needsApproval: false }
  },
  recordLedger(...) { /* 同 v3 */ },
  memory: sessionApprovalMemory,
}
```

**关键差异**:

- v3.7.3 的 RiskGate.gate **同步阻塞**直到 confirmTool 返回
- v4 的 needsApproval **只返 true/false**,SDK 处理流暂停/恢复

#### UI 改造

v3.7.3 UI 用 `ToolConfirmDialog` + Talor 自造 IPC 协议。
v4 用 SDK 标准 `ToolApprovalRequestOutput` part,渲染时识别此类型,弹同款 dialog,用户点击后通过 SDK 提供的 `addToolApproveResponseFunction` 写回。

**preload 层 + IPC 协议改动**:

- 新 IPC channel: `tool:approval-respond` (input: { toolCallId, approved, remember? })
- 主进程接到响应后调 SDK function

#### 代码量对比

| 模块                              | 当前        | v4       | 删减     |
| --------------------------------- | ----------- | -------- | -------- |
| `risk-gate.ts` gate 函数          | 387         | ~80      | -300     |
| `build-tools.ts` dynamicTool 包装 | 153         | ~40      | -110     |
| `tool-confirm.ts` IPC port        | ~80         | ~30      | -50      |
| `renderer/ToolConfirmDialog.tsx`  | 保留,改适配 | 同行数   | 0        |
| **subtotal**                      | **~620**    | **~150** | **-460** |

---

### 3.3 改造点 3+6:`experimental_repairToolCall` + `toModelOutput`

#### `experimental_repairToolCall` — 工具参数同步修

当前(`registry.ts:101-119`):

```ts
const parsed = tool.zodSchema.safeParse(input)
if (!parsed.success) {
  return { __talor_error: true, code: 'ZOD_VALIDATION', message: formatZodError(...) }
}
```

LLM 看到错误 envelope,**下一步**重新调用。浪费 1 个 step。

v4:

```ts
streamText({
  ...,
  experimental_repairToolCall: async ({ toolCall, error, parameterSchema, messages, system }) => {
    if (!(error instanceof InvalidToolInputError)) return null  // 不修非 schema 错
    // 用便宜 model 同步修一次
    const { object } = await generateObject({
      model: getCheapModel(),
      schema: parameterSchema,
      prompt: buildRepairPrompt(toolCall, error, system),
    })
    return { ...toolCall, input: object }
  },
})
```

**收益**:Zod 失败 → 同步修复,不浪费 step。失败率高的弱模型尤其受益。

#### `tool({ toModelOutput })` — 工具输出格式化

当前(`stream-utils.ts:wrapToolOutput`):

```ts
// 自造的 XML 包裹器
function wrapToolOutput(toolName: string, output: string, trustSkill: boolean) {
  const trustAttr = trustSkill ? ' trust="skill-content"' : ''
  return `<tool_output tool="${toolName}"${trustAttr}>${output}</tool_output>`
}
```

被 react-loop 在 messageRepo.createBatch 前调用。

v4:

```ts
tool({
  ...,
  toModelOutput: (output, { toolCallId }) => {
    if (toolName === 'skill') {
      return { type: 'text', value: `<tool_output tool="skill" trust="skill-content">${output}</tool_output>` }
    }
    return { type: 'text', value: `<tool_output tool="${toolName}">${output}</tool_output>` }
  },
})
```

**收益**:格式化收敛到工具定义本身,react-loop 不再关心。stream-utils 的 wrap 函数可删。

---

### 3.4 改造点 7:**`generateObject` 替代字符串解析**(显式排除 `streamObject`)

#### Memory 压缩

当前(`ShortTermMemory.ts:323-332`):

```ts
const { text } = await generateText({
  model,
  messages,
  maxTokens: summaryBudget, // ← v6 应该是 maxOutputTokens
})
// text 是 free-form summary,作为单 string 插回 history
```

v4:

```ts
const CompressionSchema = z.object({
  user_intent: z.string().describe('What the user originally asked for'),
  key_facts: z.array(z.string()).describe('Critical facts established by tool results'),
  pending_actions: z.array(z.string()).describe('Actions LLM committed to but not yet executed'),
  resolved_issues: z.array(z.string()).describe('Errors that were diagnosed and fixed'),
  current_blocker: z.string().nullable().describe('What is currently blocking progress'),
})

const { object } = await generateObject({
  model,
  schema: CompressionSchema,
  prompt: buildCompressionPrompt(messages),
  maxOutputTokens: summaryBudget,
})

// 渲染回 messages:
const summaryMessage = {
  role: 'system',
  content: renderCompressionAsText(object), // 结构化 → 可读 markdown
}
```

**收益**:

- pending_actions 字段天然解决"长对话中丢失承诺"(promise-then-stop 在长对话的变种)
- key_facts 数组结构便于 RAG 风格检索
- 审计:每次压缩产物有 schema 可读

#### Judge call(v3.7.3 PR 2 计划)

直接用 `generateObject` 而非字符串解析。已在 v3.7.3 plan §5 详述。

#### Session title generation

当前(`orchestrator.ts` 异步生成):

```ts
const { text } = await generateText({ ..., prompt: `Title for: ${userMsg}` })
// text 是 free-form,取首行
```

v4:

```ts
const TitleSchema = z.object({
  title: z.string().min(3).max(40),
  category: z.enum(['code', 'data', 'research', 'admin', 'misc']),
})
const { object } = await generateObject({ model, schema: TitleSchema, prompt: ... })
// object.category 给 UI 上色,title 长度受控
```

#### **结构化输出 API 选择原则 — `streamObject` 永不引入**

SDK v6 提供 4 种结构化输出路径,Talor 选 2 个,**显式排除 `streamObject`**:

| API                                                                  | 适用                                                       | Talor 用?                |
| -------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| **`generateObject({ schema })`**                                     | 短小结构化输出(judge / memory 压缩 / session title),非流式 | ✅ **核心改造点 7 使用** |
| **`streamText({ experimental_output: Output.object({ schema }) })`** | 既要 tools/多步/流式 text,又要最终输出 schema 化(罕见场景) | 保留(仅极少数场景启用)   |
| `generateText({ experimental_output: Output.object({ schema }) })`   | 同上但非流式                                               | 保留                     |
| ~~`streamObject({ schema })`~~                                       | 单次调用,纯流式 JSON                                       | **❌ 永不引入**          |

**`streamObject` 排除的根本原因**:

1. **SDK 自己标 `@deprecated`** (`ai/dist/index.d.ts:5515`):

   ```
   @deprecated Use `streamText` with an `output` setting instead.
   ```

   选 streamObject = 选定一个 SDK 自身宣告要删除的 API。

2. **不支持 `tools`** — 函数签名里没有 `tools` 参数。Talor 主路径是 ReAct(LLM 调工具 + 系统执行),用 streamObject 等于自废 agent 能力。

3. **单次调用,无多步** — 没有 `stopWhen` / `prepareStep` / `onStepFinish`。Talor 核心控制流无法实现。

4. **输出全约束为 schema** — LLM 不能 emit 自由文本对话内容。破坏 Talor 对话型 agent 的产品体验。

5. **reasoning chunks 不分离** — DeepSeek-V3/V4 等 reasoning model 的内部思考会混入 JSON 输出,无法走 `reasoning-delta` 独立通道。

6. **无 `needsApproval` / `experimental_repairToolCall`** — SDK 高级特性失效。

**判别表(决策树)**:

```
需要结构化输出?
  ├── No → streamText (主路径,Talor v4 大部分场景)
  └── Yes → 需要 tools 或多步?
       ├── Yes (罕见) → streamText({ experimental_output })
       └── No → 短小输出?
            ├── Yes → generateObject  ← Talor v4 用于 judge / memory / title
            └── No (大量内容流式) → streamText({ experimental_output })
                                    (绝不用 streamObject,即便要流式结构化)
```

**Talor v4 结构化输出落点**:

- **Memory 压缩**: `generateObject` (CompressionSchema,~500 字符,非流式)
- **JudgeCompletionPolicy**: `generateObject` (JudgeSchema,30 字符,非流式)
- **Session title**: `generateObject` (TitleSchema,40 字符,非流式)
- **其他场景**: 不引入新的结构化输出路径

记入 `vibe/project/standards.md` 加 §F-NEVER-3 条目(v4 落地时):

```
### F-NEVER-3 · 禁止使用 streamObject

SDK 已 @deprecated。如需结构化输出:
  - 非流式 / 短小:用 generateObject
  - 流式 + tools / 多步:用 streamText({ experimental_output })

违反后果:
  - 选定已弃用 API,未来必须迁移
  - 失去 tools / stopWhen / prepareStep 等核心 ReAct 能力
  - 失去 reasoning-delta 分流

→ patterns.md §P-V4-X (结构化输出选择)
```

---

### 3.5 改造点 8:`wrapLanguageModel` middleware

#### 当前 fetch 拦截方式

```ts
// openai-adapter.ts:7-23
function createDeepSeekFetch(baseFetch = globalThis.fetch) {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      const body = JSON.parse(init.body)
      body.thinking = { type: 'disabled' }
      delete body.reasoning_effort
      init = { ...init, body: JSON.stringify(body) }
    }
    return baseFetch(input, init)
  }
}
```

**问题**:

- 改 raw HTTP body,绕过 SDK 抽象
- 类型不安全(any body)
- 无法叠加多个拦截
- 调试困难(stack trace 无 middleware 上下文)

#### v4 middleware 方式

```ts
// providers/middleware/disable-thinking.ts
export const disableThinkingMiddleware: LanguageModelMiddleware = {
  middlewareVersion: 'v3',
  transformParams: async ({ params }) => {
    return {
      ...params,
      providerOptions: {
        ...params.providerOptions,
        openai: {
          ...params.providerOptions?.openai,
          // 通过类型安全的 providerOptions
          // 注:具体字段名取决于 SDK 对 DeepSeek 的支持。如果 SDK 没暴露,
          // 还是可以保留 fetch 拦截作为 fallback,但放到 middleware 层组织
        },
      },
    }
  },
}

// providers/adapters/openai-adapter.ts
createModel(provider, modelId) {
  const baseModel = openai.chat(modelId)
  if (provider.is_deepseek) {
    return wrapLanguageModel({
      model: baseModel,
      middleware: [disableThinkingMiddleware, costTrackingMiddleware],
    })
  }
  return baseModel
}
```

#### 可叠加的 middleware 清单

| middleware                  | 用途                              |
| --------------------------- | --------------------------------- |
| `disableThinkingMiddleware` | DeepSeek thinking disable         |
| `costTrackingMiddleware`    | 记录每次调用 token cost 到 Ledger |
| `cacheControlMiddleware`    | Anthropic prompt caching(v4.1)    |
| `telemetryMiddleware`       | OpenTelemetry spans(v4.1)         |
| `requestLoggingMiddleware`  | dev mode 详细 log(可选)           |

---

## 4. Talor block 协议大瘦身

### 4.1 现状审计

| Block                                | 系统消费?          | UI 卡片?         | LLM emit 频率(实测)                |
| ------------------------------------ | ------------------ | ---------------- | ---------------------------------- |
| `pending_confirm`                    | ✅ RiskGate 主路径 | ✅ ConfirmDialog | DeepSeek 实测 ~10% (低)            |
| `pending_continuation` (v3.7.3 新增) | ✅ TurnEndPolicy   | ✅ chip card     | 实测 ~0% (强模型不需要,弱模型不学) |
| `done`                               | ❌                 | ✅ DoneCard      | 低                                 |
| `need_input`                         | ❌                 | ✅ NeedInputCard | 低                                 |
| `blocked`                            | ❌                 | ✅ BlockedCard   | 低                                 |
| `warning`                            | ❌                 | ✅ WarningCard   | 极低                               |

**关键洞察**:

- 6 个 block 中只有 2 个有系统行为(pending_confirm / pending_continuation)
- 实测 LLM 配合度普遍低(< 20%),系统全靠**兜底机制**正常工作
- "高配合度成本 = LLM 学 fence 协议",这成本在弱模型上几乎无法收回

### 4.2 v4 决策

#### 删除 — 改用 SDK 原生

**`pending_confirm` block — 删除**:

| v3.7.x                                            | v4                                                            |
| ------------------------------------------------- | ------------------------------------------------------------- |
| LLM 在 text 内 emit fenced `pending_confirm` JSON | LLM 直接调工具                                                |
| RiskGate parse 到 block → 弹 confirm              | SDK `needsApproval(input)` 函数读 input → 弹 approval         |
| `summary` / `pattern` / `preview` 字段            | 函数返 `{ needsApproval: true, summary, pattern }` 由系统派生 |
| LLM 配合度 ~10%                                   | SDK 100% 处理(LLM 不需要学协议)                               |

**为什么这是正确的简化**:LLM "声明副作用"的本质是"调用副作用工具",而工具调用是 SDK 一等公民。不需要 LLM 在 text 里再 emit 一份 JSON 重复声明。

**`pending_continuation` block — 删除**:

| v3.7.x                                            | v4                                                          |
| ------------------------------------------------- | ----------------------------------------------------------- |
| LLM emit fenced `pending_continuation` → 系统续做 | LLM 调 virtual tool `request_continuation()` → SDK 自动续做 |
| 需要专门 Policy 消费                              | SDK 原生:工具调用即续 loop,不需特殊处理                     |
| ContinuationChainDetector 防滥用                  | SDK 内部 step counter 防滥用,Talor 加 stepCountIs 上限      |

**关键 SDK 行为**:`streamText({ stopWhen: stepCountIs(1000), tools: { request_continuation } })`,LLM 调 `request_continuation` 工具 → SDK 视为有 tool call → 自动续 loop。

`request_continuation` 工具 `execute` 函数返一个简单的 ack:

```ts
const requestContinuationTool = tool({
  description:
    'Signal that you intend to perform an action in the next step (not in this turn). The framework will continue the loop so you can execute next step.',
  inputSchema: z.object({
    reason: z.string().optional().describe('Why you are deferring (optional, for audit)'),
  }),
  execute: async ({ reason }) => {
    return { acknowledged: true, reason }
  },
})
```

**为什么这是正确的简化**:LLM "我要继续"的本质是"我要做下一步",而"做下一步"的 SDK 标准方式就是调工具。把 `pending_continuation` 包装为 virtual tool 让 LLM 用熟悉的协议(tool call)表达。

#### 保留 — 仅 UI 装饰

`done` / `need_input` / `blocked` / `warning`:**保留**。

- 它们已经是纯 UI 装饰,loop 不消费
- 删了就丢失 done summary / need_input choices / blocked retry_hint 这些产品级 UI 字段
- 实测 LLM 配合度低,但配合时 UI 体验明显更好(类型化卡片)
- 保留 4 个 block + 1 个 virtual tool = 5 个语义出口,概念负担可接受

#### 协议层简化总结

```
v3.7.3:6 个 block 类型(pending_confirm / pending_continuation / done / need_input / blocked / warning)
v4:   4 个 block 类型(done / need_input / blocked / warning) + 1 个 virtual tool (request_continuation)

block 系统消费数:v3.7.3 = 2,v4 = 0
LLM 需要学的协议数:v3.7.3 = 6 个 fence schemas,v4 = 4 个 fence + 1 个 tool name
```

**架构层简化**:

```
v3.7.3 system 消费 block 的代码路径:
  text-delta → stepText 累积 → parseTalorBlocks → block dispatch
    ↓
    pending_confirm → RiskGate path 2
    pending_continuation → PendingContinuationBlockPolicy

v4 简化后:
  tool-call → SDK 内置处理:
    write/bash/edit etc. → tool.needsApproval(input)
    request_continuation → 视为 tool call,自动续 loop
  (parseTalorBlocks 仍跑,但只为 UI 装饰类 block)
```

**代码量**:删 ~150 行 block 消费代码 + ~80 行 ContinuationChainDetector。

---

## 5. 参数输入输出系统化优化

### 5.1 输入参数 — Talor → SDK

#### `streamText` 调用现状

```ts
// react-loop.ts 当前
streamText({
  model: ctx.model,
  messages,                       // ← 含 system 在内
  tools,
  maxOutputTokens: 64_000,
  ...ctx.streamOptions,           // ← 仅 { parallelToolCalls: true }
  abortSignal: buildStreamSignal(ctx.abortSignal),
  onChunk(...) {...},
  experimental_onToolCallStart(...) {...},
  experimental_onToolCallFinish(...) {...},
  onError(...) {...},
})
```

#### v4 完整参数

```ts
streamText({
  // === LLM 配置 ===
  model: ctx.model,
  system: systemMessage,                  // ← 分离 system,SDK v6 推荐
  messages: nonSystemMessages,
  allowSystemInMessages: false,           // ← 强制走 system 参数,无警告
  tools: buildSdkTools(toolSchemas, ctx), // ← tool() + needsApproval + toModelOutput

  // === 采样参数(per-agent / per-provider 可配) ===
  maxOutputTokens: agent.maxOutputTokens ?? provider.maxOutputTokens ?? 64_000,
  temperature: agent.temperature,
  topP: agent.topP,
  seed: agent.seed,                       // 仅测试场景

  // === 工具控制 ===
  toolChoice: agent.toolChoice ?? 'auto',
  activeTools: filterActiveTools(toolSchemas, ctx), // ← 替代手工 toolSchemas 过滤

  // === ReAct 控制 ===
  stopWhen: [
    stepCountIs(opts.maxSteps ?? 1000),
    customStopCondition('signature-dead-loop', state),
    customStopCondition('failure-streak', state),
    customStopCondition('tool-only-loop', state),
    customStopCondition('length-truncation-streak', state),
  ],
  prepareStep: makePrepareStep(state, ctx),
  experimental_repairToolCall: makeRepairFn(repairModel),

  // === Provider 特定 ===
  providerOptions: {
    ...adapter.buildStreamOptions(provider, agent),  // ← 适配器派生
    ...(agent.providerOptions ?? {}),                // ← agent 配置覆盖
  },

  // === 网络/重试 ===
  maxRetries: provider.maxRetries ?? 2,
  timeout: provider.requestTimeoutMs ?? 120_000,
  abortSignal: buildStreamSignal(ctx.abortSignal),
  headers: provider.headers,              // ← 显式 headers(不再 fetch 拦截)

  // === 回调 ===
  onChunk(chunk) { /* 流式 UI 回调 */ },
  onStepFinish: makeStepFinishHandler(state, ctx),
  onFinish: makeFinishHandler(ctx),
  onError(err) { /* log */ },
  experimental_onToolCallStart: ...,
  experimental_onToolCallFinish: ...,
})
```

**新增 / 改造的参数**:

| 参数                            | 来源                    | 用途                                           |
| ------------------------------- | ----------------------- | ---------------------------------------------- |
| `system`                        | PromptPipeline 拆分出来 | 消除 v6 警告 + provider 端 prompt caching 友好 |
| `allowSystemInMessages: false`  | 显式                    | 防止意外的 system in messages                  |
| `temperature` / `topP` / `seed` | per-agent profile       | 控制确定性,测试场景 seed 复现                  |
| `toolChoice`                    | per-agent 默认 'auto'   | agent 可强制 required(场景如:'必须先调工具')   |
| `activeTools`                   | 计算                    | 替代手工过滤,SDK 内置支持                      |
| `stopWhen`                      | 多个 detector           | 替代 react-loop 手工 for + break               |
| `prepareStep`                   | hint 注入               | 替代手工 messages.push                         |
| `experimental_repairToolCall`   | repair fn               | 同步修工具参数                                 |
| `providerOptions` per-agent     | agent profile 加字段    | 灵活控制 cacheControl / thinking / etc.        |
| `maxRetries` / `timeout`        | per-provider 配         | 现代化超时控制                                 |
| `headers`                       | per-provider 配         | 替代 fetch 拦截                                |
| `onStepFinish`                  | 持久化 + detector 状态  | 替代 await result.steps                        |
| `onFinish`                      | 总 usage + Ledger       | 整轮完成审计                                   |

### 5.2 Provider 配置扩展(支撑参数化)

#### `Provider` interface 新增字段

```ts
export interface Provider {
  ...existing fields,

  // v4 新增 — 参数化配置
  max_output_tokens?: number              // 默认 64_000
  max_retries?: number                    // 默认 2
  request_timeout_ms?: number             // 默认 120_000
  headers?: Record<string, string>        // 自定义 HTTP 头
  provider_options?: Record<string, unknown>  // 透传 providerOptions
  middleware?: string[]                   // 启用的 middleware 名称列表
                                          // 'disable-thinking' | 'cost-tracking' |
                                          // 'cache-control' | 'telemetry' | 'request-logging'
}
```

#### `Agent` Schema 2.0 新增字段

```ts
// Schema 2.0 当前是扁平 15 字段,v4 加 4 个可选字段
export interface AgentProfile {
  ...existing 15 fields,

  // v4 — 采样参数(选填,默认走 provider / global)
  temperature?: number
  top_p?: number
  seed?: number

  // v4 — 工具控制(选填)
  tool_choice?: 'auto' | 'required' | { type: 'tool'; toolName: string }

  // v4 — turn-end judge(承接 v3.7.3 PR 2)
  turn_end_judge?: {
    enabled: boolean
    model?: string
    timeout_ms?: number
  }
}
```

#### 配置优先级

```
agent.<field> > provider.<field> > Talor global default

例:
  maxOutputTokens 决策:
    1. agent.maxOutputTokens (per-agent 显式) ← 最高
    2. provider.max_output_tokens (per-provider)
    3. 64_000 (DEFAULT_MAX_OUTPUT_TOKENS in react-loop)  ← 最低
```

### 5.3 输出参数 — SDK → Talor

#### 当前 Talor 拉取的 SDK 输出

```ts
await result.consumeStream()
const sdkSteps = await result.steps
const [finishReason, usage, providerMetadata, warnings] = await Promise.all([...])
// 自己 reconcile tool-error,自己拉 finishReason
```

#### v4 通过回调获取(更准确 + 更早)

```ts
streamText({
  ...,
  onStepFinish: async (event) => {
    // event 含完整 StepResult:
    //   content: ContentPart[] (text/reasoning/tool-call)
    //   toolCalls: TypedToolCall[]
    //   toolResults: TypedToolResult[]
    //   finishReason: FinishReason
    //   usage: LanguageModelUsage   ← 精确 token (input/output/total)
    //   providerMetadata: ProviderMetadata
    //   warnings: CallWarning[]
    //   request / response: LanguageModelRequestMetadata / ResponseMetadata
    //   stepType: 'initial' | 'continue' | 'tool-result'

    // v4 持久化:
    await persistStep(event)
    // 更新 detector 状态:
    updateDetectorState(state, event)
    // Ledger:
    if (event.warnings?.length) ledger.recordWarnings(event.warnings)
    // Cache stats 日志:
    logCacheStats(event.providerMetadata)
    // Context 预算:
    ctx.lastInputTokens = event.usage.inputTokens
  },

  onFinish: async (event) => {
    // event.totalUsage 跨所有 steps 总和
    // event.finishReason  整轮终止原因
    log.info(`turn done, total: ${event.totalUsage.totalTokens}t`)
    ledger.recordTurnFinish({
      session_id: ctx.sessionId,
      total_usage: event.totalUsage,
      finish_reason: event.finishReason,
      steps: event.steps.length,
    })
  },
})
```

**收益**:

- 每步实时拿到 usage(无须 await result.usage 滞后)
- 自动 reconcile tool-error(SDK 内部处理)
- StepResult 标准结构,易测试

### 5.4 工具输入输出协议

#### v3.7.x 工具协议

```ts
// types.ts
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema
  zodSchema?: z.ZodTypeAny
  riskLevel?: 'LOW' | 'HIGH'
  validate?: (input, ctx) => ValidationResult
  execute: (input, ctx) => Promise<{ output: unknown }>
  verify?: (output, input, ctx) => Promise<VerifyResult>
}
```

#### v4 工具协议(对齐 SDK)

```ts
// types-v4.ts
export interface ToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<INPUT> // ← Zod-first (替代 parameters)
  outputSchema?: z.ZodType<OUTPUT> // ← v4 新增,输出也可 schema 化
  execute: (input: INPUT, options: ToolExecutionOptions) => Promise<OUTPUT>

  // 替代 RiskGate
  needsApproval?: boolean | ((input: INPUT, options) => Promise<boolean>)

  // 替代 stream-utils wrap
  toModelOutput?: (output: OUTPUT, options) => ToolModelOutput

  // 替代 verify
  // (verify 的"block on hallucination" 等高级特性单独移到 SDK 之外的 verifier 层)

  // 元数据
  riskLevel?: 'LOW' | 'HIGH' // 仅用于 needsApproval 简单路径
}
```

**关键变化**:

- `parameters` JSON Schema 字段 → `inputSchema` Zod(SDK 派生 JSON Schema)
- 加 `outputSchema` 让工具能 schema 化输出(便于下游处理)
- `validate` 合并到 `execute` 内部(SDK 不分这一层)
- `verify` 单独抽到 verifier 层(SDK 不管 hallucination detection)

#### 4-Phase 校验 → SDK 3 阶段

| Talor v3 Phase              | v4                                                          |
| --------------------------- | ----------------------------------------------------------- |
| Phase 1: Zod / schema-check | SDK `inputSchema` 自动 + `experimental_repairToolCall` 兜底 |
| Phase 2: tool.validate      | 合并到 execute 内(无独立 phase)                             |
| Phase 3: tool.execute       | SDK execute                                                 |
| Phase 4: tool.verify        | **保留**,作为 Talor 业务层 verifier(SDK 不管)               |

verify 的"block on hallucination"高级特性是 Talor 业务价值,保留为后置 hook(在 onStepFinish 内执行 + 改写 tool result)。

---

## 6. 5 个 Phase 实施路线

每个 Phase 独立可 ship,可回滚。建议串行(但不强制)。

### Phase 1:Provider 配置扩展 + middleware 化(1-2 天)

**范围**:

- `Provider` interface 加 `max_output_tokens` / `max_retries` / `request_timeout_ms` / `headers` / `provider_options` / `middleware` 字段
- `Agent` Schema 2.0 加 `temperature` / `top_p` / `seed` / `tool_choice` / `turn_end_judge`(承接 v3.7.3 PR 2)
- 新建 `providers/middleware/` 目录:
  - `disable-thinking.ts`(替代 createDeepSeekFetch)
  - `cost-tracking.ts`(usage → Ledger)
  - `request-logging.ts`(dev mode)
- 每个 adapter 的 `createModel` 改用 `wrapLanguageModel({ middleware: configFromProvider })`
- `react-loop.ts streamText` 加入新参数(`headers` / `maxRetries` / `timeout` / `temperature` / etc.)

**测试**:

- Provider config 持久化 round-trip
- middleware 顺序生效
- agent 字段 override provider 字段

**风险**: 低。增量改动,向后兼容(新字段全 optional)。

### Phase 2:`tool({ needsApproval })` 替代 RiskGate(3-5 天)

**范围**:

- 重构 `risk-gate.ts`:`gate` → `decide`(纯决策函数,不 emit confirm)
- `build-tools.ts`:dynamicTool 包装 → `tool({ needsApproval })`
- preload + IPC 改造:从 `confirmTool` callback 改为 SDK `ToolApprovalRequest` part 处理
- renderer `ToolConfirmDialog`:适配 SDK approval 结构
- 删除 RiskGate path 2(pending_confirm block)的代码(块本身保留过渡期不删,Phase 4 才删)
- 测试 SessionApprovalMemory + SideEffectLedger 仍正常工作

**测试**:

- HIGH static 工具 → 弹 confirm → 用户 approve → tool 执行
- HIGH static 工具 → 用户 deny → tool 不执行,LLM 收到 denial output
- pending_confirm block 仍命中(向后兼容)
- memory pattern auto-approve 仍生效
- fallback regex 兜底仍生效
- 完整 ledger 审计

**风险**: 中。confirm 流程是用户感知核心,需要充分测试 IPC + UI 协议变更。

**回滚**: 保留 v3.7.x RiskGate.gate 代码作为 fallback,通过 feature flag 切换。

### Phase 3:ReAct loop 改用 SDK 多步(5-7 天)

**范围**:

- 新建 `react-loop-v4.ts`,使用 `streamText({ stopWhen, prepareStep, onStepFinish, onFinish, experimental_repairToolCall })`
- detector 改造:从 `LoopDetector` 接口改为 `customStopCondition` 函数 + 外部 detectorState 闭包
- hint 注入:从主循环 `composeHint(detectors)` 改为 `prepareStep` 返修改后的 messages
- 持久化:从主循环 `messageRepo.createBatch` 改为 `onStepFinish` 内调
- turn-end policy 外循环:**保留**(SDK 不能处理"无 tool 但续做"),用 while 循环包 `streamText` 调用
- 老 `react-loop.ts` 通过 feature flag 切换,新旧并存过渡

**测试**:

- 所有现有 react-loop 测试(30+)迁移到 v4 等效
- SDK 内部多步行为验证(stepCountIs 触发 / stopCondition 命中)
- prepareStep 注入消息不影响配对不变量
- onStepFinish 持久化与 v3 行为对齐
- Failure-streak 等 detector 触发与 v3 等价
- forced-summary 仍正常

**风险**: 高。这是 v4 最大改动,涉及核心控制流。需要充分集成测试。

**回滚**: feature flag `USE_SDK_NATIVE_LOOP` 默认 false,开启即切到 v4 路径,出问题立即关。

### Phase 4:Talor block 协议瘦身(2-3 天)

**范围**:

- 删除 `PendingConfirmBlock` 类型 + parser case + UI Card(用 SDK approval 替代)
- 删除 `PendingContinuationBlock` 类型 + parser case + UI Card(用 virtual `request_continuation` tool 替代)
- 注册 `request_continuation` virtual tool 到所有 agent 工具集
- 删除 `PendingContinuationBlockPolicy`(SDK 自动续做即可)
- 删除 `ContinuationChainDetector`(用 `stepCountIs` 替代)
- Prompt 改造:Principle 12 重写 — 不再提 pending_continuation block,改提 "use request_continuation tool to signal continuation intent"
- Standards / Patterns 文档更新

**测试**:

- request_continuation 工具调用 → SDK 续 loop
- 既有含 pending_confirm / pending_continuation block 的 history 仍能 load(向后兼容读)
- Standards 文档块到工具的迁移说明

**风险**: 中。协议改动影响 history 兼容性。

**回滚**: 删除是不可逆的,但 fence parser 仍解析旧 block(只是不 dispatch),老 session 可读不可写新 block。

### Phase 5:输出协议 + verify 重构(2-3 天)

**范围**:

- `tool({ toModelOutput })` 替代 stream-utils 的 wrap 函数
- `experimental_repairToolCall` 集成(Phase 3 加,Phase 5 扩展场景)
- `generateObject` 替代:
  - `ShortTermMemory.summarize`(结构化压缩)
  - `JudgeCompletionPolicy`(judge 调用)
  - Session title generation
- verifier 抽到独立模块(`tools/verifier.ts`),作为 onStepFinish 内的后置 hook
- 删除 `stream-utils.ts` 中 wrapToolOutput / extractOutputText / truncateOutput 等(SDK toModelOutput 接管)

**测试**:

- 结构化压缩字段 round-trip
- repair fn 真实修复一个 schema 错误
- verifier 后置 hook 不破坏 SDK step result

**风险**: 低-中。是补完优化。

---

## 7. 迁移策略

### 7.1 feature flag

`ConfigStore` 加全局开关:

```ts
{
  ...
  "v4": {
    "use_sdk_native_loop": false,      // Phase 3 切换
    "use_sdk_tool_approval": false,     // Phase 2 切换
    "use_sdk_middleware": true,         // Phase 1 默认开
    "use_structured_outputs": true,     // Phase 5 默认开
  }
}
```

每个 Phase 落地后,默认 false → 内测 1-2 周 → 默认 true → 下个 Phase。

### 7.2 兼容性矩阵

| 既有数据                                 | v4 处理                                     |
| ---------------------------------------- | ------------------------------------------- |
| 老 session 含 pending_confirm block      | Phase 4:parser 仍解析,但不 dispatch(纯展示) |
| 老 session 含 pending_continuation block | 同上                                        |
| 老 Provider 无 v4 字段                   | 全 optional,默认值正常工作                  |
| 老 Agent profile 无 v4 字段              | 同上                                        |
| SideEffectLedger 历史记录                | Phase 2 改 confirm_by 来源,但 schema 兼容   |
| Memory 老压缩(纯文本)                    | Phase 5:dbToModelMessages 兼容旧字符串      |

### 7.3 弃用通知

v4 落地后,在 standards.md 加"弃用清单":

```
DEPRECATED in v4:
  - ToolDefinition.parameters (use inputSchema instead)
  - ToolDefinition.validate / verify (validate 合并 execute;verify 移 verifier 层)
  - createDeepSeekFetch (use disableThinkingMiddleware)
  - RiskGate.gate (use riskGate.decide + tool needsApproval)
  - PendingConfirmBlock / PendingContinuationBlock (use SDK approval / virtual tool)
  - PendingContinuationBlockPolicy / ContinuationChainDetector (SDK 内置)
  - react-loop.ts:runReactLoop legacy mode (use v4 SDK-native)
```

v4.1 后某个版本(预计 2-3 个月后)真正删代码。

---

## 8. L1 文档更新计划

### 8.1 `standards.md`

需要更新的规则:

| 规则                                           | 现状                              | v4 改动                                                                                                            |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `F-MUST-1` 内置工具必须 Zod 声明               | parameters 由 z.toJSONSchema 派生 | **改**:Tool inputSchema 是 Zod,SDK 自动派生 JSON Schema                                                            |
| `F-MUST-2` 4-Phase 校验                        | Zod → validate → execute → verify | **改**:SDK 3 阶段(Zod 自动 + execute + verifier 后置 hook)                                                         |
| **`F-NEVER-3` 禁止使用 `streamObject`** (新增) | —                                 | **加**:SDK v6 已 @deprecated;Talor 永不引入;结构化输出用 `generateObject` 或 `streamText({ experimental_output })` |
| `J-SHOULD-2` 协作矩阵                          | 完整                              | **加一行**:Tool approval / Continuation by tool — 系统主责(SDK 处理)                                               |
| `J-SHOULD-3` SDK 信号一等化 (v3.7.3 加)        | streamText 信号                   | **扩**:tool 信号 / approval 信号 / step 信号 全部一等化                                                            |

### 8.2 `patterns.md`

需要新增的模式:

- `P-V4-1`: `wrapLanguageModel` middleware 模式(替代 fetch 拦截)
- `P-V4-2`: `tool({ needsApproval })` 替代自造 confirm gate
- `P-V4-3`: `stopWhen` + `prepareStep` 替代手工 for ReAct
- `P-V4-4`: `generateObject` 替代自造字符串解析
- `P-V4-5`: **结构化输出 API 选择决策树**(`generateObject` 主选 / `streamText + experimental_output` 备选 / `streamObject` 禁用)

需要弃用的模式:

- `P4` (path-guard 部分)— 仍有效
- `P9` (verify) — 改造为 verifier 后置 hook
- v3.7.3 加的 turn-end policy 链:**部分弃用**(SDK 默认行为吞掉一半)

### 8.3 `overview.md`

整体重写"业务层 — 推理引擎"小节,主要变化:

```
v3.7.3:
  ReAct Loop (react-loop.ts)
    + Detector 链 (signature-dead-loop / failure-streak / tool-only-loop / continuation-chain / length-truncation)
    + TurnEndPolicy 链 (sdk-finish-reason / explicit-termination / pending-continuation / legacy)

v4:
  ReAct Loop (react-loop-v4.ts, 主体是 SDK 内置 streamText 多步)
    + 4 个 customStopCondition 函数 (替代 detector 链)
    + prepareStep / onStepFinish 钩子
    + turn-end policy 外循环 (SDK 不能"无 tool 续做",外层补)
```

---

## 9. 风险登记

| 风险                                                   | 概率 | 影响 | 缓解                                                  |
| ------------------------------------------------------ | ---- | ---- | ----------------------------------------------------- |
| SDK 内置多步行为与现有不一致(细节)                     | 高   | 中   | feature flag + 灰度;v3 v4 并存对比                    |
| `experimental_repairToolCall` 不稳定(experimental API) | 中   | 低   | 设 try/catch,失败回退现有错误 envelope                |
| `tool({ needsApproval })` IPC 协议改动破坏 UI          | 中   | 中   | UI 端 adapter 层兼容老协议过渡                        |
| `wrapLanguageModel` middleware 顺序问题                | 低   | 中   | 测试覆盖各组合                                        |
| SDK v6 升级到 v7 时 experimental APIs 变名             | 中   | 中   | 集中封装在 Talor 内部接口,SDK 升级只改一处            |
| `generateObject` provider 兼容性                       | 低   | 低   | SDK 自动 fallback 到 json_object → prompt engineering |
| 删除 pending_confirm block 破坏老 session 显示         | 低   | 低   | parser 保留(仅解析,不 dispatch),老 session 仍展示卡片 |
| 实施周期超估(每 Phase 实际 1.5x)                       | 中   | 中   | 接受;Phase 独立 ship 可分批延后                       |

---

## 10. 测试矩阵

### 10.1 Phase 1(Provider / middleware)

- Provider 新字段 round-trip(CRUD)
- middleware 启用 / 禁用 / 顺序
- agent 字段 override provider 字段

### 10.2 Phase 2(tool needsApproval)

- HIGH static 工具 approval 流程(approve / deny / remember)
- pending_confirm block 仍命中(过渡期)
- memory pattern auto-approve
- fallback regex 兜底
- Ledger 记账正确
- IPC approval 响应路由正确

### 10.3 Phase 3(SDK ReAct)

- 单步无 tool 自然 stop
- 多步链 tool 调用
- stepCountIs 触发上限
- 各 customStopCondition 触发(signature dead-loop / failure-streak / tool-only-loop / length-truncation-streak)
- prepareStep 注入 hint
- onStepFinish 持久化与 v3 等价
- onFinish 整轮总结
- experimental_repairToolCall 修复一个 Zod 错
- abortSignal 中止
- forced-summary 仍触发

### 10.4 Phase 4(Talor block 瘦身)

- request_continuation 工具调用 → 续 loop
- pending_confirm block 在 v4 不 dispatch(向后兼容读)
- pending_continuation block 同上
- Principle 12 prompt 更新

### 10.5 Phase 5(输出 + verify)

- `tool({ toModelOutput })` 包装与 v3 wrapToolOutput 等价
- 结构化 memory 压缩 round-trip
- generateObject 替代 judge string parse
- verifier 后置 hook 改写 tool result(hallucination block)

### 10.6 端到端(每 Phase 都跑)

- "40 表 → MD" 完整任务(2026-05-14 实测同款)
- promise-then-stop 修复(LLM 调 request_continuation → 续做 → 完成)
- max_tokens 截断恢复
- 重启 dev,既有 session 继续可用

---

## 11. 关键决策固化

| 决策                                       | 选择                                     | 理由                                                                                              |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| v4 是大改动                                | **是**                                   | 涉及核心控制流 / 协议层 / IPC,版本号跳升告知                                                      |
| 分 Phase 串行                              | **是,5 个 Phase**                        | 每个独立 ship 可回滚,降低风险                                                                     |
| feature flag 灰度                          | **是**                                   | Phase 2/3 必须                                                                                    |
| 保留 turn-end policy 外循环                | **是**                                   | SDK 没有"无 tool 续做"原生能力,这是 Talor 比 SDK 多的价值                                         |
| 删 pending_confirm block                   | **是**                                   | SDK approval 一等公民,fence 解析是冗余                                                            |
| 删 pending_continuation block              | **是**                                   | 用 virtual tool 替代,SDK 自然续做                                                                 |
| 保留 done/need_input/blocked/warning block | **是**                                   | 产品级 UI 卡片,SDK 不管 UI                                                                        |
| 改用 SDK 内置多步                          | **是**                                   | 删 ~540 行,SDK 升级自动受益                                                                       |
| 改用 needsApproval                         | **是**                                   | 删 ~460 行,IPC 协议标准化                                                                         |
| middleware 替代 fetch 拦截                 | **是**                                   | 类型安全 + 可叠加                                                                                 |
| Verifier 抽到独立模块                      | **是**                                   | SDK 不管 hallucination,这是 Talor 业务                                                            |
| ToolDefinition 改 Zod-first                | **是**                                   | parameters 字段改 inputSchema,SDK 派生 JSON Schema                                                |
| 结构化输出主选 `generateObject`            | **是**                                   | 短小输出 + 非流式,无须 stream UI                                                                  |
| 引入 `streamObject`                        | **❌ 永不**                              | SDK 已 `@deprecated` + 无 tools + 无 stopWhen + 输出全约束破坏对话体验。Talor 文档新加 §F-NEVER-3 |
| 流式结构化输出场景                         | 用 `streamText({ experimental_output })` | 保留所有 ReAct / tools / 多步能力 + 最终输出 schema 化                                            |
| v4 落地后立即删 v3 代码                    | **否**                                   | 保留 2-3 个月过渡期,feature flag 灰度                                                             |
| 实施周期                                   | **3-4 周**                               | 5 个 Phase 串行 + 测试                                                                            |

---

## 12. 总收益预估

| 维度                         | v3.7.3        | v4                      | 差值                                     |
| ---------------------------- | ------------- | ----------------------- | ---------------------------------------- |
| react-loop 模块代码量        | ~800 行       | ~260 行                 | **-540**                                 |
| RiskGate + buildTools 代码量 | ~620 行       | ~150 行                 | **-470**                                 |
| stream-utils + wrap 代码量   | ~200 行       | ~50 行                  | **-150**                                 |
| openai-adapter fetch 拦截    | 30 行         | middleware 30 行        | 0                                        |
| talor-block parser dispatch  | 80 行         | 30 行                   | **-50**                                  |
| Detector 链定义              | 5 个 detector | 4 个 stopCondition 函数 | -1 个                                    |
| **代码净减**                 |               |                         | **~ -1200 行 + 简化 -300 行 ≈ -1500 净** |
| SDK 信号利用率               | 8/30 参数     | ~20/30 参数             | **+12 参数纳入**                         |
| Block 协议数                 | 6 个          | 4 个 + 1 virtual tool   | **-1 个净**                              |
| Talor block 系统消费数       | 2 个          | 0 个                    | **-2 个**                                |

**质量收益**:

- IPC 协议向 SDK 标准对齐(approval / step result)
- middleware 模式可叠加(cost / cache / telemetry)
- 错误恢复同步化(experimental_repairToolCall)
- 输出可观测性提升(onStepFinish 精确 usage)
- 协议层负担降低(LLM 不需学 fence schema)

**长期收益**:

- SDK v6 → v7 升级 Talor 自动受益
- 新 provider 集成成本降低
- 调试 / 监控 / cost tracking 走标准链路
- 与 Anthropic / OpenAI 生态对齐

---

## 13. 后续(v4 落地后的 v4.1 / v5)

### v4.1(v4 落地后 1 月)

- **Anthropic prompt caching** via `providerOptions.anthropic.cacheControl` middleware
- **OpenTelemetry** 集成(`experimental_telemetry`)
- **Cost-aware policy**(用精确 usage 做 budget 控制)
- 移除 v3 deprecated 代码

### v5(远期,~6 个月)

- Talor 自己的 Agent 抽象与 SDK 的 `Agent` 类对齐(可能不合并,但接口对齐)
- 探索 SDK 的 `Workflow` / `MCP UI` 等高级特性
- 完全无 fence-based 解析(所有 LLM 协议出口都是 tool call)

---

## 14. 实施前确认事项

请 review 以下决策点:

1. **整体方向**:5 个 Phase 串行 OK 吗?是否需要并行某些?
2. **Phase 优先级**:Phase 1 → 2 → 3 → 4 → 5 顺序合理吗?还是先 Phase 3(SDK 多步)冲击最大,先做能验证最多?
3. **feature flag**:Phase 2/3 需要灰度,其他 Phase 是否也需要?
4. **删除 pending_continuation block**:你刚加完(v3.7.3),v4 又删,是否觉得反复?(实际是因为发现 SDK 原生有 virtual tool 替代,这是新知识)
5. **删除 pending_confirm block**:这个 LLM 实测配合度 ~10%,SDK approval 100%,删值得吗?或保留 block 作为可选辅助?
6. **`request_continuation` virtual tool 命名**:这个名字 OK 吗?或叫 `continue_in_next_step` / `defer_action`?
7. **L1 文档更新**:Phase 1 落地时就更新还是 v4 整体完成后?
8. **实施周期 3-4 周**:接受吗?如果需要更紧凑(2 周),哪些 Phase 可以合并 / 缩减?

无修订即可开始 Phase 1 实施。

---

## 致谢

本 plan 站在 v3.6-v3.7.3 累积的协议设计 + 实测教训之上。**v4 不是否定 v3.x,而是站在 v3.x 看清楚边界后**,大胆把"Talor 应该做的"和"SDK 应该做的"分清楚。

最大的认知更新:**talor block 协议作为"LLM 与系统的中介语"过度设计了** —— LLM 已经有 tool call 这个 SDK 一等公民的协议,我们只需要在 tool call 之上加 needsApproval / virtual continuation tool 就能表达所有协议意图。Fenced JSON 在 text 内的协议是 v3 时代的产物,v4 之后 talor block 应该退化为**纯 UI 装饰**(done / need_input / blocked / warning)。
