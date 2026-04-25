# IMPL-003 执行 Prompt
# messageRepo 序列化/反序列化

---

## 第一步：你要实现什么

<!-- from: phases/phase-1/impl.md §2 IMPL-003 -->

修改 4 个文件：

1. **`src/main/repos/session-repo.ts`**：
   - `MessageRow.role` 类型：`'user' | 'assistant' | 'system' | 'tool'`
   - `MessageRow` 新增字段 `content_type: string`
   - `ChatMessage.role` 类型：同上
   - `messageRepo.create()` 签名改为接受 `content: ContentBlock[]`，写库时 `JSON.stringify(content)`
   - `messageRepo.listBySession()` 反序列化：`JSON.parse(row.content)` as ContentBlock[]，parse 失败降级为 `[{type:'text', text: row.content}]`

2. **`src/renderer/types/chat.ts`**：
   - `MessageRole` 增加 `'tool'`

3. **`src/preload/index.ts`**：
   - `MessageRole` 增加 `'tool'`

4. **`src/main/ipc/chat.ts`** (仅 user message 写库部分)：
   - 找到 `messageRepo.create({ id: userMessageId, ..., content: userContent })` 调用（当前第 320-324 行）
   - 改为 `content: [{ type: 'text' as const, text: userContent }]`

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-001-02**：
- Given: talor-desktop 运行中，存在活跃会话 session_id="sess-001"
- When: 用户发送纯文本消息"分析 src 目录结构"（无附件）
- Then:
  - `[数据]` messages 表新增记录：role='user', content_type='blocks', content 为合法 JSON 数组，反序列化后包含 `{type:"text", text:"分析 src 目录结构"}`

---

## 第三步：接口设计

<!-- from: feature.md §F.4，原文复制 -->

**messageRepo.create() 新签名**：
```typescript
create(params: {
  id: string
  session_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: ContentBlock[]   // 序列化为 JSON string 写入 DB
}): ChatMessage
```

**messageRepo.listBySession() 反序列化逻辑**：
```typescript
function rowToMessage(row: MessageRow): ChatMessage {
  let parsedContent: ContentBlock[]
  try {
    parsedContent = JSON.parse(row.content) as ContentBlock[]
  } catch {
    // 降级：旧纯文本内容
    parsedContent = [{ type: 'text', text: row.content }]
  }
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: JSON.stringify(parsedContent),  // ChatMessage.content 仍为 string（向前兼容 renderer）
    content_type: row.content_type,
    created_at: row.created_at,
  }
}
```

> 注意：`ChatMessage.content` 在 renderer 侧仍为 string（JSON 序列化的 ContentBlock[]），renderer 通过 `JSON.parse` 读取显示。`MessageBubble` 组件现有的 `decodeMessageContent()` 逻辑需适配新格式（text block 取 `.text` 字段而非 `.content`）。

**text block 字段变更**（重要）：
- 旧 `TextPart.content: string` → 新 `TextBlock.text: string`
- `MessageBubble.tsx` 或 `decodeMessageContent()` 中需更新读取字段

---

## 第四步：代码索引

<!-- from: OVERVIEW-talor-desktop.md §MO.4 -->

| 文件 | 当前职责 | 本任务变更 |
|------|---------|-----------|
| `src/main/repos/session-repo.ts` | 会话/消息 CRUD + updateModel | **本任务修改**：MessageRow 类型 + create/list 序列化 |
| `src/renderer/types/chat.ts` | 会话/消息类型 + MessagePart | **本任务修改**：MessageRole 增加 'tool' |
| `src/preload/index.ts` | contextBridge 暴露 talorAPI | **本任务修改**：MessageRole 增加 'tool' |
| `src/main/ipc/chat.ts` | chat:send 流式处理 | **本任务修改**：user message 写库调用更新 |

**关键现有代码位置**（来自已读文件）：
- `session-repo.ts` 第 16-21 行：`MessageRow` 接口 → 需新增 content_type
- `session-repo.ts` 第 144-151 行：`messageRepo.create()` → 需修改 content 序列化
- `session-repo.ts` 第 138-142 行：`messageRepo.listBySession()` → 需修改反序列化
- `renderer/types/chat.ts` 第 3 行：`MessageRole` → 需增加 'tool'
- `preload/index.ts` 第 123 行：`MessageRole` → 需增加 'tool'
- `chat.ts` 第 320-324 行：user message 写库 → 改为 ContentBlock[]

---

## 第五步：声明

完成本 IMPL 后，更新 `phases/phase-1/impl.md §1 Checkpoint`：
```
上次停在：IMPL-003 完成（Phase 1 全部 IMPL 完成）
当前卡点：等待 AC 验证 + certificate 签收
下次从：Phase 2 IMPL-004
```

---

## 第六步：验证

**Layer 1（DB 内容验证）**：
```bash
# 启动 npm run dev，发送一条消息
sqlite3 ~/.talor/chat.db "SELECT role, content_type, content FROM messages WHERE role='user' ORDER BY created_at DESC LIMIT 1;"
# 期望：
# role = user
# content_type = blocks
# content = [{"type":"text","text":"你发送的消息内容"}]

# TypeScript 编译验证
cd /Users/quinn.li/Desktop/talor/talor-desktop
npx tsc --noEmit
# 期望：0 错误
```

**Layer 2**：见 feature.md §F.8.1 AC-001-02。

验证通过后：
1. 更新 `phases/phase-1/impl.md §1 Checkpoint`
2. 更新 `implementation.md §4.0` IMPL 完成率（3/7）
3. 在 `phases/phase-1/impl.md §5` 填写 AC-001-01 和 AC-001-02 验证证据
4. 请求用户签收 Phase 1 certificate
