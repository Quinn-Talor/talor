# v4 Phase 2b — 执行 plan (本次会话遗留)

**Status**: ready to execute in next session
**Predecessor**: docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md (架构总纲)
**Last shipped**: 77cd8bd (Phase 3 — react-loop SDK 多步重写完成)

---

## 0. TL;DR

v4 SDK-native 改造剩 **Phase 2b** 未落地:

| 块           | 范围                                                   | 工作量 | 风险                         |
| ------------ | ------------------------------------------------------ | ------ | ---------------------------- |
| **Phase 2b** | `tool({ needsApproval })` + SDK approval IPC + UI 适配 | 3-5 天 | 中 (用户感知核心,需充分测试) |

Phase 3 (react-loop SDK 多步重写) **已于本会话完成** (77cd8bd)。
Phase 2a 完成的 `RiskGate.decide()` 已经为 Phase 2b 备好纯决策函数。

---

## 1. 本会话 (2026-05-14) 已完成回顾

按 commit 时间倒序:

```
77cd8bd feat(loop): v4 Phase 3 — react-loop SDK 多步重写
b7f9b56 docs(v4): Phase 2b + Phase 3 execution plan for next session
f1c0d5f refactor(tools): v4 Phase 2a — extract RiskGate.decide() pure decision function
2d588a5 fix(loop,prompt): tool-only-loop soft-hint + parallel-tool prompt enforcement
8b95231 docs(v4): update L1 docs (standards + patterns) to reflect v4 progress
4435674 chore(v4): remove all legacy/deprecated/backward-compat code
a09b6d1 feat(v4 Phase 4b): remove pending_confirm/pending_continuation block schema completely
76109c9 feat(v4 Phase 4a): replace pending_continuation block with request_continuation virtual tool
6005e28 feat(v4 Phase 5 partial): generateObject for memory compression
71c3878 feat(v4 Phase 1): provider config + middleware + streamText params
e8612a5 feat(loop,prompt): v3.7.3 — turn-end policy chain + pending_continuation + SDK 信号一等公民化
```

**关键发现**(本会话 dev 验证):

- ✅ v4 Phase 1 middleware 注入正常(disable-thinking 已生效,DeepSeek body 含 `thinking=disabled`)
- ✅ Phase 4a request_continuation virtual tool 已注册到 ALWAYS_AVAILABLE_TOOLS
- ✅ Phase 5 generateObject memory 压缩链路通
- ✅ Phase 3 SDK 多步重写完成,193 loop tests passing
- ⚠️ **现场发现的 bug** — DeepSeek V4 Flash 沉默工具链触发 tool-only-loop 误判 → 已修复 (2d588a5)

---

## 1b. Phase 3 落地总结 (✅ 完成于 77cd8bd)

实际产物 (vs §2 设计):

- ✅ `loop/detector-state.ts` — DetectorState 接口 + createDetectorState
- ✅ `loop/step-adapter.ts` — factsFromStep, outcomeFromStep, stepSignature, canonicalizeJson 等
- ✅ `loop/persist-step.ts` — persistStepFromResult + persistAbortedStep
- ✅ `loop/test-helpers/mock-stream-text.ts` — driveStreamText (29 + 13 tests using it)
- ✅ `react-loop.ts` 994 → 494 行 (-50%)
- ⚠️ **未实施 experimental_repairToolCall** — 留作 Phase 3.5 (独立小改动,InvalidToolInputError 同步修复)
- ⚠️ **测试覆盖收缩** — 30 v3 tests → 13 v4 tests + 29 step-adapter 单测。覆盖核心场景(text-only/abort/context budget/dead-loop/failure-streak/turn-end policy/persistence),v3 中部分细节场景未直接迁移(MCP exposure flags 中部分 / talor block marker 单步触发 — 现由 turn-end policy 覆盖)。
- ⚠️ **持久化 messageId 行为** — v4 所有 step 用 uuid 落库 (v3 FINAL step 用 ctx.messageId)。orchestrator 验证: messageId 只是 wire id (chat:stream 协议), DB id 任意 uuid 即可。

---

## 2. Phase 3 — react-loop SDK 多步重写

### 2.1 目标架构

```ts
// react-loop.ts 重写 (~600 → ~280 行)

export async function runReactLoop(opts: ReactLoopOptions): Promise<void> {
  const detectorState = createDetectorState() // mutable, 共享给 stopWhen/onStepFinish
  const detectors = [
    new SignatureDeadLoopDetector(ctx, detectorState),
    new FailureStreakDetector(ctx, detectorState),
    new ToolOnlyLoopDetector(detectorState),
    new LengthTruncationStreakDetector(detectorState),
  ]
  const turnEndPolicies = buildDefaultChain()
  let nextPolicyHint: string | null = null
  let turnDone = false
  let exitReason: LoopExitReason = 'no_tool_calls'

  while (!turnDone) {
    if (opts.abortSignal.aborted) {
      exitReason = 'abort'
      break
    }

    // 一个 streamText = SDK 内部多步 (直到 stopWhen 命中或自然 stop)
    const result = streamText({
      model: opts.model,
      system: systemMsg,
      messages: nonSystemMessages,
      tools,
      maxOutputTokens: providerMaxOutput ?? 64_000,
      maxRetries: provider.max_retries,
      headers: provider.headers,
      timeout: provider.request_timeout_ms,
      temperature: agentPrefs?.temperature,
      topP: agentPrefs?.topP,
      seed: agentPrefs?.seed,
      toolChoice: agentPrefs?.toolChoice,
      providerOptions: mergedProviderOptions,
      abortSignal: buildStreamSignal(opts.abortSignal),

      stopWhen: [
        stepCountIs(opts.maxSteps ?? 1000),
        () => detectorState.shouldStop, // detector triggered → SDK 退出
      ],

      prepareStep: async ({ stepNumber, messages: stepMessages }) => {
        const hint = composeHint(detectors) ?? nextPolicyHint
        nextPolicyHint = null
        if (!hint) return undefined
        return { messages: [...stepMessages, { role: 'system', content: hint }] }
      },

      onStepFinish: async (event) => {
        // 1. 持久化 — 把 event.content 转换成 Talor 的 AssistantContent + ToolContent
        await persistStepFromEvent(event, sessionId, agentId)

        // 2. 观察 detector
        const facts = factsFromStepEvent(event)
        const rawCtx = { stepText: textFromEvent(event), finishReason: event.finishReason }
        for (const d of detectors) {
          const v = d.observe(facts, detectorState.totalSteps, rawCtx)
          if (v.triggered) {
            detectorState.shouldStop = true
            detectorState.exitReason = v.exitReason ?? 'repeated_error'
            detectorState.pendingForcedSummary = v.runSummary ?? null
            detectorState.markFinal = !!v.markFinal
            break
          }
        }
        detectorState.totalSteps++

        // 3. SDK usage 更新 (J-SHOULD-3 类别 B)
        if (event.usage?.inputTokens) detectorState.lastInputTokens = event.usage.inputTokens
      },

      onFinish: ({ totalUsage, warnings }) => {
        log.info(`[ReactLoop] segment done. tokens=${totalUsage?.totalTokens}`)
        if (warnings) for (const w of warnings) logWarning(w)
      },

      experimental_repairToolCall: async ({ toolCall, error, parameterSchema }) => {
        if (!(error instanceof InvalidToolInputError)) return null
        try {
          const { object } = await generateObject({
            model: opts.model,
            schema: parameterSchema,
            prompt: buildRepairPrompt(toolCall, error),
            maxOutputTokens: 4_000,
          })
          return { ...toolCall, input: object }
        } catch {
          return null
        }
      },

      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta')
          opts.callbacks.onTextDelta(chunk.text, detectorState.totalSteps)
      },
      experimental_onToolCallStart: ({ toolCall }) => {
        /* UI 透传 */
      },
      experimental_onToolCallFinish: (event) => {
        /* UI 透传 */
      },
    })
    await result.consumeStream()

    // SDK 跑完 (stopWhen 触发 OR 自然 stop OR 错误)
    if (detectorState.shouldStop) {
      if (detectorState.pendingForcedSummary) await detectorState.pendingForcedSummary()
      exitReason = detectorState.exitReason!
      break
    }

    // 自然结束 — 跑 turn-end policy 链
    const steps = await result.steps
    const lastStep = steps[steps.length - 1]
    const lastOutcome = outcomeFromStep(lastStep)
    const policyCtx: PolicyContext = {
      agent,
      sessionId,
      stepIndex: detectorState.totalSteps,
      abortSignal: opts.abortSignal,
      sdkSignals: {
        /* from lastStep */
      },
    }
    const decision = await runPolicyChain(turnEndPolicies, lastOutcome, policyCtx)
    if (decision.action === 'final') {
      turnDone = true
      exitReason = decision.exitReason ?? 'no_tool_calls'
    } else {
      nextPolicyHint = decision.injectHint ?? null
    }

    if (detectorState.totalSteps >= (opts.maxSteps ?? 1000)) {
      exitReason = 'max_steps'
      break
    }
  }

  // fallback summary (整轮空文本) 与 v3 等价
  if (needsFallback && exitReason !== 'abort') {
    await runForcedSummary(ctx, detectorState.totalSteps, FALLBACK_SUMMARY_OPTS)
  }
}
```

### 2.2 关键接口设计

**`DetectorState` (新增)**:

```ts
// loop/detector-state.ts
export interface DetectorState {
  totalSteps: number
  shouldStop: boolean
  exitReason?: LoopExitReason
  pendingForcedSummary: (() => Promise<void>) | null
  markFinal: boolean
  lastInputTokens?: number
}

export function createDetectorState(): DetectorState {
  /* ... */
}
```

**Detector 接口微调**:

```ts
// 现行 observe 接口保留;新增对 detectorState 的引用 (构造时注入)
export interface LoopDetector {
  readonly name: string
  observe(facts: OutcomeFacts, stepIndex?: number, raw?: DetectorRawContext): DetectorVerdict
  nextHint?(): string | null
}
// SignatureDeadLoopDetector / FailureStreakDetector 构造签名加一个 detectorState 参数
// 但 verdict.triggered 仍然由 react-loop 解析, 然后 SET detectorState.shouldStop
```

**Step → OutcomeFacts 适配器** (新增):

```ts
// loop/step-adapter.ts
import type { StepResult } from 'ai'

export function factsFromStepEvent(event: StepResult<ToolSet>): OutcomeFacts {
  const toolCalls = event.toolCalls ?? []
  const toolResults = event.toolResults ?? []
  return {
    hasToolCall: toolCalls.length > 0,
    hasText: extractTextFromContent(event.content).length > 0,
    allToolsFailed: deriveAllToolsFailed(toolResults),
    isSubagentFailure: deriveSubagentFailure(toolResults),
    signature: stepSignature(toolCalls, toolResults),
  }
}

export function outcomeFromStep(step: StepResult<ToolSet>): StepOutcome {
  /* ... */
}
```

**Persistence 适配器** (新增):

```ts
// loop/persist-step.ts
export async function persistStepFromEvent(
  event: StepResult<ToolSet>,
  sessionId: string,
  agentId: string,
  messageId: string,  // 仅 final step 用
): Promise<void> {
  const text = extractTextFromContent(event.content)
  const reasoning = extractReasoningFromContent(event.content)
  const toolCalls = event.toolCalls ?? []
  const toolResults = event.toolResults ?? []

  if (toolCalls.length === 0) {
    // 文本最终 — 调 messageRepo.create (用 messageId)
    messageRepo.create({ id: messageId, role: 'assistant', content: [...] })
    return
  }
  // assistant + tool 配对事务 — 调 messageRepo.createBatch
  messageRepo.createBatch([
    { id: uuidv4(), role: 'assistant', content: [text?, reasoning?, ...tool-calls] },
    { id: uuidv4(), role: 'tool', content: tool-results },
  ])
}
```

### 2.3 测试改写策略

**核心改动**: `mockStreamText` 从 "1 调用 = 1 step" 改为 "1 调用 = N step",
通过驱动 `onStepFinish` 多次 + 返回 `result.steps` 数组。

#### Helper: 新的 mock driver

```ts
// test-helpers/mock-stream-text.ts (新增)
interface MockStep {
  text?: string
  reasoning?: string
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown; isError?: boolean }>
  finishReason?: import('ai').FinishReason
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
}

export function driveStreamText(steps: MockStep[]) {
  return async (params: any) => {
    let stopped = false
    const completedSteps: any[] = []

    for (let i = 0; i < steps.length && !stopped; i++) {
      const step = steps[i]

      // 1. prepareStep 提供修改机会
      const prep = await params.prepareStep?.({
        stepNumber: i,
        steps: completedSteps,
        messages: [],
      })

      // 2. 流式 text
      if (step.text) params.onChunk?.({ chunk: { type: 'text-delta', text: step.text } })

      // 3. 工具调用 lifecycle
      for (const tc of step.toolCalls ?? []) {
        params.experimental_onToolCallStart?.({ toolCall: tc })
        const result = step.toolResults?.find((r) => r.toolCallId === tc.toolCallId)
        params.experimental_onToolCallFinish?.({
          toolCall: tc,
          durationMs: 1,
          success: !result?.isError,
          output: result?.output,
        })
      }

      // 4. onStepFinish — 这是 detector observe 入口
      const event = stepResultFromMockStep(step)
      completedSteps.push(event)
      await params.onStepFinish?.(event)

      // 5. 检查 stopWhen
      if (Array.isArray(params.stopWhen)) {
        for (const cond of params.stopWhen) {
          if (await cond({ steps: completedSteps })) {
            stopped = true
            break
          }
        }
      }
    }

    // 6. onFinish
    await params.onFinish?.({
      totalUsage: completedSteps.reduce(/* sum */),
      warnings: undefined,
    })

    return {
      consumeStream: vi.fn().mockResolvedValue(undefined),
      steps: Promise.resolve(completedSteps),
      finishReason: Promise.resolve(
        completedSteps[completedSteps.length - 1]?.finishReason ?? 'stop',
      ),
      usage: Promise.resolve(completedSteps[completedSteps.length - 1]?.usage),
      providerMetadata: Promise.resolve(undefined),
      warnings: Promise.resolve([]),
    }
  }
}
```

#### 测试改写示例 — "带 error 同签名第 2 次 break"

**Before** (v3 单步 mock × 2 次主循环):

```ts
mockStreamText.mockImplementation((params) => {
  fireToolCall(params, 'tc', 'bash', { cmd: 'ls' }, 'Error: same error')
  return { consumeStream, toolResults: Promise.resolve([...]) }
})
const opts = makeOpts({ maxSteps: 10 })
await runReactLoop(opts)
// 主循环调 streamText 2 次
expect(mockStreamText.mock.calls.length).toBe(2)
```

**After** (v4 SDK 多步 mock):

```ts
mockStreamText.mockImplementation(
  driveStreamText([
    {
      toolCalls: [{ toolCallId: 'tc1', toolName: 'bash', input: { cmd: 'ls' } }],
      toolResults: [
        { toolCallId: 'tc1', toolName: 'bash', output: 'Error: same error', isError: true },
      ],
    },
    {
      toolCalls: [{ toolCallId: 'tc2', toolName: 'bash', input: { cmd: 'ls' } }],
      toolResults: [
        { toolCallId: 'tc2', toolName: 'bash', output: 'Error: same error', isError: true },
      ],
    },
    // 第 3 步不应执行 — stopWhen 因 detectorState.shouldStop 命中
    { toolCalls: [{ toolCallId: 'tc3', toolName: 'bash', input: { cmd: 'ls' } }] },
  ]),
)
const opts = makeOpts({ maxSteps: 10 })
await runReactLoop(opts)
// SDK 跑 2 步后 stopWhen 命中
expect(/* steps observed */).toHaveLength(2)
// streamText 仍只调 1 次 (SDK 内部多步)
expect(mockStreamText.mock.calls.length).toBe(1)
```

#### 各测试组迁移评估

| 测试组                  | 数量    | 改写难度 | 备注                                                                         |
| ----------------------- | ------- | -------- | ---------------------------------------------------------------------------- |
| text-only response      | 1       | 低       | 1 mockStep                                                                   |
| abort before loop       | 1       | 低       | 不改 mock,只验证早退                                                         |
| context budget guard    | 2-3     | 中       | mock 不变,验证 messages 注入 [CONTEXT NEARLY FULL] 改为查 prepareStep return |
| dead-loop detection     | 4       | 高       | 多 step 驱动 + detector observe 时序对齐                                     |
| failure-streak          | 3       | 高       | 多 step + forced summary 触发链                                              |
| MCP exposure            | 2       | 中       | search_tool flag 仍需主循环跟踪                                              |
| persistence 配对        | 3       | 高       | onStepFinish 内调 createBatch 时序敏感                                       |
| forced-summary fallback | 2-3     | 中       | 主循环外不变                                                                 |
| stream error            | 2       | 中       | streamText 内 throw 时 partial persist                                       |
| **总计**                | **~30** |          | 估算 5-7 小时                                                                |

### 2.4 实施顺序

**Step 1** (~2h): 适配器层

- 新建 `loop/detector-state.ts`
- 新建 `loop/step-adapter.ts` (factsFromStepEvent, outcomeFromStep, stepSignature)
- 新建 `loop/persist-step.ts`
- 修改 detector 构造签名接收 detectorState

**Step 2** (~3h): react-loop 重写

- 替换 runReactLoop body
- 删除 runReactStep
- 保留 forced-summary / loop-accumulator / mcp-exposure-state

**Step 3** (~3h): test-helpers + 测试改写

- 新建 `test-helpers/mock-stream-text.ts`
- 改写 30 个测试,优先级:dead-loop / failure-streak / persistence 配对
- text-only / abort 等简单测试最后做

**Step 4** (~1h): npm test + typecheck + dev 验证

- 全测试通过
- 启动器跑通"40 表分析+设计游戏"完整场景
- detector 触发 / 自然 stop / abort 三类路径都验证

**单 commit 落地** — 不拆分(Phase 3 内部无可独立可验证子集)。

### 2.5 风险与回滚

| 风险                                                      | 缓解                                               |
| --------------------------------------------------------- | -------------------------------------------------- |
| persistence 时序错乱(onStepFinish 异步 vs SDK 推进下一步) | onStepFinish 用 `await` 确保串行                   |
| detector observe 在 SDK 推进下一步前完成                  | 同上,onStepFinish 异步 await 是 SDK 保证           |
| experimental_repairToolCall 失败时 fallback               | 返 `null` 让 SDK 继续按 InvalidToolInputError 处理 |
| 测试时序难调试                                            | mock driver 加详细日志 + 顺序断言                  |
| 回归                                                      | 完成后 stash + 启动跑 5 个真实场景前后对比         |

回滚:整个 Phase 3 是一次 commit,`git revert` 即可。

---

## 3. Phase 2b — `tool({ needsApproval })` + IPC + UI

Phase 2a 已落地 `RiskGate.decide()`。Phase 2b 把 confirm 流程从 "execute() 内 sync 阻塞 confirmTool" 改为 SDK 标准 approval part 协议。

### 3.1 关键改动

**`build-tools.ts`** — `dynamicTool` → `tool({ needsApproval, execute, toModelOutput })`:

```ts
import { tool, jsonSchema } from 'ai'

// for each schema:
tools[schema.name] = tool({
  description: schema.description,
  inputSchema: jsonSchema(schema.parameters),
  needsApproval: async (input, { toolCallId, messages }) => {
    const decision = riskGate.decide(toolDef, input)
    if (decision.blocked) {
      // SDK 不支持 sync deny — 返 false (允许) 然后在 execute 内拒
      // (或者 SDK v6.1+ 的 needsApproval 支持 'deny' 返回?)
      return false // TODO: check SDK behavior
    }
    if (decision.needsApproval) {
      // 缓存 decision 给 SDK approval response 阶段用
      pendingApprovals.set(toolCallId, decision)
      return true
    }
    return false
  },
  execute: async (input, options) => {
    // SDK 已处理过 approval (用户 approved 才会到这);
    // 这里只要做 decision.blocked → __talor_error envelope
    const decision = pendingApprovals.get(options.toolCallId) ?? riskGate.decide(toolDef, input)
    if (decision.blocked) {
      return { __talor_error: true, code: 'BLOCKED', message: decision.summary }
    }
    const result = await agent.toolRegistry.execute(schema.name, input, ctx)
    return result.output
  },
  toModelOutput: (output) => {
    return {
      type: 'text',
      value: wrapToolOutput(schema.name, output as string, schema.name === 'skill'),
    }
  },
})
```

**IPC 协议** — 新增 channel `chat:tool-approval`:

```
main → renderer: ToolApprovalRequestPart (SDK 标准 part 透传)
renderer → main: chat:tool-approval-respond { toolCallId, approved, remember? }
```

**preload**:

```ts
// preload/index.ts
contextBridge.exposeInMainWorld('electron', {
  ...,
  onToolApprovalRequest: (cb) => ipcRenderer.on('chat:tool-approval-request', (_, part) => cb(part)),
  respondToolApproval: (resp) => ipcRenderer.send('chat:tool-approval-respond', resp),
})
```

**renderer ToolConfirmDialog** — 监听新事件,响应通过新 channel。

**主进程接住 approval response 后**调 SDK `addToolApproveResponseFunction`(由 streamText 提供):

```ts
const result = streamText({ ..., onApprovalRequest: (req) => { /* emit to renderer */ } })
ipcMain.on('chat:tool-approval-respond', (e, resp) => {
  result.addToolApproveResponse(resp.toolCallId, resp.approved)
})
```

⚠️ **SDK v6 实际 API 已查证** (本会话 spike, 2026-05-14):

- `tool({ needsApproval: (input, { toolCallId, messages }) => boolean | PromiseLike<boolean> })` ✓
- 返 true 时, SDK 暂停 stream + 在 AssistantContent 中 emit `ToolApprovalRequest` part:
  `{ type: 'tool-approval-request', approvalId, toolCallId }`
- 用户响应必须以 `ToolApprovalResponse` part 形式写回:
  `{ type: 'tool-approval-response', approvalId, approved, reason? }`
- **关键**: SDK 暂停 = 当前 streamText 调用 **结束** (不继续, 不阻塞)。
  next call to streamText 时, 把 approval response 拼入 messages 即可继续。
- `ChatAddToolApproveResponseFunction` 在 Chat (UIMessage stream) 层提供;
  Talor 用的是直接 streamText, 需要在 messages 层级手动拼接。

**这意味着**: Phase 2b 不是单纯改 build-tools, 它要求 react-loop **支持 pause/resume**:

1. streamText 跑到 needsApproval 返 true → SDK emit approval-request part, stream 结束
2. react-loop 检测到 ToolApprovalRequest part → 发送给 renderer 等待响应
3. 用户响应到达 → 把 ToolApprovalResponse part 注入 next messages → 再调一次 streamText 继续
4. 这个 "pause/resume" 跨越 react-loop 的 segment 边界 — 需要在外层 while 增加 'awaiting-approval' 分支

工作量重新评估: 3-5 天 → **5-7 天** (包括 react-loop pause/resume 改造)。

### 3.2 实施顺序

**Step 0** ~~(spike)~~ — **已完成**, API 已查证 (见上方 §3.1 注释)

**Step 1** (~2h): react-loop "pause/resume" 改造

- 在 segmentResult 上加 `'awaiting-approval'` kind, 携带 ToolApprovalRequest[]
- 外层 while 收到此 kind → 通过 `ctx.callbacks.onApprovalRequest(req)` 通知 IPC
- await 一个 Promise (callbacks.waitForApproval(approvalId)) → 拿到 ToolApprovalResponse
- 把 response 注入 ctx.pendingApprovalResponses (下次 pipeline.build 拼入 messages)
- 再 loop 一次 (新 segment) — SDK 看到 messages 含 response 即继续

**Step 2** (~1h): build-tools.ts 切到 `tool({ ... })`

- riskGate.decide(toolDef, input) 返 RiskDecision → needsApproval=true/false
- execute() 不再 sync block (因为 needsApproval 已分流)
- toModelOutput: 替代 wrapToolOutput (从 react-loop 内的 persist-step 拉出来)

**Step 3** (~1.5h): IPC + preload + main 监听

- 新 channel `chat:tool-approval-request` (main → renderer): { sessionId, approvalId, toolCallId, summary, ... }
- 新 channel `chat:tool-approval-respond` (renderer → main): { approvalId, approved, reason? }
- main 维护一个 `Map<approvalId, resolver>`,响应到达时 resolve react-loop 的 await Promise

**Step 4** (~1h): renderer ToolConfirmDialog 适配

- 监听新 channel
- 提交新 channel (用 approvalId 取代 toolCallId)
- 旧 chat:tool-confirm 监听删除

**Step 5** (~1h): 集成测试 + 手动验证

- bash / write / edit / fallback SQL 四个路径都过一遍
- 验证: deny 后 LLM 收到的 tool_result 是 "user denied" 类 envelope

**Step 6** (~1h): 删除旧 confirmTool 路径

- `risk-gate.ts:gate()` 删除 (decide() 是唯一对外接口)
- `ipc/tool-confirm.ts requestToolConfirm` 删除
- `ToolConfirmPort` 类型 + `confirmTool` 参数 (build-tools / react-loop / ReactLoopOptions) 全删
- 旧测试中 confirmTool mock 也清理

### 3.3 风险

| 风险                                                       | 缓解                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| SDK approval API 与 plan 文档名不符                        | Step 0 spike 验证                          |
| ToolConfirmDialog UI 适配 SDK part 形态变化大              | 保留 UI 组件 framework,只改 props 来源     |
| memory pattern 自动通过(原 RiskGate 路径 4)在 SDK 视角丢失 | needsApproval 内查 memory,命中直接返 false |

---

## 4. Phase 2b + Phase 3 综合排序建议

**先 Phase 3 (react-loop 重写)** 再 Phase 2b (tool needsApproval),原因:

1. Phase 3 改动 react-loop.ts 内部结构,但**不改 tool 包装方式**(仍是 dynamicTool)。Phase 2b 改 tool 包装。先 3 后 2 避免 react-loop 同时改两件事。
2. Phase 2b 需要 react-loop 已经稳定的 onStepFinish 回调来集成 ledger 等。
3. Phase 2b 改 IPC + UI 协议,用户感知最直接。在 react-loop 稳定后做更安全。

---

## 5. 启动 checklist (下次 session 第一件事)

```bash
# 0. 同步主干
git pull origin master

# 1. 环境
npx electron-rebuild -f -w better-sqlite3  # for dev
npm rebuild better-sqlite3                  # for vitest (前后切换需运行)

# 2. baseline 验证
npm test -- --run                # 应当全绿 1227 passed (Phase 3 后 +12 tests)
npm run typecheck                # 40 errors (pre-existing baseline)
npm run dev                      # 启动跑通一轮对话

# 3. 读这份 plan
cat docs/superpowers/plans/2026-05-14-v4-phase-2b-phase-3-execution.md

# 4. 读 v4 总纲 §3.1 (react-loop SDK 多步) 和 §3.2 (needsApproval)
sed -n '181,500p' docs/superpowers/plans/2026-05-14-talor-v4-sdk-native.md
```

完成 Phase 3 + Phase 2b 后,v4 落地完成:

- react-loop ~600 → ~280 行
- risk-gate gate() 删除,decide() 是唯一对外接口
- IPC tool-confirm channel 退役
- 总收益约删减 1000+ 行代码,SDK 信号统一,持久化收敛到一处

---

**End of plan.**
