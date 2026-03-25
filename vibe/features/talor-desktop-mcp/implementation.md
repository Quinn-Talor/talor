# talor-desktop MCP 功能实施文档

> AI 实施者执行参考。**每次会话开始前必须读 §4.0 实施仪表盘**，从 `phases/phase-N/impl.md §P.0 + §P.2` 获取阶段进度，结束时更新。
> 产品需求见 `requirements.md`。项目现状见 `OVERVIEW-talor-desktop.md`。功能设计见 `feature.md`。
> 各阶段 IMPL 任务、AC 验证映射、会话 Checkpoint 见 `phases/phase-N/impl.md`。

---

<!--
doc-id: IMPL-talor-desktop-mcp
status: approved
version: 1.0
last-updated: 2026-03-25
depends-on: [FD-talor-desktop-mcp]
-->

---

## 4.0 实施仪表盘

### 总体进度

| 指标 | 当前值 | 说明 |
|------|--------|------|
| IMPL 完成率 | 0/11 (0%) | IMPL-001~011 全部待开始 |
| AC 验证率 | 0/19 (0%) | Phase 6-7 AC 待验证 |
| Phase 进度 | Phase 6 待开始 | Phase 6 → Phase 7 |
| 阻塞项 | 0 | 无 |
| DEFERRED 项 | 0 pending | 见 deferred.md |

### 需求实施状态（US 维度）

| US ID | 用户故事 | 关联 IMPL | AC 通过率 | 状态 |
|-------|---------|----------|----------|------|
| US-001 | 配置 MCP Server | IMPL-001~007 | 0/3 ⬜ | ⬜ Phase 6 |
| US-002 | 测试 MCP Server 连接 | IMPL-006 | 0/3 ⬜ | ⬜ Phase 6 |
| US-003 | 启用/禁用 MCP Server | IMPL-007 | 0/2 ⬜ | ⬜ Phase 6 |
| US-004 | 删除 MCP Server | IMPL-002 | 0/1 ⬜ | ⬜ Phase 6 |
| US-005 | Agent 调用 MCP 工具 | IMPL-008~011 | 0/2 ⬜ | ⬜ Phase 7 |
| US-006 | 查看 MCP 工具列表 | IMPL-011 | 0/2 ⬜ | ⬜ Phase 7 |
| US-007 | MCP Config 导入/导出 | IMPL-007 | 0/4 ⬜ | ⬜ Phase 6 |
| US-008 | UI 管理 MCP Server | IMPL-004~005 | 0/2 ⬜ | ⬜ Phase 6 |

> AC 双层验证明细（验证指令 + 证据）见各阶段 `phases/phase-N/impl.md §P.3`。

---

## 4.1 Phase 索引

| Phase | 实施文档 | 名称（用户能力） | 状态 | IMPL | AC 验证 |
|-------|---------|----------------|------|------|---------|
| Phase 6 | [phases/phase-6/impl.md](phases/phase-6/impl.md) | MCP Server 配置管理 | ⬜ 待开始 | 7/7 | 0/13 |
| Phase 7 | [phases/phase-7/impl.md](phases/phase-7/impl.md) | MCP 工具集成 | ⬜ 待开始 | 4/4 | 0/6 |

> 各 Phase 进度见 §4.0 仪表盘。
> 每个 Phase 的会话启动检查见 `phases/phase-N/session-start.md`。
> 每个 Phase 的完成证书见 `phases/phase-N/certificate.md`。

---

## 4.2 实施规划

### 复杂度快照

| 维度 | 评估值 | 得分 |
|------|--------|------|
| ① IMPL 估算任务数 | ~11 个 | 4分 |
| ② 涉及模块数 | mcp/, ipc/, config-store, renderer | 3分 |
| ③ 状态机变更 | MCP Server 状态机 | 1分 |
| ④ 涟漪/下游影响 | toolRegistry 集成 | 2分 |
| ⑤ 并发/幂等要求 | 连接串行，CRUD 幂等 | 1分 |
| ⑥ 外部依赖阻塞 | MCP SDK 兼容性 | 1分 |
| **总分** | — | **12分 → 2 个 Phase** |

### Phase 分拆依据

- **Phase 6（配置管理）**：Critical Path — 用户配置 Server 是使用 MCP 工具的前提
- **Phase 7（工具集成）**：依赖 Phase 6 配置完成后的 Server

### 关键路径

```
配置 MCP Server → 连接测试 → 工具发现 → Agent 调用
```

### 进入/退出条件

**Phase 6 进入条件**：
- 无

**Phase 6 退出条件**：
- 用户 → 添加 Server → 列表显示卡片 → 退出

**Phase 7 进入条件**：
- Phase 6 已完成

**Phase 7 退出条件**：
- 用户 → 发送消息 → Agent 调用 MCP 工具 → 返回结果

### Shippable Increment

| Phase | 增量描述 | 可独立交付 |
|-------|---------|-----------|
| Phase 6 | MCP Server 配置管理 UI + CRUD | 是 |
| Phase 7 | MCP 工具调用集成 | 否（依赖 Phase 6） |

---

## 4.3 已知陷阱列表（Gotchas）

| ⚠️ 陷阱描述 | 正确做法 | 关联文档 |
|------------|---------|----------|
| MCP SDK ESM 兼容性 | 使用官方 SDK 遇构建问题，考虑自实现 STDIO/HTTP 传输层 | feature.md §F.2 |
| STDIO 进程生命周期 | 正确管理子进程：启动→保持连接→优雅关闭 | IMPL-008 |
| 工具命名冲突 | MCP 工具与内置工具同名时，优先内置工具 | IMPL-009 |
| 连接超时处理 | 30秒超时，区分连接超时和执行超时 | IMPL-006 |
| 配置加密存储 | Server auth 信息需加密存储（复用 safeStorage） | IMPL-003 |

---

## 4.4 发布清单

| 类型 | 项 | 状态 |
|------|-----|------|
| 配置 | mcp_servers 表 | ⬜ |
| 配置 | MCP Config 存储 | ⬜ |
| IPC | mcp:servers:* 接口 | ⬜ |
| UI | MCP Server 配置页面 | ⬜ |
| 集成 | toolRegistry MCP 扩展 | ⬜ |

---

## 4.5 范围外功能（Deferred Backlog）

> 见 `deferred.md`。

---

## 4.6 统一变更日志

| 日期 | 变更 | 文档 |
|------|------|------|
| 2026-03-25 | 初始版本 | implementation.md |

---

## 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `requirements.md` | v1.0 | 2026-03-25 |
| `feature.md` | v1.0 | 2026-03-25 |
| `OVERVIEW-talor-desktop.md` | v1.3 | 2026-03-22 |
