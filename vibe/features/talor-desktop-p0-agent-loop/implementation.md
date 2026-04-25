<!--
doc-id: IMPL-talor-desktop-p0-agent-loop
status: draft
version: 1.0
last-updated: 2026-04-25
depends-on: [FD-talor-desktop-p0-agent-loop]
-->

# IMPLEMENTATION — talor-desktop P0 Agent Loop

---

## §4.0 实施仪表盘

> 每次会话结束后更新本节。

### 总体进度

| 指标 | 当前值 |
|------|--------|
| IMPL 完成率 | 0 / 7 (0%) |
| AC 验证率 | 0 / 12 (0%) |
| Phase 进度 | Phase 1 ⬜ / Phase 2 ⬜ / Phase 3 ⬜ |
| 阻塞项 | 无 |
| DEFERRED 项 | 见 deferred.md |

### 需求实施状态表

| US | 描述 | 关联 IMPL | AC 通过率 | 状态 |
|----|------|-----------|-----------|------|
| US-001 | 消息模型升级：ContentBlock schema | IMPL-001, IMPL-002, IMPL-003 | 0/6 | ⬜ 未开始 |
| US-002 | 推理链实时入库 | IMPL-004, IMPL-005 | 0/0（与 US-001 共用 AC） | ⬜ 未开始 |
| US-003 | 高风险工具执行确认 | IMPL-006, IMPL-007 | 0/6 | ⬜ 未开始 |

> ⚠️ AC 验证明细见各阶段 `phases/phase-N/impl.md §5`。

---

## §4.1 Phase 索引

| Phase | 名称 | impl.md | 状态 |
|-------|------|---------|------|
| Phase 1 | 消息 Schema 升级 + ContentBlock 序列化 | [phases/phase-1/impl.md](phases/phase-1/impl.md) | ⬜ 未开始 |
| Phase 2 | ReAct 推理链实时入库 + context 重建 | [phases/phase-2/impl.md](phases/phase-2/impl.md) | ⬜ 未开始 |
| Phase 3 | 高风险工具确认流程 + UI | [phases/phase-3/impl.md](phases/phase-3/impl.md) | ⬜ 未开始 |

> IMPL 任务详情、AC 验证映射、Checkpoint 见对应 `phases/phase-N/impl.md`。

---

## §4.2 实施规划

### 复杂度快照

| 维度 | 说明 | 分数 |
|------|------|------|
| Schema 变更破坏性 | DROP + 重建 messages 表，清库迁移 | 3 |
| 跨文件改动数 | 12 个文件涉及 main/preload/renderer/shared | 3 |
| 新 IPC 通道 | 2 个新通道（chat:tool-confirm + chat:tool-confirm-response） | 2 |
| 新 UI 组件 | ToolConfirmDialog + chatStore 新状态 | 1 |
| 业务逻辑复杂度 | ReAct 写库 + Promise.race 超时 + confirm 异步流 | 2 |
| 验证复杂度 | 手动操作 + sqlite3 CLI + 依赖 LLM tool calling | 2 |
| **总分** | | **13** |
| **推荐 Phase 数** | | **3** |

### 关键路径（Critical Path）

```
IMPL-001（共享类型）
  → IMPL-002（DB 迁移）
    → IMPL-003（messageRepo 序列化）
      → IMPL-004（toCoreMessages 重建）
        → IMPL-005（ReAct 写库）
          → IMPL-006（confirm IPC + preload）
            → IMPL-007（ToolConfirmDialog UI）
```

### 阶段计划

| Phase | 名称（用户能力） | 包含 IMPL | 退出标准 |
|-------|----------------|-----------|---------|
| Phase 1 | 消息 Schema 升级 + ContentBlock 序列化 | IMPL-001, IMPL-002, IMPL-003 | 用户发送消息 → `messages` 表存储 ContentBlock JSON，sqlite3 可查到 `{type:"text"}` block |
| Phase 2 | ReAct 推理链实时入库 + context 重建 | IMPL-004, IMPL-005 | 用户触发多步工具调用后重启应用，下一轮对话 LLM 仍能看到历史 tool_use/tool_result（main log 可确认） |
| Phase 3 | 高风险工具确认流程 + UI | IMPL-006, IMPL-007 | 用户触发 bash/write/edit → 看到 ToolConfirmDialog → 点击"执行"或"拒绝"→ 工具按预期执行或跳过 |

### 进入/退出条件

| Phase | 进入条件 | 退出条件 |
|-------|---------|---------|
| Phase 1 | 本文档 draft 状态，用户开始编码会话 | AC-001-01, AC-001-02 通过 |
| Phase 2 | Phase 1 certificate 签收 | AC-001-03, AC-001-04, AC-001-05, AC-001-06 通过 |
| Phase 3 | Phase 2 certificate 签收 | AC-003-01 ~ AC-003-06 通过 |

### Shippable Increment 表

| Phase | 用户可感知的增量价值 |
|-------|-------------------|
| Phase 1 | 应用重启不再丢失 schema 迁移状态；消息以结构化 ContentBlock 存储（为 Phase 2 铺底，用户暂无直接感知） |
| Phase 2 | 重启后 Agent 历史推理链完整恢复，LLM 可续接工具调用 |
| Phase 3 | bash/write/edit 执行前弹出确认弹框，用户可审查并拒绝危险操作 |

### 桩代码与占位符禁令

- 禁止 `// TODO: implement`、`return null` 占位
- Phase 1 完成后所有 ContentBlock 序列化必须真实可工作
- Phase 2 完成后 toCoreMessages 必须正确重建完整消息链
- Phase 3 完成后 ToolConfirmDialog 必须真实等待用户响应

---

## §4.3 已知陷阱（Gotchas）

| ⚠️ 陷阱 | 正确做法 | 关联文档 |
|---------|---------|---------|
| `electron-vite` 构建中 `src/shared/` 目录不在默认别名路径 | 在 `electron.vite.config.ts` 为 main/renderer 都添加 `@shared` 别名，指向 `src/shared/` | feature.md §F.2 |
| Vercel AI SDK `role: 'tool'` 消息格式与 OpenAI 格式不同 | tool role 消息的 content 必须是 `{ type: 'tool-result', toolCallId, toolName, result }` 数组，不是 `tool_result` | feature.md §F.4 |
| `toCoreMessages()` 从旧 DB 读取时 content 可能是纯文本（旧 schema 遗留） | 清库迁移后此问题消失；保留 try/catch 降级为 `[{type:'text', text: content}]` 防御 | feature.md §F.2 |
| `streamText` 的 `toolResults` 是 Promise，必须 `await result.toolResults` 才有值 | 已有 `await result.toolResults`，写库必须在此之后 | chat.ts L397 |
| `Promise.race` 超时后如果 renderer 再发 confirm-response，ipcMain.once 已解除监听 | 使用 `ipcMain.once` + 清理函数确保监听只触发一次，多余响应直接忽略 | feature.md §F.5 |
| `ipcMain.once('chat:tool-confirm-response', ...)` 在多 session 并发时会被错误 session 响应触及 | response payload 包含 `toolCallId`，收到后校验 toolCallId 一致才 resolve | feature.md §F.5 |
| Tailwind CSS class 在新组件中不生效 | `ToolConfirmDialog.tsx` 必须在 `src/renderer/components/` 下，确保在 Tailwind `content` glob 覆盖范围内 | — |
| tool_result output 为 `undefined` 时 JSON.stringify 会产生 `null` | 写库前统一 `String(output ?? '')` | feature.md §F.2 ContentBlock |

---

## §4.4 发布清单

### 数据库

- [ ] 应用首次启动时自动执行清库迁移（DROP + 重建），无需手动操作
- [ ] 验证 `~/.talor/chat.db` messages 表结构正确（`PRAGMA table_info(messages)`）

### 配置项

- 无新增配置项

### 回滚

- 如需回滚：手动删除 `~/.talor/chat.db`，重启应用将以旧 schema 初始化
- 注意：回滚会丢失本次 Phase 1+ 积累的对话数据

### 迭代归档协议

- 全部 3 个 Phase certificate 签收后，执行 `klook-vibe-project` archive 模式，将 L3 delta 合并入 `OVERVIEW-talor-desktop.md`

---

## §4.5 范围外功能（Deferred Backlog）

见 [deferred.md](deferred.md)。

---

## §4.6 统一变更日志

| 日期 | 变更内容 | 操作人 |
|------|---------|--------|
| 2026-04-25 | 创建 implementation.md v1.0 | AI |
