# Talor Block 协议 + 系统性容错方案 (v3.6)

> 实施日期: 2026-05-12 起
> 状态: 阶段 1 实施中
> 目标: 让 react-loop 具备系统性容错能力 — 高危操作授权、副作用可追溯、意图一致性、可扩展协议

---

## 0. 总览

| 维度         | 现状 (5/10) | v3.6 后                                  |
| ------------ | ----------- | ---------------------------------------- |
| 高危操作授权 | ✗           | ✓ (`pending_confirm` block + 兜底 regex) |
| 副作用可追溯 | ✗           | ✓ (Ledger + forced summary 内嵌)         |
| 意图一致性   | 部分        | ✓ (Discriminated block + Detector)       |
| 失败态明确   | ✓           | ✓ (5 个 block 类型)                      |
| 弱模型友好   | ✓           | ✓ (文本 marker 兜底)                     |
| 协议可扩展   | -           | ✓ (`talor:` block 家族)                  |
| **综合**     | **5/10**    | **8/10**                                 |

**总投入**: 11.5 天, 3 阶段独立可发布。

---

## 1. 设计原则

| #   | 原则             | 实质                                                                                        |
| --- | ---------------- | ------------------------------------------------------------------------------------------- |
| 1   | 声明式分层       | 每层接口单一、可测、独立演进                                                                |
| 2   | 不替换、只扩展   | 复用 ToolDefinition / ToolConfirmPort / messageRepo                                         |
| 3   | 保守优先         | 不确定时通知用户 > 自动补救                                                                 |
| 4   | 零回归承诺       | 默认行为不变，新逻辑 opt-in                                                                 |
| 5   | 量化目标         | 每阶段 3-4 个可测指标                                                                       |
| 6   | **判断交给 LLM** | **业务/语义/风险判断由 LLM 通过结构化 block 声明; 代码只做执行管控 + 通用兜底, 不绑业务名** |

---

## 2. 五层架构

````
┌──────────────────────────────────────────────────────────────┐
│ L0  Talor Block 协议   统一的 fenced JSONC 决策点表达         │
│                        ```talor + {"type": "...", ...}        │
├──────────────────────────────────────────────────────────────┤
│ L1  流程健康度          Phase 1B 4 个 Detector (不动)         │
├──────────────────────────────────────────────────────────────┤
│ L2  语义一致性          2 个兜底 Detector                     │
│                        WaitAndActConflict / HallucinatedConfirm│
├──────────────────────────────────────────────────────────────┤
│ L3  风险 Gate           pending_confirm block 主控 +          │
│                        通用 regex 兜底 + 批准记忆             │
├──────────────────────────────────────────────────────────────┤
│ L4  副作用 Ledger       SQLite 记录, 父子 session 聚合,       │
│                        forced summary 内嵌副作用区块          │
├──────────────────────────────────────────────────────────────┤
│ L5  UI 增强             6 个 Talor Block UI 卡片 +            │
│                        Confirm Dialog 增强 + 事件驱动同步     │
└──────────────────────────────────────────────────────────────┘
````

---

## 3. Talor Block 协议

### 3.1 通用格式

````
```talor
{
  "type": "<block-type>",
  ...fields...
}
```
````

**核心约定**:

- Fence tag 统一为 `talor` (无 `:type` 后缀)
- 类型由 JSON `type` 字段 discriminated
- **`type` 必须是 JSON 的第一个 key** (让流式提取早期生效)
- JSONC 支持: `// 注释`、trailing comma、宽容 parse

### 3.2 V1 实施 5 个 Block + V2 预留

```typescript
export type TalorBlock =
  | DoneBlock
  | NeedInputBlock
  | BlockedBlock
  | PendingConfirmBlock
  | WarningBlock
  | PlanBlock // V2

export interface DoneBlock {
  type: 'done'
  summary: string
  result?: unknown
}

export interface NeedInputBlock {
  type: 'need_input'
  question: string
  choices?: string[]
  reason?: string
}

export interface BlockedBlock {
  type: 'blocked'
  reason: string
  can_retry?: boolean
  retry_hint?: string
}

export interface PendingConfirmBlock {
  type: 'pending_confirm'
  summary: string
  pattern?: string
  preview?: string
  risk_level?: 'high' | 'destructive'
}

export interface WarningBlock {
  type: 'warning'
  message: string
  severity?: 'low' | 'medium' | 'high'
}

export interface PlanBlock {
  // V2
  type: 'plan'
  steps: Array<{ step: number; action: string; target?: string }>
}
```

---

## 4. 实施路线

### 阶段 1 — Gate + Ledger (4 天)

**目标**: 阻止未授权高危操作 + 副作用可追溯

| Day | 任务                                                                      |
| --- | ------------------------------------------------------------------------- |
| 1   | TalorBlock schema + parser + jsonc-parser 依赖 + 单测 (15+)               |
| 1   | SideEffectLedger sqlite 表 + migration + repo + 单测 (10+)                |
| 1   | RiskGate + SessionApprovalMemory + buildTools 集成 + ConfirmTool 协议扩展 |
| 1   | Prompt Rule 14 + Rule 12 扩展 + 端到端测试 + 量化指标                     |

**Done 标准**:

- TalorBlock 解析成功率 ≥95%
- pending_confirm block 主动声明率 (强模型 ≥80%)
- 兜底拦截率 ≥95%
- Approval memory 复用 (1 session 5 次同 pattern → 弹 1 次)
- Ledger 完整性 100%
- 1069 现有测试全绿

### 阶段 2 — Detector + Marker (2.5 天)

**目标**: 意图一致性 + Detector 字段化判定

| Day | 任务                                                        |
| --- | ----------------------------------------------------------- |
| 1   | LoopDetector 接口加 raw 参数 + 2 个 SemanticDetector + 单测 |
| 0.5 | OutcomeFacts 扩展 (blocks/hasDone/...)                      |
| 0.5 | runForcedSummary 接入 ledger.buildSummary                   |
| 0.5 | Prompt Rule 13 重写 (talor block schema 完整文档)           |

**Done 标准**:

- WaitAndActConflict 召回 ≥85%, 误报 <15%
- HallucinatedConfirm 召回 ≥70%
- Forced summary 含 ledger 100%

### 阶段 3 — UI (3 天)

**目标**: 用户体验完整

| Day | 任务                                                                |
| --- | ------------------------------------------------------------------- |
| 1.5 | TalorBlockRenderer + 5 个 Card 组件 + Skeleton + MessageBubble 集成 |
| 0.5 | ToolConfirmDialog 增强                                              |
| 1   | 事件驱动 IPC `chat:message-persisted` 替换 polling                  |

**Done 标准**:

- messages 同步延迟 <500ms
- Confirm UX 全通过 (batch/cancel/remember)
- 5 种 block 卡片渲染 100% 成功

### 测试 + 收尾 (2 天)

| Day | 任务                                              |
| --- | ------------------------------------------------- |
| 1   | 端到端测试 4 case + 量化指标全面采集              |
| 1   | 文档更新 (patterns.md + standards.md) + CHANGELOG |

---

## 5. 关键接口契约

### 5.1 TalorBlock Parser

```typescript
// src/main/loop/talor-block-schema.ts
export type TalorBlock = /* §3.2 */
export type TalorBlockType = TalorBlock['type']

// src/main/loop/talor-block-parser.ts
export function parseTalorBlocks(stepText: string): {
  blocks: TalorBlock[]
  invalid: Array<{ raw: string; reason: string }>
}

export function detectStreamingTalorType(streamingText: string): string | null
```

### 5.2 RiskGate

```typescript
// src/main/tools/risk-gate.ts
export class RiskGate {
  constructor(
    private memory: SessionApprovalMemory,
    private ledger: SideEffectLedger,
  )

  async gate(
    tool: ToolDefinition,
    input: unknown,
    ctx: ToolExecuteContext,
    confirmTool: ToolConfirmPort,
  ): Promise<GateDecision>
}

export interface GateDecision {
  action: 'pass' | 'deny' | 'pass-to-legacy'
  via: 'pendingBlock' | 'fallback' | 'memory' | 'auto-low' | 'legacy'
  summary?: string
  patternKey?: string
  rememberRequested?: boolean
}
```

**`pass-to-legacy` 实施补充** (实施后追加,2026-05-12):

V1 builtin 的 bash/write/edit 有静态 `riskLevel='HIGH'` + 已存在的 confirm 路径
(buildTools 直接调 confirmTool)。为避免 RiskGate 与旧路径双重弹窗,Gate 在
检测到 `tool.riskLevel === 'HIGH'` 时返回 `action='pass-to-legacy', via='legacy'`,
buildTools 看到此 decision 走原 high-risk 流程。

- pass-to-legacy 路径**不进 ledger** (legacy 路径自己 confirm,不参与 v3.6 审计)
- 未来若把 bash/write/edit 统一并入 Gate 主路径,此 action 可移除

**Ledger 内嵌职责** (实施后追加,2026-05-12):

Gate 通过 (pendingBlock / fallback / memory) 时**在 Gate 内部调 ledger.record**,
buildTools 不需重复记账。匹配方案双注入设计 — ledger 是 Gate 的协作者,不是
buildTools 的。auto-low 路径不记账。

// src/main/tools/session-approval-memory.ts
export class SessionApprovalMemory {
approve(sessionId: string, patternKey: string): void
isApproved(sessionId: string, patternKey: string): boolean
clear(sessionId: string): void
}

````

### 5.3 SideEffectLedger

```typescript
// src/main/repos/side-effect-ledger.ts
export interface SideEffectEntry {
  id: string
  session_id: string
  parent_session_id: string | null
  message_id: string
  tool_call_id: string
  step_index: number
  op: string
  target: string
  preview: string
  confirmed_by: 'pendingBlock' | 'fallback' | 'memory' | 'auto-low'
  user_decision: 'approved' | 'denied' | 'auto'
  created_at: string
}

export class SideEffectLedger {
  record(entry: Omit<SideEffectEntry, 'id' | 'created_at'>): SideEffectEntry
  listByRootSession(
    rootSessionId: string,
    opts?: { sinceTime?: string; sinceStepIndex?: number },
  ): SideEffectEntry[]
  buildSummary(rootSessionId: string, sinceTime: string): string
  clearBySession(sessionId: string): void
}
````

**sinceTime vs sinceTurn 改名说明** (实施后追加,2026-05-12):

原方案 `sinceTurn: number` 想表达"本 turn 起始的 step_index 划界",但 step_index
跨 turn 重置 (每次 sendChat 从 0 起算),用 step_index 过滤无法区分历史 turn 的副作用。

改为 `sinceTime: string` (ISO timestamp):

- `runReactLoop` 启动时 snapshot `new Date(loopStart).toISOString()` 透传给
  `ForcedSummaryCtx.turnStartTime`
- `buildSummary` / `listByRootSession` 用 `created_at >= sinceTime` 过滤
- 保留 `sinceStepIndex` 作 secondary filter (二者同时给为 AND 关系),用于
  同 turn 内"从某 step 起"的细分查询

````

### 5.4 ToolExecuteContext / ToolConfirmPort 扩展

```typescript
// src/main/tools/types.ts
export interface ToolExecuteContext {
  // 已有...
  /** v3.6: 本 step 的 talor blocks (供 RiskGate 提取 pending_confirm) */
  currentStepBlocks?: TalorBlock[]
}

// src/main/ipc/tool-confirm.ts
export interface ToolConfirmRequest {
  // 已有...
  summary?: string
  preview?: string
  allowRemember?: boolean
  riskLevel?: 'high' | 'destructive'
}

export interface ToolConfirmResponse {
  approved: boolean
  remember?: boolean
}
````

### 5.5 OutcomeFacts 扩展

```typescript
// src/main/loop/outcome-facts.ts
export interface OutcomeFacts {
  // 已有...
  blocks: TalorBlock[]
  invalidBlocks: Array<{ raw: string; reason: string }>

  hasDone: boolean
  hasNeedInput: boolean
  hasBlocked: boolean
  hasPendingConfirm: boolean
  hasWarning: boolean

  hasLegacyMarker: boolean
  hasTermination: boolean
}
```

### 5.6 LoopDetector 接口扩展

```typescript
// src/main/loop/detectors/types.ts
export interface LoopDetector {
  readonly name: string
  observe(facts: OutcomeFacts, raw?: DetectorRawContext): DetectorVerdict
  nextHint?(): string | null
}

export interface DetectorRawContext {
  stepText: string
  sessionId: string
  stepIndex: number
  userMessageHistory: ReadonlyArray<{ created_at: string }>
}
```

---

## 6. Prompt 改动 (Rule 12/13/14)

### Rule 13 重写

教模型用统一 talor block 协议表达决策点。详见 SystemPlugin.ts 实施。

### Rule 14 新增

教模型副作用前必须 emit pending_confirm block。详见 SystemPlugin.ts 实施。

### Rule 12 扩展

加"等待对偶面" — 说要等用户就不能调工具。

---

## 7. 决策固化

| 决策             | 选择                                                          |
| ---------------- | ------------------------------------------------------------- |
| 设计原则         | 6 条 (含原则 #6 "判断给 LLM")                                 |
| 格式协议         | 单一 fenced JSONC (`+talor` + type discriminated)             |
| Block 类型 V1    | 5 个: done / need_input / blocked / pending_confirm / warning |
| Block 类型 V2    | plan / diagram / checkpoint / ref                             |
| Type 字段位置    | 必须第一 key                                                  |
| JSONC 解析器     | `jsonc-parser` 库 (~10KB)                                     |
| 字段校验         | lenient (缺/错进 invalidBlocks)                               |
| 文本 marker 兜底 | 保留 (✓/❓/⏸/✋)                                              |
| 风险评估主路径   | LLM 通过 pending_confirm block 声明                           |
| 兜底机制         | 通用 regex (不绑业务)                                         |
| Subagent ledger  | 父聚合 root_session                                           |
| Ledger 侧栏      | V1 不做 (forced summary 内嵌)                                 |
| Approval memory  | session-level + LLM 生成 pattern                              |

---

## 8. 不做 (YAGNI)

| 项                            | 为什么不做                            |
| ----------------------------- | ------------------------------------- |
| 🔄 Reverting marker           | 无机制兑现                            |
| User patterns regex 配置      | 删 — 用自然语言进 agent prompt        |
| LLM 独立评估调用              | 违反原则 #6                           |
| 完整 SQL parser               | 通用 regex + stripSqlNoise 已覆盖 95% |
| 自动 revert 执行              | 信任模型生成的 SQL 反引入新风险       |
| Ledger 独立侧栏               | V2                                    |
| Plan/Diagram/Checkpoint block | V2                                    |
| 业务表级颗粒度自动识别        | 模型自判                              |
| ToolDefinition.evaluateRisk   | 用 pending_confirm 替代               |
| meta-tool 风格 confirm        | 与 ReAct 流式 UX 冲突                 |
| 事务化 SQL (BEGIN/COMMIT)     | MCP 协议不支持                        |

---

## 9. 远期延伸 (V2+)

`talor` JSONC 协议建立后, 扩展几乎免费:

| 块 type           | 用途                 |
| ----------------- | -------------------- |
| `plan`            | 模型预先输出多步计划 |
| `checkpoint`      | 模型保存中间状态     |
| `diagram`         | 渲染 mermaid/SVG     |
| `ref`             | 引用文档链接         |
| `cost_estimate`   | 模型预估 token 消耗  |
| `revert`          | 模型主动声明回滚     |
| `delegate_intent` | 委托前的预声明       |

每个新 block 只需: 1 段 prompt + 1 UI 卡片 + 0~1 detector。

---

## 10. 风险登记

| 风险                                   | 概率        | 影响 | 缓解                                          |
| -------------------------------------- | ----------- | ---- | --------------------------------------------- |
| 模型不 emit pending_confirm 直接调工具 | 高 (弱模型) | 中   | 兜底 regex + RISK_NOTICE_HINT 注入            |
| Block JSON 解析失败                    | 中 (弱模型) | 低   | invalidBlocks 记录 + legacy marker 兜底       |
| `type` 字段不在第一位                  | 中          | 低   | 流式 skeleton 退回通用占位; 最终 parse 仍成功 |
| Approval memory 培养机械批准           | 中          | 中   | DESTRUCTIVE 不允许 remember; 监控 click-time  |
| 兜底 regex 误报                        | 低          | 低   | stripSqlNoise 剥离字符串/注释                 |
| Subagent ledger 父 session 增长        | 中          | 低   | sql index on parent_session_id                |
| 事件驱动 IPC 重构回归                  | 中          | 高   | 阶段 3 独立 PR + 灰度 + polling fallback      |
| jsonc-parser 引入新依赖                | 低          | 低   | 库 ~10KB 稳定                                 |

---

## 11. 兼容性矩阵

| 现有模块                  | 改动                                       |
| ------------------------- | ------------------------------------------ |
| Phase 1B detectors        | 零改动                                     |
| `runForcedSummary`        | 小改 (加 ledger summary)                   |
| `ToolConfirmPort`         | 扩展字段                                   |
| `ToolDefinition`          | 零改动                                     |
| `ToolExecuteContext`      | 加可选字段 currentStepBlocks               |
| `LoopDetector` 接口       | 加可选第二参数 raw context                 |
| Prompt BEHAVIORAL_CHARTER | Rule 13 重写 + Rule 14 新增 + Rule 12 扩展 |
| `react-loop` 主循环       | 改 ~10 行 (加 SemanticDetector 数组)       |
| `messageRepo`             | 加 IPC 事件                                |
| `MessageBubble.tsx`       | 加 talor fence 分支                        |
| 现有 1069 测试            | 零回归                                     |

---

## 12. 实施后修订 (2026-05-12)

本节记录方案与实施的差异 + V2 deferred 项,作为方案 → 落地的单一事实来源。

### 12.1 已实施且符合方案

- L0 协议 + parser + 5 V1 block 类型 + plan(V2 stub): 全部到位
- L3 RiskGate (4 路径) + SessionApprovalMemory + 双注入构造 (memory + ledger): 全部到位
- L4 SideEffectLedger + 父子聚合 + FK CASCADE: 全部到位
- L2 SemanticDetector (WaitAndActConflict + HallucinatedConfirm): 全部到位
- L5 5 个 UI Card + Skeleton (流式) + 增强 ToolConfirmCard: 全部到位
- 事件驱动 IPC `chat:message-persisted` 替换 polling: 全部到位 (兜底 30s polling 保留防回归)
- Prompt Rule 13 重写 + Rule 14 新增: 全部到位

### 12.2 方案修订项 (回写)

| 项                    | 方案               | 实施                      | 原因                                                             |
| --------------------- | ------------------ | ------------------------- | ---------------------------------------------------------------- |
| `GateDecision.action` | `'pass' \| 'deny'` | + `'pass-to-legacy'`      | builtin bash/write/edit 静态 HIGH 保留旧 confirm 路径,避免双弹窗 |
| `GateDecision.via`    | 4 种               | + `'legacy'`              | 配 pass-to-legacy 使用                                           |
| `sinceTurn: number`   | step_index 过滤    | `sinceTime: string` (ISO) | step_index 跨 turn 重置无法区分历史 turn                         |
| Ledger 记账位置       | 方案未明           | 在 Gate 内部              | buildTools 不再持有 ledger 依赖,职责单一                         |

### 12.3 V2 deferred

- **Batch confirm**: 方案 Done 标准提到 `(batch/cancel/remember)`,V1 实现了 cancel + remember,batch 未实现。原因: ReAct 流是 sequential per-tool 调用, batch 需要主进程缓冲多个 pending_confirm 一起送 UI,改动较深且方案未给具体 API。
- **plan / diagram / checkpoint / ref / cost_estimate block**: 方案 §9 已明确为 V2
- **subagent 嵌套 buildTools 的 ledger 父子链**: V1 顶层 buildTools 总是 root (`parentSessionIdForLedger: null`),subagent 真正委托时需补 root chain
- **量化指标采集 (解析成功率 / 召回率 / 兜底拦截率)**: 单测覆盖了功能,但生产采集需要 telemetry hook,未实施

### 12.4 测试 + 文档收尾完成度

- 单测: 1213 pass (+143 v3.6 新增), 0 回归
- 类型检查: 17 errors (历史 baseline),无新增
- 端到端 4 case: 未实施 (需要真实模型对话录制,留作后续 dogfood)
- patterns.md + standards.md 更新: 见 commit 历史 (P2-5 commit)
- CHANGELOG: 见 commit 历史
