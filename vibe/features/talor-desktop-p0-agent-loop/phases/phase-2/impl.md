<!--
doc-id: IMPL-phase-2
phase: 2
status: pending
version: 1.0
last-updated: 2026-04-25
depends-on: [IMPL-phase-1]
-->

# Phase 2 impl — ReAct 推理链实时入库 + context 重建

> **阶段目标**：用户触发多步工具调用后重启应用，下一轮对话 LLM 仍能看到历史 tool_use/tool_result（main log 可确认）。

---

## §1 Checkpoint（会话恢复用）

```
上次停在：[等待 Phase 1 完成]
当前卡点：无
下次从：IMPL-004 开始（Phase 1 certificate 签收后）
```

---

## §2 IMPL 任务注册表

### IMPL-004：toCoreMessages() 从 ContentBlock[] 重建

**追溯链**：US-001 → FD-talor-desktop-p0-agent-loop §F.4 → IMPL-004
**关联 AC**：AC-001-05
**优先级**：P0

**任务描述**：
1. 重写 `src/main/ipc/chat.ts` 中的 `toCoreMessages()` 函数：
   - 从 `messageRepo.listBySession(sessionId)` 获取 `ChatMessage[]`（content 已反序列化为 ContentBlock[]）
   - 按 role 映射到 Vercel AI SDK messages 格式：
     - `user`：content parts 从 ContentBlock[] 提取 text/image/file
     - `assistant`：content 从 ContentBlock[] 提取 text + tool-call blocks
       - `tool_use` block → `{ type: 'tool-call', toolCallId, toolName, args: input }`
       - `text` block → `{ type: 'text', text }`
     - `tool`：content 从 ContentBlock[] 提取 tool_result blocks
       - `tool_result` block → `{ type: 'tool-result', toolCallId, toolName, result: output }`
     - `system`：`{ role: 'system', content: text }`
   - 移除旧的 `decodeParts()` 调用和 `MessagePart` 相关逻辑（chat.ts 内）
2. 当前消息（用户输入 + 附件）仍追加在末尾，逻辑不变

**文件变更**：
- 修改 `src/main/ipc/chat.ts`（toCoreMessages 函数）

---

### IMPL-005：ReAct loop 每 step 后实时写库

**追溯链**：US-002 → FD-talor-desktop-p0-agent-loop §F.7 → IMPL-005
**关联 AC**：AC-001-03, AC-001-04, AC-001-05, AC-001-06
**优先级**：P0

**任务描述**：
1. 修改 `src/main/ipc/chat.ts` ReAct loop（当前第 334-427 行）：

   **step 有 tool_use 时（每步结束后立即写库）**：
   ```
   // 写 assistant message（含 tool_use blocks）
   messageRepo.create({
     id: uuidv4(),
     session_id: sessionId,
     role: 'assistant',
     content: stepToolCalls.map(tc => ({
       type: 'tool_use',
       toolCallId: tc.toolCallId,
       toolName: tc.toolName,
       input: tc.input,
     }))
   })

   // 执行工具（现有逻辑），收集 toolResults
   // await result.toolResults

   // 写 tool message（含 tool_result blocks）
   // output 截断：String(tr.output ?? '').slice(0, MAX_TOOL_RESULT_BYTES)
   // 超限追加 \n[截断：原始输出 XXX 字节]
   messageRepo.create({
     id: uuidv4(),
     session_id: sessionId,
     role: 'tool',
     content: toolResults.map(tr => ({
       type: 'tool_result',
       toolCallId: tr.toolCallId,
       toolName: tr.toolName,
       output: truncateOutput(String(tr.output ?? ''), MAX_TOOL_RESULT_BYTES),
       isError: !!tr.error,
     }))
   })
   ```

   **loop 结束（最终文本）**：
   ```
   // 写最终 assistant message（含 text block）
   messageRepo.create({
     id: messageId,
     session_id: sessionId,
     role: 'assistant',
     content: [{ type: 'text', text: fullText }]
   })
   ```

2. 删除旧的 `messageRepo.create({ role:'assistant', content: fullText })` 调用（末尾的纯文本写法）
3. 新增 `truncateOutput(output: string, maxBytes: number): string` 辅助函数
4. 调整 `currentMessages` 构建：Phase 2 后 `currentMessages` 从 DB 重建（调用 `toCoreMessages()`），而不是内存拼接

**文件变更**：
- 修改 `src/main/ipc/chat.ts`（ReAct loop 写库 + currentMessages 重建）

---

## §3 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| requirements.md | 1.0 | 2026-04-25 |
| feature.md | 1.0 | 2026-04-25 |
| phase-1/impl.md | 1.0 | 2026-04-25 |

---

## §4 验证环境

| 项目 | 值 |
|------|---|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| 启动命令 | `npm run dev` |
| 验证工具 | `sqlite3 ~/.talor/chat.db` CLI + Electron main process log |
| LLM 要求 | 需配置支持 tool calling 的模型（claude-3-5-sonnet / gpt-4o / qwen3） |
| Workspace 要求 | 在会话中设置任意本地目录作为 workspace |
| DB reset | `rm ~/.talor/chat.db`（重启后自动重建） |

---

## §5 AC 验证映射

### AC-001-03：assistant message 含 tool_use block

**Layer 1（DB 验证）**：
```bash
# 触发含工具调用的对话后
sqlite3 ~/.talor/chat.db "SELECT role, content FROM messages WHERE role='assistant' ORDER BY created_at DESC LIMIT 5;"
# 期望：role=assistant, content JSON 含 [{type:"tool_use", toolCallId:"...", toolName:"glob", input:{...}}]
```

**Layer 2**：见 feature.md §F.8.1 AC-001-03。

---

### AC-001-04：tool message 含 tool_result block

**Layer 1（DB 验证）**：
```bash
sqlite3 ~/.talor/chat.db "SELECT role, content FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 5;"
# 期望：role=tool, content JSON 含 [{type:"tool_result", toolCallId:"...", isError:false, output:"..."}]
```

**Layer 2**：见 feature.md §F.8.1 AC-001-04。

---

### AC-001-05：重启后对话历史完整重建

**Layer 1（main log 验证）**：
```bash
# 完成一次含 2 步工具调用的对话，然后重启
# npm run dev，打开 Electron DevTools → Main Process log
# 发送新消息，在 log 中搜索 [Chat] messages 相关输出
# 期望：toCoreMessages 传给 streamText 的 messages 数组长度 >= 5 (user + 2x assistant + 2x tool)
```

**Layer 2**：见 feature.md §F.8.1 AC-001-05。

---

### AC-001-06：tool_result 大输出截断

**Layer 1（DB 验证）**：
```bash
# 发送 "执行 yes | head -c 200000 命令"（生成大输出），触发 bash 工具
sqlite3 ~/.talor/chat.db "SELECT length(content) FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;"
# 期望：length <= 55000（ContentBlock JSON overhead + 50KB 内容）
# 验证末尾截断标记：
sqlite3 ~/.talor/chat.db "SELECT content FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;" | python3 -c "import sys,json; blocks=json.load(sys.stdin); print(blocks[0]['output'][-100:])"
# 期望：末尾含 "[截断：原始输出 XXX 字节]"
```

**Layer 2**：见 feature.md §F.8.1 AC-001-06。
