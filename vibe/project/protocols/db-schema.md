# Talor Desktop DB Schema

> **长期维护文档**。核心表结构 + 枚举值速查。
> 迭代完成后，将 feature.md 中的 Schema 变更合并到本文档。
>
> 项目地图见 `../overview.md`。API 协议见 `api.md`。

---

## 数据库基本信息

| 项 | 值 |
|----|-----|
| 引擎 | SQLite（better-sqlite3 12） |
| 文件路径 | `~/.talor/chat.db` |
| 初始化入口 | `src/main/db/index.ts` → `initChatDb()` |
| PRAGMA | `journal_mode = WAL`，`foreign_keys = ON` |

---

## 核心表结构

### `sessions` — 聊天会话

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,             -- UUID v4
    title       TEXT NOT NULL,                -- 会话标题（用户可重命名）
    provider_id TEXT NOT NULL,                -- 关联的 Provider ID（config.json 中的 key）
    model_id    TEXT,                         -- 选用的模型 ID（NULL = 使用 Provider 默认模型）
    workspace   TEXT,                         -- 工作目录绝对路径（NULL = 未设置，builtin 工具不可用）
    created_at  TEXT NOT NULL,               -- ISO 8601，如 "2026-04-25T10:00:00.000Z"
    updated_at  TEXT NOT NULL                -- 每次发送/接收消息后 touch 更新
);
```

**操作说明**：
- `touch(id)` — 每次 `chat:send` 完成后更新 `updated_at`，驱动会话列表排序
- `updateModelAndClearMessages(id, model_id)` — 切换模型时**同时清空该会话所有消息**（避免跨模型 context 混乱）
- 删除会话通过 `DELETE FROM sessions WHERE id = ?`，因 `foreign_keys = ON`，关联 messages 和 session_summaries 自动级联删除

---

### `messages` — 聊天消息

```sql
CREATE TABLE messages (
    id           TEXT PRIMARY KEY,            -- UUID v4
    session_id   TEXT NOT NULL,               -- 关联 sessions.id
    role         TEXT NOT NULL                -- 见枚举值表
                   CHECK(role IN ('user', 'assistant', 'system', 'tool')),
    content      TEXT NOT NULL,               -- JSON 序列化的 ContentBlock[]（见下方结构说明）
    content_type TEXT NOT NULL DEFAULT 'blocks',  -- 固定为 'blocks'，保留字段供未来扩展
    created_at   TEXT NOT NULL,               -- ISO 8601
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON messages(session_id);
```

**`content` 字段结构**（`JSON.stringify(ContentBlock[])`）：

```typescript
// src/shared/types/message.ts
type ContentBlock =
  | { type: 'text';        text: string }
  | { type: 'image';       image: string; mimeType: string }          // base64 data URL
  | { type: 'file';        filename: string; mimeType: string; path: string }
  | { type: 'tool_use';    toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; toolName: string; output: string; isError: boolean }
```

**存储与读取**：
- 存储：`messageRepo.create({ content: ContentBlock[] })` → `JSON.stringify(content)`
- 读取：`parseBlocks(row.content)` → `JSON.parse` + 降级（失败时返回 `[{ type: 'text', text: content }]`）
- 旧工具结果压缩：`toCoreMessages()` 中，超出最近 4 条的 `tool` 行 content 替换为摘要字符串

---

### `mcp_servers` — MCP 服务器配置

```sql
CREATE TABLE mcp_servers (
    id         TEXT PRIMARY KEY,              -- UUID v4
    name       TEXT NOT NULL,                 -- 用户可读名称
    type       TEXT NOT NULL                  -- 见枚举值表
                 CHECK(type IN ('stdio', 'http')),
    command    TEXT,                          -- stdio 类型：启动命令（如 'node', 'python'）
    args       TEXT,                          -- stdio 类型：JSON 序列化的 string[]（命令参数）
    env        TEXT,                          -- stdio 类型：JSON 序列化的 Record<string,string>（环境变量）
    url        TEXT,                          -- http 类型：服务端 URL
    auth       TEXT,                          -- JSON 序列化的 MCPAuthConfig（可选认证信息）
    enabled    INTEGER NOT NULL DEFAULT 1,    -- 1=启用，0=禁用
    created_at TEXT NOT NULL,                 -- ISO 8601
    updated_at TEXT NOT NULL                  -- ISO 8601
);
```

---

### `session_summaries` — 会话摘要缓存

```sql
CREATE TABLE session_summaries (
    session_id     TEXT NOT NULL PRIMARY KEY,  -- 关联 sessions.id（1:1）
    summary_text   TEXT NOT NULL,              -- LLM 生成的会话摘要文本
    covered_until  TEXT NOT NULL,              -- 摘要覆盖到的最后一条 message.id
    token_estimate INTEGER NOT NULL,           -- 摘要 token 估算值（字符数 / 4）
    created_at     TEXT NOT NULL,              -- ISO 8601，摘要生成时间
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

**用途**：`ShortTermMemory.getContext()` 检测 token 超出 90% 阈值时，生成并缓存摘要，后续请求命中缓存复用（通过 `covered_until` 判断摘要是否仍然有效）。

---

## 枚举值速查

### `messages.role`

| 值 | 含义 | 代码常量/类型 |
|----|------|-------------|
| `'user'` | 用户发送的消息（含附件） | `MessageRole` in `session-repo.ts` |
| `'assistant'` | LLM 回复（含工具调用块） | `MessageRole` |
| `'system'` | 系统提示词（由 SystemPlugin 注入） | `MessageRole` |
| `'tool'` | 工具执行结果（tool_result blocks） | `MessageRole` |

### `messages.content_type`

| 值 | 含义 |
|----|------|
| `'blocks'` | 固定值，`content` 字段为 `ContentBlock[]` JSON |

### `mcp_servers.type`

| 值 | 含义 | 必填字段 |
|----|------|---------|
| `'stdio'` | 子进程 stdio 通信 | `command`, `args`（`url` 为 NULL） |
| `'http'` | HTTP JSON-RPC | `url`（`command`/`args` 为 NULL） |

### `mcp_servers.enabled`

| 值 | 含义 |
|----|------|
| `1` | 启用，应用启动时自动连接 |
| `0` | 禁用，不连接 |

### `ContentBlock.type`

| 值 | 含义 | 所在 role |
|----|------|----------|
| `'text'` | 纯文本内容 | user / assistant |
| `'image'` | 图片（base64 data URL） | user |
| `'file'` | 文件附件（路径引用） | user |
| `'tool_use'` | LLM 发起的工具调用 | assistant |
| `'tool_result'` | 工具执行结果 | tool |

### `ToolConfirmDecision`

| 值 | 含义 | 代码常量 |
|----|------|---------|
| `'approved'` | 用户确认执行 | `ToolConfirmDecision` in `message.ts` |
| `'rejected'` | 用户拒绝执行 | `ToolConfirmDecision` |

---

## 迁移记录

| 版本 | 变更 | 迁移方式 |
|------|------|---------|
| v0.1 → v0.2 | `sessions` 新增 `workspace TEXT` 列 | `ALTER TABLE sessions ADD COLUMN workspace TEXT`（`db/index.ts` 启动时自动执行） |
| v0.1 → v0.2 | `messages` 新增 `content_type TEXT` 列 | 删除旧表重建（`initChatDb()` 中检测 `content_type` 缺失则 DROP + recreate） |

> ⚠️ 新增字段需在 `src/main/db/index.ts` 的 `initChatDb()` 中添加迁移检测逻辑（`PRAGMA table_info` 检查列名），禁止直接修改 `CREATE TABLE` DDL 而不加迁移。
