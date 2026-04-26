# Main 进程分层整治与关键流程说明补全 — 设计文档

**日期：** 2026-04-26
**范围：** Electron main 进程（`src/main/`）
**目标：** 以"入口—业务—仓储—基础"三层 + 基础设施为准，清理现存反向依赖与职责混合；新增 `chat/` 领域目录承载 chat 用例编排，`loop/` 保留 ReAct 引擎单一职责；为关键流程补 JSDoc。
**验证：** 类型检查 + 单测 + 手动冒烟；全绿后收尾。

---

## 0 · 指导原则

1. **分层原则。** 入口 → 业务 → 仓储 → 基础设施，依赖方向单向。跨层只能向下，同层可横向互用。
2. **高内聚低耦合。** 每个函数/模块承担单一职责；跨层通信优先通过端口（callback / 注入）而非直接 import。
3. **关键流程成文。** ReAct 循环、工具装配、Chat 编排、Prompt 构建、MCP 执行这些"容易踩坑"的方法，强制补 JSDoc。

---

## 1 · 分层定义

分层是**概念**，不是"按技术职责新建 services/ 再把所有业务塞进去"。目录按**领域**聚合；层的依赖方向通过顶部注释声明 + `ARCHITECTURE.md` 汇总。

```
入口层  ipc/
  职责：IPC 协议注册、参数解包、附件协议转换、错误码分类、
        通过回调把业务事件转成 webContents.send
  允许依赖：业务层任意目录、repos/*、shared/*
  禁止：业务决策（provider 选取、工具装配、ReAct 控制流）

业务层（按领域聚合，目录平级）
  chat/        chat 用例编排（本次新增）：chat:send 全流程
               —— orchestrator / attachments / stream-registry / provider-selector
  loop/        ReAct 引擎：多步推理、消息落库、兜底摘要（保持单一职责）
  tools/       工具装配与内建工具实现
  prompt/      Prompt 构建流水线（插件化）
  memory/      短期/长期记忆
  mcp/         MCP 客户端与 transport
  providers/   LLM Provider 适配（Vercel AI SDK 封装）

  允许依赖：业务层其他目录、repos/*、store/*（只读）、shared/*
  禁止：import ipc/*（需要与 UI 通信时通过 callback / 端口注入）

仓储层  repos/
  职责：SQL CRUD，领域对象转换
  允许依赖：db/*、shared/*
  禁止：被业务层以外的任何调用

基础设施
  db/                    sqlite 连接
  store/                 electron-store 配置
  services/              其他原子基础能力（safe-storage / provider-fetcher /
                         capability-detector / model-availability / provider-tester）
  允许依赖：shared/*
```

**重要区分：**
- `chat/`：**用例**层——怎么把一次 chat:send 跑完整（校验 → 选型 → 装工具 → 持久化 → 驱动引擎 → 上报）
- `loop/`：**引擎**层——给定已就绪的 model/tools/pipeline，怎么完成 ReAct 多步推理
- 编排调用引擎。若未来出现别的会话用例（批处理等），可以复用同一个 `loop/`。

`services/` 保留原状（basic infra），**不**作为"业务层容器"使用。

落地方式：每个目录加顶部注释声明所属层 + 允许依赖清单；`src/main/ARCHITECTURE.md` 汇总。存量违反由本次重构修掉。

---

## 2 · 现状违反清单

| # | 位置 | 问题 | 修复方向 |
|---|------|------|---------|
| V1 | `ipc/chat.ts:4,12` | `ConfigStore` 重复 import | 删第 12 行 |
| V2 | `ipc/chat.ts:28-77` | 业务函数（附件校验、provider 选取、user blocks 构造）住在入口层 | 下沉到业务层 |
| V3 | `ipc/chat.ts:79-83` | `activeStreams` Map + `memoryManager/pipeline` 单例住在入口层 | 搬到业务层注册表 |
| V4 | `ipc/chat-utils.ts` | 同文件混着流式控制、tool-result 转换（业务）和错误码分类（协议） | 拆成 `loop/stream-utils.ts` + `ipc/error-codes.ts` |
| V5 | `loop/react-loop.ts:6` | 业务层 import `ipc/chat-utils` —— 反向依赖 | V4 解决后消失 |
| V6 | `tools/build-tools.ts` | 业务层 import `ipc/tool-confirm` —— 反向依赖 | 改端口注入 `confirmTool` |
| V7 | `ipc/session.ts:74` | 文件末尾 import（结构反模式） | 挪到文件头 |
| V8 | `prompt/PromptPipeline.ts:10` | 业务层直接 `ConfigStore.getInstance()` 读默认值 | 本次不动，但加注释标记为已知欠款 |

---

## 3 · 目录与文件变更

```
chat/                     ← 新增领域目录（chat 用例编排）
  orchestrator.ts         chat:send 全流程编排
  attachments.ts          validateAttachment / buildUserBlocks / checkVisionSupport
  provider-selector.ts    getDefaultProvider
  stream-registry.ts      activeStreams 注册表（register / abort / cleanup）

loop/
  react-loop.ts           修改：抽 runReactStep / runFallbackSummary；补 JSDoc
  stream-utils.ts         新增：buildStreamSignal / toolResultPartsToBlocks / truncateOutput / extractOutputText / isErrorOutput
  types.ts                保持

tools/
  build-tools.ts          修改：requestToolConfirm 改端口注入 confirmTool
  …（registry 等保持）

ipc/
  chat.ts                 精简到 ~50 行，只做协议转换 + 回调桥接 + snake/camel 命名转换
  error-codes.ts          新增：ChatErrorCode + classifyLlmError
  tool-confirm.ts         修改：追加 ToolConfirmPort 类型 export；requestToolConfirm 保持
  chat-utils.ts           删除（内容已迁出）
  session.ts              修 V7（尾部 import 上移）
  其余 *.ts               仅补顶部层注释
```

`services/` 保持不变（只有原有的基础能力文件）。

---

## 4 · `chat/orchestrator.ts` 设计（用例编排）

```ts
// chat/orchestrator.ts —— chat 用例编排（业务层）
//
// 职责：接收参数化的 chat 请求 + UI 回调，完成 "附件校验 → 工具装配 →
// 持久化用户消息 → 驱动 ReAct 循环" 的全流程。不感知 Electron / IPC。

export interface ChatSendParams {
  sessionId: string
  content: string
  attachments: Array<{ path: string; mime_type: string; filename: string; size_bytes: number }>
}

export interface ChatCallbacks {
  onTextDelta(messageId: string, delta: string): void
  onToolCall(messageId: string, id: string, name: string, input: unknown): void
  onToolResult(messageId: string, id: string, name: string, output: unknown): void
  onDone(messageId: string, err?: { code: ChatErrorCode; message: string }): void
}

export interface ChatPorts {
  confirmTool: ToolConfirmPort   // 见 §7
}

export async function sendChat(
  params: ChatSendParams,
  callbacks: ChatCallbacks,
  ports: ChatPorts,
): Promise<{ messageId: string }>
```

**编排顺序**（实现中每步带 JSDoc 或行内注释）：

1. `validateAttachment(...)` × N — 逐个校验路径、大小、mime（from `chat/attachments.ts`）
2. `streamRegistry.register(sessionId, messageId)` — 获取 AbortController，若已存在则 abort 旧的（from `chat/stream-registry.ts`）
3. `provider = getDefaultProvider()` — 选 provider（from `chat/provider-selector.ts`）
4. `checkVisionSupport(provider, attachments)` — 视觉能力前置校验
5. `messageRepo.create({role:'user', ...})` + `sessionRepo.touch(sessionId)`
6. `tools = await buildTools({ sessionId, messageId, workspace, confirmTool: ports.confirmTool })`
7. `runReactLoop({...})` — 驱动 ReAct 引擎，内部回调通过 `callbacks.*` 回传
8. `callbacks.onDone(messageId)` — 终态通知（成功或错误码）

**错误处理：** 分类为 `ChatErrorCode` 后通过 `onDone(messageId, { code, message })` 回传，函数不 throw（正常返回 `{ messageId }`）。单一出口，避免渲染端同时收到 stream 错误事件和 Promise reject 造成双通知。入口层 `ipc.handle` 对应地直接 `return sendChat(...)` 即可。

---

## 5 · `ipc/chat.ts` 重写后的形态

```ts
// ipc/chat.ts —— 入口层，只做协议转换
import { ipcMain } from 'electron'
import { getMainWindow } from './window'
import { requestToolConfirm } from './tool-confirm'
import { sendChat } from '../chat/orchestrator'
import { streamRegistry } from '../chat/stream-registry'

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_e, params) => {
    const win = getMainWindow(); if (!win) throw new Error('No main window')

    return sendChat(
      params,
      {
        onTextDelta:  (mid, delta)         => win.webContents.send('chat:stream',      { session_id: params.session_id, message_id: mid, delta, done: false }),
        onToolCall:   (mid, id, name, inp) => win.webContents.send('chat:tool-call',   { session_id: params.session_id, message_id: mid, tool_call_id: id, tool_name: name, input: inp }),
        onToolResult: (mid, id, name, out) => win.webContents.send('chat:tool-result', { session_id: params.session_id, message_id: mid, tool_call_id: id, tool_name: name, result: out }),
        onDone:       (mid, err)           => win.webContents.send('chat:stream',      { session_id: params.session_id, message_id: mid, delta: '', done: true, error_code: err?.code, error_message: err?.message }),
      },
      { confirmTool: (payload) => requestToolConfirm(win, payload) },
    )
  })

  ipcMain.handle('chat:abort', (_e, sessionId: string) => streamRegistry.abort(sessionId))
}
```

预期 ~45 行（含 import）。入口层不再做错误分类、provider 选取、附件校验、ReAct 控制。

---

## 6 · `react-loop.ts` 内部切分

当前 `runReactLoop` 一个函数里裹着三段职责，拆成：

```ts
/**
 * 单步 ReAct：
 * - 构造当步 prompt（含最新 memory 与 tool 历史）
 * - 启动 streamText 并消费全部 chunk
 * - 回写 assistant + tool messages（若本步有工具调用）
 * 返回本步摘要信息；循环控制由 runReactLoop 决定是否继续。
 */
async function runReactStep(ctx: StepContext, stepIndex: number): Promise<StepOutcome>

/**
 * 兜底摘要：ReAct 正常退出但一字未吐时触发。
 * 无 tools，直接 streamText 一次，把文本落库并回调。
 * 任何异常只记录不抛，保证 chat:send 能正常 done。
 */
async function runFallbackSummary(ctx: SummaryContext): Promise<void>

/**
 * ReAct 引擎顶层：
 * - 每步调用 runReactStep，直到 (a) abort、(b) 达到 maxSteps、
 *   (c) 某步无工具调用（正常终态）、(d) 某步工具调用但 toolResults 为空（异常终止）
 * - 若整轮 fullText 为空且未写过终态消息，追加 runFallbackSummary
 */
export async function runReactLoop(opts: ReactLoopOptions): Promise<void>
```

关键分支点（终止条件、assistantFinal 写入时机、兜底触发条件）补 JSDoc 说明 "为什么"。

---

## 7 · 端口注入改造（解决 V6）

**现状：** `tools/build-tools.ts` 直接 `import { requestToolConfirm, buildInputSummary } from '../ipc/tool-confirm'`。

**改造：**

```ts
// ipc/tool-confirm.ts  导出类型
export interface ToolConfirmPayload { /* 现有字段 */ }
export type ToolConfirmPort = (payload: ToolConfirmPayload) => Promise<boolean>

// tools/build-tools.ts
export async function buildTools(opts: {
  sessionId: string
  messageId: string
  workspace: string
  confirmTool: ToolConfirmPort   // ← 注入，不再 import ipc/
}): Promise<Record<string, DynamicTool> | undefined>
```

`buildInputSummary` 是纯格式化，归入 `tools/build-tools.ts` 的 private helper（或独立 `tools/input-summary.ts`）。

`ipc/chat.ts` 调用时传入 `(payload) => requestToolConfirm(win, payload)`。

---

## 8 · 关键流程 JSDoc 清单

| 文件 | 函数 | 重点说明 |
|------|------|---------|
| `loop/react-loop.ts` | `runReactLoop` | 终止条件列表、abort 语义、兜底摘要触发条件 |
| `loop/react-loop.ts` | `runReactStep` | build → stream → persist 顺序、写 assistantFinal vs assistant+tool 两条消息的时机 |
| `loop/react-loop.ts` | `runFallbackSummary` | 触发条件、异常吞咽策略 |
| `tools/build-tools.ts` | `buildTools` | MCP 等待门槛、workspace 为空时过滤内建工具、高风险确认契约 |
| `chat/orchestrator.ts` | `sendChat` | 8 步编排顺序、错误码映射规则 |
| `chat/stream-registry.ts` | `register/abort/cleanup` | 同 session 新请求会 abort 旧请求 |
| `chat/attachments.ts` | `validateAttachment` | 抛 `FILE_NOT_FOUND/FILE_TOO_LARGE/UNSUPPORTED_FILE_TYPE` |
| `chat/provider-selector.ts` | `getDefaultProvider` | 选择优先级：is_default → enabled → throw |
| `ipc/error-codes.ts` | `classifyLlmError` | 分类规则表 |
| `prompt/PromptPipeline.ts` | `build` | 插件顺序固定、单个失败不阻塞整体 |
| `mcp/client.ts` | 内部 provider `execute` | 重连 3 次、30s 超时、错误只返回字符串 |

仓储层接口不补（命名已自解释）。

---

## 9 · 测试计划

| 测试文件 | 覆盖 | 操作 |
|---------|------|------|
| `loop/react-loop.test.ts` | 现有 text-only / abort 两用例 | 保持通过 |
| `chat/orchestrator.test.ts` | 编排顺序、provider 选取、附件异常 → 错误码、abort 路径 | 新建 |
| `chat/attachments.test.ts` | FILE_NOT_FOUND / FILE_TOO_LARGE / UNSUPPORTED / vision-mismatch | 新建 |
| `chat/stream-registry.test.ts` | 新请求 abort 旧请求；cleanup 幂等 | 新建 |
| `chat/provider-selector.test.ts` | 选择优先级：default → enabled → throw | 新建 |
| `loop/stream-utils.test.ts` | 迁移 chat-utils 原有测试（如果有） | 迁移 |
| `ipc/error-codes.test.ts` | 迁移 classifyLlmError 现有测试 | 迁移 |
| `ipc/chat.test.ts` | 现有集成测试 | 调整 mock 目标，保持绿 |

---

## 10 · 验证流程（用户要求）

**每步 commit 都满足：**

1. `npm run typecheck` 无新增错误
2. `npm run test:run` 全绿

**关键步骤后（如 ipc/chat.ts 重写完毕）启动 dev 手动走一遍：**

- 纯文本发送 → SSE 正常、消息落库
- 带图片附件 + 支持 vision 的 provider → 识图
- 带图片附件 + 不支持 vision 的 provider → 错误码 `PROVIDER_NO_VISION`
- 触发高风险工具（bash） → 确认弹窗
- 发送中点 stop → abort 生效、流正常结束
- MCP 工具调用 → 工具装配和结果回显

**整个重构完成后：** `npm run typecheck && npm run test:run && npm run build`

---

## 11 · 文件变更总表

| 操作 | 路径 | 行数预估 |
|------|------|---------|
| 新建 | `src/main/chat/orchestrator.ts` | ~140 |
| 新建 | `src/main/chat/orchestrator.test.ts` | ~120 |
| 新建 | `src/main/chat/attachments.ts` | ~60 |
| 新建 | `src/main/chat/attachments.test.ts` | ~80 |
| 新建 | `src/main/chat/provider-selector.ts` | ~15 |
| 新建 | `src/main/chat/provider-selector.test.ts` | ~40 |
| 新建 | `src/main/chat/stream-registry.ts` | ~35 |
| 新建 | `src/main/chat/stream-registry.test.ts` | ~40 |
| 新建 | `src/main/loop/stream-utils.ts` | ~75 |
| 新建 | `src/main/loop/stream-utils.test.ts` | ~80 |
| 新建 | `src/main/ipc/error-codes.ts` | ~30 |
| 新建 | `src/main/ipc/error-codes.test.ts` | ~40 |
| 新建 | `src/main/ARCHITECTURE.md` | ~80 |
| 修改 | `src/main/ipc/chat.ts` | 205 → ~50 |
| 删除 | `src/main/ipc/chat-utils.ts` | - |
| 删除 | `src/main/ipc/chat.test.ts`（迁到 error-codes + stream-utils） | - |
| 修改 | `src/main/ipc/session.ts` | 修 V7 |
| 修改 | `src/main/ipc/tool-confirm.ts` | 导出 `ToolConfirmPort` |
| 修改 | `src/main/loop/react-loop.ts` | 换 import；抽函数；补 JSDoc |
| 修改 | `src/main/tools/build-tools.ts` | 改端口注入 |
| 修改 | `src/main/prompt/PromptPipeline.ts` | 加 JSDoc + 分层注释 |
| 修改 | `src/main/mcp/client.ts` | 关键方法补 JSDoc |

---

## 12 · 范围外（显式不做）

- **目录结构不迁。** `loop/ tools/ prompt/ memory/ mcp/ providers/` 保持与 `services/` 平级；分层靠注释 + `ARCHITECTURE.md` 声明。
- **renderer 层。** 本 spec 仅覆盖 `src/main/`。
- **PromptPipeline 依赖注入改造（V8）。** 标记为已知欠款，后续独立 spec。
- **数据库 schema / repos API 改动。** 无。
- **新增功能。** 无。

---

## 13 · 风险与回滚

- **Import 路径大规模改动：** 风险点是测试 mock 路径失效。策略：每个模块迁移后先跑对应单测，再跑全量。
- **tool-confirm 端口化：** 改造 signature，在同一个 commit 内同步更新 `chat.ts` 调用，避免中间态 typecheck 失败。
- **回滚：** 每步独立 commit，任一步发现问题可 `git revert` 单步。
