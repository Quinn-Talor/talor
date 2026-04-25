# IMPL-002 执行 Prompt
# DB 清库迁移

---

## 第一步：你要实现什么

<!-- from: phases/phase-1/impl.md §2 IMPL-002 -->

修改 `src/main/db/index.ts`：
1. 更新 `CREATE_MESSAGES` SQL：
   - `role CHECK IN ('user','assistant','system','tool')`（增加 'tool'）
   - 新增 `content_type TEXT NOT NULL DEFAULT 'blocks'`
2. 在 `initChatDb()` 中实现清库迁移逻辑：
   - 检测旧 schema：`PRAGMA table_info(messages)` 无 `content_type` 列 → 执行清库
   - 清库：`DROP TABLE IF EXISTS messages` → 重建 → 重建索引
3. 删除旧的 workspace 列 ALTER TABLE 迁移代码（新表已含 workspace 列，不再需要）

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-001-01**：
- Given: 数据库文件 `~/.talor/chat.db` 存在，`messages` 表无 `content_type` 列（旧版 schema）
- When: 启动 talor-desktop（`npm run dev` 或生产包）
- Then:
  - `[数据]` `messages` 表包含 `content_type TEXT NOT NULL DEFAULT 'blocks'` 列
  - `[数据]` `messages` 表中 `role` 列允许值包含 `'tool'`（CHECK 约束更新）
  - `[数据]` 旧有 messages 记录已清空（COUNT = 0）

---

## 第三步：接口设计

<!-- from: feature.md §F.2 DB Schema 变更，原文复制 -->

```sql
-- 新 messages 表 DDL
DROP TABLE IF EXISTS messages;

CREATE TABLE messages (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
    content      TEXT NOT NULL,                          -- JSON: ContentBlock[]
    content_type TEXT NOT NULL DEFAULT 'blocks',
    created_at   TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
```

**迁移检测逻辑**：
```typescript
// 检测是否需要迁移（无 content_type 列 = 旧 schema）
const cols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>
const needsMigration = !cols.some(c => c.name === 'content_type')
if (needsMigration) {
  log.info('[ChatDB] Migrating: DROP + recreate messages table (clear data)')
  db.exec('DROP TABLE IF EXISTS messages;')
  db.exec(CREATE_MESSAGES)
  db.exec(CREATE_INDEX)
  log.info('[ChatDB] Migration complete')
}
```

---

## 第四步：代码索引

<!-- from: OVERVIEW-talor-desktop.md §MO.4 -->

| 文件 | 当前职责 | 本任务变更 |
|------|---------|-----------|
| `src/main/db/index.ts` | better-sqlite3 初始化 + Schema | **本任务修改**：更新 CREATE_MESSAGES + 添加清库迁移逻辑 |

**当前文件关键位置**（来自已读代码）：
- 第 20-29 行：`CREATE_MESSAGES` 常量 → 需全量替换
- 第 79-83 行：旧 workspace 迁移逻辑 → 需删除

---

## 第五步：声明

完成本 IMPL 后，更新 `phases/phase-1/impl.md §1 Checkpoint`：
```
上次停在：IMPL-002 完成
当前卡点：无
下次从：IMPL-003 开始
```

---

## 第六步：验证

**Layer 1（DB schema 验证）**：
```bash
# 删除旧 DB，重启应用
rm ~/.talor/chat.db
# npm run dev 启动后，打开 Electron main log 确认迁移日志
# 验证 schema
sqlite3 ~/.talor/chat.db "PRAGMA table_info(messages);"
# 期望含：id, session_id, role, content, content_type, created_at

sqlite3 ~/.talor/chat.db "SELECT COUNT(*) FROM messages;"
# 期望：0
```

**Layer 2**：见 feature.md §F.8.1 AC-001-01。

验证通过后：
1. 更新 `phases/phase-1/impl.md §1 Checkpoint`
2. 更新 `implementation.md §4.0` IMPL 完成率（2/7）
