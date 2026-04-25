# IMPL-005 执行 Prompt
# ReAct loop 每 step 后实时写库

---

## 第一步：你要实现什么

<!-- from: phases/phase-2/impl.md §2 IMPL-005 -->

修改 `src/main/ipc/chat.ts` ReAct loop（当前第 334-427 行）：

1. **step 有 tool_use 时**：在 `await result.toolResults` 之后立即写库
   - 写 assistant message（含 tool_use blocks）
   - 写 tool message（含 tool_result blocks，output 截断到 50KB）

2. **loop 结束（最终文本）**：写最终 assistant message（含 text block）

3. **删除**旧的 `messageRepo.create({ role:'assistant', content: fullText })` 末尾调用

4. **新增** `truncateOutput(output: string, maxBytes: number): string` 辅助函数

5. **调整** `currentMessages` 构建：每 step 后从 DB 重建（调用 `toCoreMessages()`）代替内存拼接

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-001-03**：
- Given: talor-desktop 运行中，session 已设置 workspace，LLM 决策调用 `glob` 工具，toolCallId="call-abc123", input=`{"pattern":"src/**/*"}`
- When: ReAct loop 第 1 步 LLM 输出 tool_use（内存中已有）
- Then:
  - `[数据]` messages 表新增记录：role='assistant', content_type='blocks', content 为 JSON 数组，含 `{type:"tool_use", toolCallId:"call-abc123", toolName:"glob", input:{pattern:"src/**/*"}}`

**AC-001-04**：
- Given: AC-001-03 的 glob 工具已执行完毕，output="src/main/index.ts\nsrc/renderer/App.tsx", isError=false
- When: ReAct loop 第 1 步工具结果返回
- Then:
  - `[数据]` messages 表新增记录：role='tool', content_type='blocks', content 为 JSON 数组，含 `{type:"tool_result", toolCallId:"call-abc123", toolName:"glob", output:"src/main/index.ts\nsrc/renderer/App.tsx", isError:false}`

**AC-001-05**：（见 IMPL-004）

**AC-001-06**：
- Given: 工具执行返回超过 50KB 的 output
- When: tool_result 写入数据库
- Then:
  - `[数据]` messages 表 content 中 tool_result block 的 output 长度 ≤ 51200 字符，末尾含文本 `\n[截断：原始输出 XXX 字节]`

---

## 第三步：接口设计

<!-- from: feature.md §F.7 ReAct + 写库流程，原文复制 -->

**truncateOutput 函数**：
```typescript
function truncateOutput(output: string, maxBytes: number): string {
  if (output.length <= maxBytes) return output
  const originalLength = output.length
  return output.slice(0, maxBytes) + `\n[截断：原始输出 ${originalLength} 字节]`
}
```

**step 有 tool_use 时写库（在 await result.toolResults 之后插入）**：
```typescript
// 1. 写 assistant message（含 tool_use blocks）
const assistantMsgId = uuidv4()
messageRepo.create({
  id: assistantMsgId,
  session_id: sessionId,
  role: 'assistant',
  content: stepToolCalls.map(tc => ({
    type: 'tool_use' as const,
    toolCallId: tc.toolCallId,
    toolName: tc.toolName,
    input: tc.input,
  })),
})

// 2. 执行工具（已有逻辑）
const toolResults = await result.toolResults

// 3. 写 tool message（含 tool_result blocks）
messageRepo.create({
  id: uuidv4(),
  session_id: sessionId,
  role: 'tool',
  content: toolResults.map(tr => ({
    type: 'tool_result' as const,
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    output: truncateOutput(String(tr.output ?? ''), MAX_TOOL_RESULT_BYTES),
    isError: !!tr.error,
  })),
})

// 4. 从 DB 重建 currentMessages（替代内存拼接）
currentMessages = toCoreMessages(sessionId, userContent, validatedAttachments)
// 注意：toCoreMessages 会包含刚写入的 assistant + tool 消息
// 但不包含当前 userContent（需在末尾追加一次）
// 实际上 toCoreMessages 已包含 userContent，这里需要调整：
// 方案：toCoreMessages 只重建历史，不追加当前消息
// 当前消息在第一次调用前已写入 DB（user message），所以重建时会包含
```

**loop 结束写最终文本**：
```typescript
// 最终 step（无 tool_use）
messageRepo.create({
  id: messageId,
  session_id: sessionId,
  role: 'assistant',
  content: [{ type: 'text' as const, text: fullText }],
})
// 删除旧的 messageRepo.create({ content: fullText }) 调用
```

---

## 第四步：代码索引

| 文件 | 当前职责 | 本任务变更 |
|------|---------|-----------|
| `src/main/ipc/chat.ts` | chat:send + ReAct loop | **本任务修改**：loop 写库逻辑 + currentMessages 重建 |

**关键位置**（来自已读代码）：
- 第 334-427 行：完整 ReAct loop → 重点修改第 389-427 行（tool 处理 + 写库）
- 第 436-442 行：旧末尾写库调用 → 需删除并替换

---

## 第五步：声明

完成本 IMPL 后，更新 checkpoint：
```
上次停在：IMPL-005 完成（Phase 2 全部 IMPL 完成）
当前卡点：等待 AC 验证 + certificate 签收
下次从：Phase 3 IMPL-006
```

---

## 第六步：验证

**Layer 1（DB 内容验证）**：
```bash
# 触发含工具调用的对话（发送"列出 src 目录的文件"，有 workspace）
sqlite3 ~/.talor/chat.db "SELECT role, content FROM messages ORDER BY created_at ASC;"
# 期望消息序列：
# user → assistant(tool_use:glob) → tool(tool_result:glob) → assistant(text)
# 或更多步

# 验证截断
# 发送会产生大输出的命令（如 bash: find / -name '*.ts' 2>/dev/null）
sqlite3 ~/.talor/chat.db "SELECT length(content) FROM messages WHERE role='tool' ORDER BY created_at DESC LIMIT 1;"
# 若输出超 50KB，期望 length <= ~55000
```

**Layer 2**：见 feature.md §F.8.1 AC-001-03, AC-001-04, AC-001-06。

验证通过后：
1. 更新 checkpoint
2. 更新 implementation.md §4.0 IMPL 完成率（5/7）
3. 填写 phase-2/impl.md §5 验证证据
4. 请求用户签收 Phase 2 certificate
