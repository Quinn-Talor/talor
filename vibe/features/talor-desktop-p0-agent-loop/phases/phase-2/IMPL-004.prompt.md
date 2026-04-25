# IMPL-004 执行 Prompt
# toCoreMessages() 从 ContentBlock[] 重建

---

## 第一步：你要实现什么

<!-- from: phases/phase-2/impl.md §2 IMPL-004 -->

重写 `src/main/ipc/chat.ts` 中的 `toCoreMessages()` 函数：
1. 从 `messageRepo.listBySession(sessionId)` 获取 `ChatMessage[]`（content 已是 JSON 序列化的 ContentBlock[]）
2. 按 role 映射到 Vercel AI SDK messages 格式
3. 移除旧的 `decodeParts()` 调用和 `MessagePart` 相关导入（chat.ts 内）
4. 当前消息（用户输入 + 附件）仍追加在末尾，逻辑不变

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-001-05**：
- Given: 完成一次含 2 步工具调用的 Agent 对话（glob → bash），messages 表有 5 条记录：user + assistant(tool_use) + tool(tool_result) + assistant(tool_use) + tool(tool_result) + assistant(text)
- When: 重启 talor-desktop，在同一 session 发送新消息"继续上次分析"
- Then:
  - `[响应]` chat:send IPC 调用时传给 LLM 的 messages 参数包含完整历史，含所有 tool_use / tool_result 消息（可通过 main process log 确认）
  - `[页面]` 历史消息在 UI 中正常显示（tool_use/tool_result 消息以 ToolCallLog 形式呈现）

---

## 第三步：接口设计

<!-- from: feature.md §F.4 ContentBlock → Vercel AI SDK 映射，原文复制 -->

| ContentBlock.type | Vercel AI SDK 格式 |
|-------------------|--------------------|
| `text` | `{ type: 'text', text }` |
| `image` | `{ type: 'image', image }` |
| `tool_use` | `{ type: 'tool-call', toolCallId, toolName, args: input }` |
| `tool_result` | `{ type: 'tool-result', toolCallId, toolName, result: output }` |
| `file` | 维持现有占位符逻辑（不变） |

**role 映射**：

| MessageRow.role | Vercel AI SDK role |
|-----------------|--------------------|
| `user` | `'user'` |
| `assistant` | `'assistant'` |
| `system` | `'system'` |
| `tool` | `'tool'` |

**新 toCoreMessages 实现骨架**：
```typescript
function toCoreMessages(
  sessionId: string,
  userContent: string,
  attachments?: ValidatedAttachment[]
): CoreMessage[] {
  const rows = messageRepo.listBySession(sessionId)
  const messages: CoreMessage[] = []

  for (const row of rows) {
    const blocks: ContentBlock[] = JSON.parse(row.content)  // 已在 repo 层反序列化

    if (row.role === 'system') {
      const textBlock = blocks.find(b => b.type === 'text') as TextBlock | undefined
      messages.push({ role: 'system', content: textBlock?.text ?? '' })
    } else if (row.role === 'user') {
      const parts = blocks.flatMap(block => {
        if (block.type === 'text') return [{ type: 'text' as const, text: block.text }]
        if (block.type === 'image') return [{ type: 'image' as const, image: block.image }]
        return []  // file block: 维持现有占位符
      })
      messages.push({ role: 'user', content: parts })
    } else if (row.role === 'assistant') {
      const parts = blocks.flatMap(block => {
        if (block.type === 'text') return [{ type: 'text' as const, text: block.text }]
        if (block.type === 'tool_use') return [{
          type: 'tool-call' as const,
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          args: block.input,
        }]
        return []
      })
      messages.push({ role: 'assistant', content: parts })
    } else if (row.role === 'tool') {
      const parts = blocks.flatMap(block => {
        if (block.type === 'tool_result') return [{
          type: 'tool-result' as const,
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          result: block.output,
        }]
        return []
      })
      messages.push({ role: 'tool', content: parts })
    }
  }

  // 追加当前用户消息（同旧逻辑）
  // ... (附件处理逻辑不变)
  messages.push({ role: 'user', content: buildCurrentUserContent(userContent, attachments) })

  return messages
}
```

---

## 第四步：代码索引

| 文件 | 当前职责 | 本任务变更 |
|------|---------|-----------|
| `src/main/ipc/chat.ts` | chat:send 流式处理 + ReAct loop | **本任务修改**：toCoreMessages() 重写，删除 decodeParts() |

**现有 toCoreMessages() 位置**：chat.ts 第 130-217 行 → 全量替换

---

## 第五步：声明

完成本 IMPL 后，更新 `phases/phase-2/impl.md §1 Checkpoint`：
```
上次停在：IMPL-004 完成
当前卡点：无
下次从：IMPL-005
```

---

## 第六步：验证

**Layer 1（main log 验证）**：
```bash
# npm run dev，打开 Electron DevTools → Console（Main Process）
# 发送一条消息触发工具调用后，观察 log
# 搜索 "[Chat] Starting ReAct loop"
# 在 toCoreMessages 中添加 log.info('[Chat] toCoreMessages result:', JSON.stringify(messages).slice(0, 200))
# 期望：messages 数组包含正确格式的历史消息
```

**Layer 2**：见 feature.md §F.8.1 AC-001-05。

验证通过后：
1. 更新 checkpoint
2. 更新 implementation.md §4.0 IMPL 完成率（4/7）
