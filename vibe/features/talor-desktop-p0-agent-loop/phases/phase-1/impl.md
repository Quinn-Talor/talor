<!--
doc-id: IMPL-phase-1
phase: 1
status: pending
version: 1.0
last-updated: 2026-04-25
depends-on: [FD-talor-desktop-p0-agent-loop, IMPL-talor-desktop-p0-agent-loop]
-->

# Phase 1 impl — 消息 Schema 升级 + ContentBlock 序列化

> **阶段目标**：用户发送消息后，`messages` 表以 ContentBlock JSON 存储；应用重启后数据库结构正确。

---

## §1 Checkpoint（会话恢复用）

> 每次会话结束时更新。

```
上次停在：[初始状态，尚未开始]
当前卡点：无
下次从：IMPL-001 开始
```

---

## §2 IMPL 任务注册表

### IMPL-001：新建共享类型文件 `src/shared/types/message.ts`

**追溯链**：US-001 → FD-talor-desktop-p0-agent-loop §F.2 → IMPL-001
**关联 AC**：AC-001-01, AC-001-02, AC-001-03, AC-001-04
**优先级**：P0

**任务描述**：
1. 创建 `src/shared/types/message.ts`，定义 `ContentBlock`、`ToolUseBlock`、`ToolResultBlock` 等类型
2. 定义 `HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] as const`
3. 定义 `MAX_TOOL_RESULT_BYTES = 50 * 1024`（50KB）
4. 在 `electron.vite.config.ts` 为 main 和 renderer 添加 `@shared` 别名

**文件变更**：
- 新建 `src/shared/types/message.ts`
- 修改 `electron.vite.config.ts`（添加别名）

---

### IMPL-002：DB 清库迁移

**追溯链**：US-001 → FD-talor-desktop-p0-agent-loop §F.2 → IMPL-002
**关联 AC**：AC-001-01
**优先级**：P0

**任务描述**：
1. 修改 `src/main/db/index.ts`：
   - `CREATE_MESSAGES` SQL 改为新 schema：`role CHECK IN ('user','assistant','system','tool')`，新增 `content_type TEXT NOT NULL DEFAULT 'blocks'`
   - `initChatDb()` 中：检测旧 schema（`PRAGMA table_info(messages)` 无 `content_type` 列）→ `DROP TABLE messages` → 重建 → 重建索引
   - 删除旧的 workspace 列 ALTER TABLE 迁移逻辑（新表已含 workspace）

**文件变更**：
- 修改 `src/main/db/index.ts`

---

### IMPL-003：messageRepo 序列化/反序列化

**追溯链**：US-001 → FD-talor-desktop-p0-agent-loop §F.4 → IMPL-003
**关联 AC**：AC-001-02
**优先级**：P0

**任务描述**：
1. 修改 `src/main/repos/session-repo.ts`：
   - `MessageRow.role` 类型更新为 `'user' | 'assistant' | 'system' | 'tool'`
   - `MessageRow` 新增 `content_type: string`
   - `messageRepo.create()` 签名：接受 `content: ContentBlock[]`，写库时 `JSON.stringify(content)`
   - `messageRepo.listBySession()` 返回时 `JSON.parse(row.content)` 反序列化，parse 失败降级为 `[{type:'text', text: row.content}]`
2. 修改 `src/renderer/types/chat.ts`：`MessageRole` 增加 `'tool'`
3. 修改 `src/preload/index.ts`：`MessageRole` 增加 `'tool'`
4. 修改 `src/main/ipc/chat.ts` 的 user message 写库调用：`content: [{type:'text', text: userContent}]`

**文件变更**：
- 修改 `src/main/repos/session-repo.ts`
- 修改 `src/renderer/types/chat.ts`
- 修改 `src/preload/index.ts`
- 修改 `src/main/ipc/chat.ts`（user message 写库部分）

---

## §3 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| requirements.md | 1.0 | 2026-04-25 |
| feature.md | 1.0 | 2026-04-25 |
| OVERVIEW-talor-desktop.md | 1.3 | 2026-03-22 |

---

## §4 验证环境

| 项目 | 值 |
|------|---|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| 启动命令 | `npm run dev`（开发模式） |
| 测试命令（Layer 1）| `npx vitest run`（目前无消息序列化单元测试，Phase 1 以手动 + sqlite3 验证为主） |
| DB 路径 | `~/.talor/chat.db` |
| DB reset | 手动删除 `~/.talor/chat.db` 后重启应用 |
| 验证工具 | `sqlite3 ~/.talor/chat.db` CLI |
| 验证隔离策略 | 每次 AC-001-01 验证前备份 DB，验证完成后可恢复 |

---

## §5 AC 验证映射

### AC-001-01：清库迁移执行

**Layer 1（DB 结构验证）**：
```bash
# 触发迁移：删除旧 DB，启动应用
rm ~/.talor/chat.db
# 启动应用（npm run dev），等待 DB 初始化日志出现
# 验证 schema
sqlite3 ~/.talor/chat.db "PRAGMA table_info(messages);"
# 期望输出含：content_type 列，role 列（CHECK 含 tool），content 列
sqlite3 ~/.talor/chat.db "SELECT COUNT(*) FROM messages;"
# 期望：0
```

**Layer 2（应用级验证）**：见 feature.md §F.8.1 AC-001-01 验证契约。

---

### AC-001-02：user message 以 ContentBlock[] 存储

**Layer 1（DB 内容验证）**：
```bash
# 发送一条普通文本消息后
sqlite3 ~/.talor/chat.db "SELECT role, content_type, content FROM messages WHERE role='user' ORDER BY created_at DESC LIMIT 1;"
# 期望：role=user, content_type=blocks, content 为合法 JSON 含 [{type:"text",text:"..."}]
```

**Layer 2（应用级验证）**：见 feature.md §F.8.1 AC-001-02 验证契约。
