<!--
doc-id: IMPL-phase-3
phase: 3
status: pending
version: 1.0
last-updated: 2026-04-25
depends-on: [IMPL-phase-2]
-->

# Phase 3 impl — 高风险工具确认流程 + UI

> **阶段目标**：用户触发 bash/write/edit → 看到 ToolConfirmDialog → 点击"执行"或"拒绝"→ 工具按预期执行或跳过。

---

## §1 Checkpoint（会话恢复用）

```
上次停在：[等待 Phase 2 完成]
当前卡点：无
下次从：IMPL-006 开始（Phase 2 certificate 签收后）
```

---

## §2 IMPL 任务注册表

### IMPL-006：工具分级 + confirm IPC 流程（主进程侧）

**追溯链**：US-003 → FD-talor-desktop-p0-agent-loop §F.3, §F.4, §F.5 → IMPL-006
**关联 AC**：AC-003-01, AC-003-02, AC-003-03, AC-003-04, AC-003-05
**优先级**：P0

**任务描述**：

1. **修改 `src/main/tools/types.ts`**：
   - `ToolDefinition` 新增可选字段 `riskLevel?: 'HIGH' | 'LOW'`

2. **修改各 builtin 工具注册**（`src/main/tools/builtin/bash.ts`、`write.ts`、`edit.ts`）：
   - 在 `toolRegistry.register()` 调用中加 `riskLevel: 'HIGH'`
   - read/glob/grep/ls 不改（默认 LOW）

3. **修改 `src/main/ipc/chat.ts`** — 在 ReAct loop 工具执行前插入 confirm 流程：
   ```typescript
   // 在 dynamicTool execute 回调内（当前第 296-310 行区域）
   // 判断是否需要确认
   const toolDef = toolRegistry.getTool(schema.name)
   const needsConfirm = toolDef?.riskLevel === 'HIGH'
                     && HIGH_RISK_TOOLS.includes(schema.name as HighRiskTool)

   if (needsConfirm) {
     const confirmed = await requestToolConfirm(mainWindow, {
       sessionId,
       messageId,
       toolCallId: chunk.toolCallId,  // 注意：此处在 onChunk 内，toolCallId 从 chunk 获取
       toolName: schema.name,
       inputSummary: buildInputSummary(schema.name, input),
       inputFull: input,
     })
     if (!confirmed) {
       return { output: '用户拒绝执行', isError: true }
     }
   }
   ```

4. **新增辅助函数**（同文件或抽到 `src/main/ipc/tool-confirm.ts`）：
   ```typescript
   // requestToolConfirm：发送 confirm 事件，等待响应，30s 超时
   async function requestToolConfirm(
     mainWindow: BrowserWindow,
     req: ToolConfirmRequest
   ): Promise<boolean>

   // buildInputSummary：按工具名生成摘要（≤500 chars）
   // bash → command 字段
   // write → path + content 前 20 行（每行 ≤80 chars）
   // edit → path + old_str 前 10 行
   function buildInputSummary(toolName: string, input: unknown): string
   ```

5. **修改 `src/preload/index.ts`**：
   - 新增 `ToolConfirmRequest` / `ToolConfirmResponse` 接口
   - 新增 `chat.onToolConfirm(callback)` — 监听 `chat:tool-confirm` 事件
   - 新增 `chat.sendToolConfirmResponse(response)` — 发送 `chat:tool-confirm-response`

**文件变更**：
- 修改 `src/main/tools/types.ts`
- 修改 `src/main/tools/builtin/bash.ts`、`write.ts`、`edit.ts`
- 修改 `src/main/ipc/chat.ts`（confirm 流程插入）
- 新建 `src/main/ipc/tool-confirm.ts`（辅助函数）
- 修改 `src/preload/index.ts`

---

### IMPL-007：ToolConfirmDialog UI + chatStore 状态

**追溯链**：US-003 → FD-talor-desktop-p0-agent-loop §F.3, §F.4 → IMPL-007
**关联 AC**：AC-003-01, AC-003-02, AC-003-03, AC-003-06
**优先级**：P0

**任务描述**：

1. **修改 `src/renderer/store/chatStore.ts`**：
   - 新增 `pendingToolConfirm: ToolConfirmRequest | null`
   - 新增 `setPendingToolConfirm: (req: ToolConfirmRequest | null) => void`

2. **修改 `src/renderer/hooks/useStreamingMessage.ts`**：
   - 新增订阅 `talorAPI.chat.onToolConfirm`
   - 收到事件时：`chatStore.setPendingToolConfirm(event)`
   - 返回清理函数时取消订阅

3. **新建 `src/renderer/components/ToolConfirmDialog.tsx`**：
   ```
   Props:
     request: ToolConfirmRequest
     onApprove: () => void
     onReject: () => void

   UI 结构：
   ┌─────────────────────────────────────┐
   │ 执行工具：{toolName}                  │  ← 标题
   │ ─────────────────────────────────── │
   │ {inputSummary}                       │  ← 预格式化，monospace，最多 20 行，超出折叠
   │                                      │
   │              [拒绝]  [执行]            │
   └─────────────────────────────────────┘

   样式规范：
   - 覆盖全屏半透明遮罩（z-50）
   - 弹框居中，最大宽度 560px，白色背景，rounded-xl，shadow-2xl
   - 标题区 bg-gray-50，含工具名（font-mono 高亮）
   - 内容区 font-mono text-sm，bg-gray-950 text-green-400（terminal 风格）
   - "拒绝"按钮：bg-white border border-gray-300，hover:bg-gray-50
   - "执行"按钮：bg-blue-600 hover:bg-blue-700 text-white
   ```

4. **修改 `src/renderer/pages/Chat/index.tsx`**：
   - 从 chatStore 获取 `pendingToolConfirm`
   - 当 `pendingToolConfirm !== null` 时渲染 `ToolConfirmDialog`
   - onApprove：`talorAPI.chat.sendToolConfirmResponse({ toolCallId, decision: 'approved' })`，`setPendingToolConfirm(null)`
   - onReject：`talorAPI.chat.sendToolConfirmResponse({ toolCallId, decision: 'rejected' })`，`setPendingToolConfirm(null)`

**文件变更**：
- 修改 `src/renderer/store/chatStore.ts`
- 修改 `src/renderer/hooks/useStreamingMessage.ts`
- 新建 `src/renderer/components/ToolConfirmDialog.tsx`
- 修改 `src/renderer/pages/Chat/index.tsx`

---

## §3 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| requirements.md | 1.0 | 2026-04-25 |
| feature.md | 1.0 | 2026-04-25 |
| phase-2/impl.md | 1.0 | 2026-04-25 |

---

## §4 验证环境

| 项目 | 值 |
|------|---|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| 启动命令 | `npm run dev` |
| 验证工具 | 手动操作 + 视觉验证 + sqlite3 CLI + Electron main log |
| LLM 要求 | 需配置支持 tool calling 的模型，system prompt 提示优先使用 bash/write/glob |
| Workspace 要求 | 设置任意本地目录 |
| 超时测试 | 触发确认框后等待 30 秒，观察自动拒绝行为 |

---

## §5 AC 验证映射

### AC-003-01：HIGH 级工具触发确认弹框

**Layer 1（log + UI 验证）**：
```bash
# 发送消息，引导 LLM 执行 bash（如："运行 git status"）
# 观察 Electron renderer 窗口是否出现 ToolConfirmDialog
# 观察 main log: "[Chat] tool confirm requested: bash"
```

**Layer 2**：见 feature.md §F.8.1 AC-003-01。

---

### AC-003-02：用户点击"执行"后工具正常运行

**Layer 1（DB + log 验证）**：
```bash
# 点击"执行"后
sqlite3 ~/.talor/chat.db "SELECT content FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;"
# 期望：tool_result block isError=false（假设命令成功）
# main log 期望："[Chat] tool confirm approved: bash"
```

**Layer 2**：见 feature.md §F.8.1 AC-003-02。

---

### AC-003-03：用户点击"拒绝"后工具不执行

**Layer 1（DB + log 验证）**：
```bash
sqlite3 ~/.talor/chat.db "SELECT content FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;"
# 期望：tool_result block isError=true, output 含"用户拒绝执行"
# main log 期望：无 bash spawn 记录
```

**Layer 2**：见 feature.md §F.8.1 AC-003-03。

---

### AC-003-04：确认弹框 30 秒超时自动拒绝

**Layer 1（DB + 计时验证）**：
```bash
# 触发确认框，不操作，等待 30 秒
sqlite3 ~/.talor/chat.db "SELECT content FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;"
# 期望：tool_result block isError=true, output 含"确认超时，自动拒绝"
```

**Layer 2**：见 feature.md §F.8.1 AC-003-04。

---

### AC-003-05：LOW 级工具静默执行不弹框

**Layer 1（UI 视觉验证）**：
```bash
# 引导 LLM 执行 glob（如："列出 src 目录下的文件"）
# 观察：ToolConfirmDialog 不出现
# main log 不含 "tool confirm requested: glob"
```

**Layer 2**：见 feature.md §F.8.1 AC-003-05。

---

### AC-003-06：write 工具确认框显示路径和内容预览

**Layer 1（UI 视觉验证）**：
```bash
# 引导 LLM 执行 write（如："创建一个 hello.txt 文件"）
# 观察确认框：标题含"write"，正文含文件路径，正文含内容前 20 行
```

**Layer 2**：见 feature.md §F.8.1 AC-003-06。
