# Phase 2 会话执行 Prompt
# talor-desktop P0 Agent Loop — ReAct 推理链实时入库 + context 重建

> **前置要求**：Phase 1 certificate 已签收，`src/shared/types/message.ts` 已存在，DB 已清库迁移，messageRepo 已支持 ContentBlock 序列化。

---

## §一 编码红线

<!-- from: OVERVIEW-talor-desktop.md §MO.2 + §MO.7 + §MO.8，语气改写为第二人称强制 -->

1. 你必须在 renderer 进程中通过 `talorAPI`（contextBridge）访问 main process，禁止 renderer 直接 import electron 模块
2. 你必须使用 Proxy 懒加载模式暴露 talorAPI，禁止在模块顶层直接赋值 `window.talorAPI`
3. 你必须通过 `SafeStorageService` 加密存储 API Key，禁止明文存储
4. 你必须对 config.json 写入使用原子 rename，禁止直接覆盖
5. 你必须在流式 streaming 状态下禁用发送按钮，禁止重复发送
6. 你必须启用 SQLite 外键约束（`db.pragma('foreign_keys = ON')`），禁止省略
7. 你禁止修改 `venv/` 目录
8. 你禁止删除或重命名 SQLite 表字段
9. 你禁止升级 major 版本依赖
10. 你禁止超过 5 个文件的改动而不先列清单等确认
11. 你必须保持 Ollama provider 的 base_url 不含 `/v1`

---

## §二 代码模式

<!-- from: OVERVIEW-talor-desktop.md §MO.7，原文复制 -->

### 流式消息 Hook（Good Pattern）

```typescript
// src/renderer/hooks/useStreamingMessage.ts
const { sendMessage, abort } = useCallback((sessionId, content) => {
  setStreamState('streaming');
  const eventSource = talorAPI.chat.send(sessionId, content);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'text') {
      setPendingContent(prev => prev + data.content);
    } else if (data.type === 'done') {
      setStreamState('done');
    }
  };
  
  eventSource.onerror = () => setStreamState('error');
}, []);
```

### 禁止：流式时重复发送（Anti-Pattern）

```typescript
// ❌ 错误 - 无保护
const handleSend = () => talorAPI.chat.send(...);

// ✅ 正确 - 禁用按钮
<button disabled={streamState === 'streaming'} onClick={handleSend}>
  发送
</button>
```

---

## §三 术语表

<!-- from: requirements.md §1.3，原文复制 -->

| 术语 | 定义 | 代码命名 | 易混淆项 |
|------|------|----------|----------|
| ContentBlock | 消息内容的原子单元，有类型标注（text / tool_use / tool_result / image / file） | `ContentBlock` | MessagePart（旧类型，废弃） |
| tool_use block | 表示一次工具调用请求的 ContentBlock，含 toolCallId / toolName / input | `ToolUseBlock` | tool_result block |
| tool_result block | 表示一次工具执行结果的 ContentBlock，含 toolCallId / toolName / output / isError | `ToolResultBlock` | tool_use block |
| ReAct step | Agent 推理循环的一轮：LLM 输出 → 执行工具 → 追加消息 | `reactStep` | 单次 streamText 调用 |
| 推理链 | 一次用户消息触发的完整多步工具调用序列，含所有 tool_use + tool_result messages | `reasoningChain` | 单条 assistant message |
| assistant message | role='assistant' 的消息，content 可含 text block 和/或 tool_use blocks | `assistantMessage` | tool message |
| tool message | role='tool' 的消息，content 含一组 tool_result blocks，对应一轮 tool_use | `toolMessage` | assistant message |
| HIGH 级工具 | 执行前必须弹确认框的内置工具：bash / write / edit | `HIGH_RISK_TOOLS` | LOW 级工具 |
| LOW 级工具 | 静默执行的只读内置工具：read / glob / grep / ls | `LOW_RISK_TOOLS` | HIGH 级工具 |
| 工具确认请求 | 主进程向渲染进程发送的确认事件，含工具名 + 参数摘要 | `ToolConfirmRequest` | tool_call IPC 事件 |
| 工具确认响应 | 渲染进程回传的用户决策：approved / rejected | `ToolConfirmResponse` | tool_result |
| 清库迁移 | 丢弃全部历史 messages 数据，重建表结构 | `dropAndRecreate` | 兼容迁移 |

---

## §四 决策框架

<!-- from: requirements.md §1.7，原文复制 -->

**优先级排序**：正确性 > 安全性 > 性能 > 体验

| 场景 | 决策 |
|------|------|
| 消息模型 schema 变更 | 清库重来（丢失历史数据），不做兼容迁移 |
| content_type 缺失的旧消息 | parse 失败时降级为空 text block，不 crash |
| tool_result 大输出 | 截断到 50KB，不存全量 |
| 确认框超时 | 自动拒绝，不自动批准 |
| 用户拒绝工具执行 | Agent 收到拒绝 tool_result，由 Agent 自行决策，不强制终止 loop |
| MCP 工具风险分级 | P0 阶段全部 MCP 工具静默执行，后续迭代再分级 |

---

## §五 已知陷阱

<!-- from: implementation.md §4.3，语气改写为第二人称强制 -->

1. 你必须在 `electron.vite.config.ts` 为 main 和 renderer 都添加 `@shared` 别名，指向 `src/shared/`
2. 你必须注意 Vercel AI SDK `role: 'tool'` 消息格式：content 必须是 `{ type: 'tool-result', toolCallId, toolName, result }` 数组，不是 `tool_result`
3. 你在清库迁移后保留 try/catch 降级到 `[{type:'text', text: content}]` 作为防御
4. 你必须在 `await result.toolResults` 之后才能写库，`toolResults` 是 Promise，提前调用无值
5. 你在使用 `ipcMain.once` 时必须处理 Promise.race 后的多余响应：收到响应后校验 toolCallId 一致才 resolve
6. 你在多 session 并发时必须用 toolCallId 区分不同 session 的 confirm 响应
7. 你必须确保 `ToolConfirmDialog.tsx` 在 `src/renderer/components/` 下
8. 你在写 tool_result output 时必须统一 `String(output ?? '')` 处理 undefined

---

## §六 验证环境

| 项目 | 值 |
|------|---|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| 启动命令 | `npm run dev` |
| DB 路径 | `~/.talor/chat.db` |
| 验证工具 | `sqlite3 ~/.talor/chat.db` + Electron main log |
| LLM 要求 | 配置支持 tool calling 的模型，设置 workspace |

---

## §七 会话状态

**当前 Phase**：Phase 2 — ReAct 推理链实时入库 + context 重建

**任务队列**（按 Critical Path 顺序执行）：
1. ⬜ IMPL-004：重写 toCoreMessages()（`src/main/ipc/chat.ts`）
2. ⬜ IMPL-005：ReAct loop 每 step 后实时写库（`src/main/ipc/chat.ts`）

**阶段退出标准**：用户触发多步工具调用后重启应用，下一轮对话 LLM 仍能看到历史 tool_use/tool_result（main log 可确认）（AC-001-03 ~ AC-001-06 通过）

**下一 Phase**：Phase 3 — 高风险工具确认流程（需 Phase 2 certificate 签收）
