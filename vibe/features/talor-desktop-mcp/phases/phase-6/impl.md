# Phase 6：MCP Server 配置管理 — 实施文档

> 本文件是 Phase 6 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-mcp-phase-6
status: draft
version: 1.0
last-updated: 2026-03-25
depends-on: [IMPL-talor-desktop-mcp]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 7/7 (100%) |
| 本阶段 AC 验证率（双层） | 6/13 |
| 阶段状态 | 🔄 进行中 |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

> **优先级顺序**：P0（Critical Path）→ P1（错误处理 + 边界）→ P2（次要功能）

### P0 - Critical Path

#### IMPL-001：数据库 mcp_servers 表
- ← FD-talor-desktop-mcp
- AC: AC-001-01, AC-001-02, AC-001-03
- 优先级：P0
- **核心必读**：
  - `src/main/db/index.ts`（现有数据库初始化）
  - `src/main/repos/session-repo.ts`（现有 repo 模式）
- **按需参考**：
  - SQLite CREATE TABLE 语法

#### IMPL-002：MCP 配置 IPC 接口（CRUD）
- ← FD-talor-desktop-mcp
- AC: AC-001, AC-004
- 优先级：P0
- **核心必读**：
  - `src/main/ipc/providers.ts`（现有 provider IPC）
  - `src/main/ipc/session.ts`（现有 session IPC）
- **按需参考**：
  - IPC 通道命名规范

#### IMPL-003：MCP 配置存储
- ← FD-talor-desktop-mcp
- AC: AC-001
- 优先级：P0
- **核心必读**：
  - `src/main/store/config-store.ts`（现有配置存储）
- **按需参考**：
  - safeStorage 加密

### P1 - 错误处理 + 边界

#### IMPL-004：MCPServerList 组件（网格卡片）
- ← FD-talor-desktop-mcp
- AC: AC-006, AC-008
- 优先级：P1
- **核心必读**：
  - `src/renderer/pages/Settings/ProviderList.tsx`（现有 provider 列表）
- **按需参考**：
  - Tailwind Grid 布局

#### IMPL-005：MCPServerForm 组件（表单）
- ← FD-talor-desktop-mcp
- AC: AC-001, AC-003
- 优先级：P1
- **核心必读**：
  - `src/renderer/pages/Settings/ProviderForm.tsx`（现有 provider 表单）
- **按需参考**：
  - React Hook Form

#### IMPL-006：连接测试功能
- ← FD-talor-desktop-mcp
- AC: AC-002
- 优先级：P1
- **核心必读**：
  - `src/main/services/provider-tester.ts`（现有连接测试）
- **按需参考**：
  - MCP 协议初始化流程

#### IMPL-007：MCP Config 导入/导出
- ← FD-talor-desktop-mcp
- AC: AC-007
- 优先级：P2
- **核心必读**：
  - `requirements.md §1.2.1`（标准 MCP 配置格式）
- **按需参考**：
  - JSON 解析

---

## P.2 会话恢复 Checkpoint

```
上次完成到：IMPL-001 数据库表（已完成）
当前状态：🔄 进行中 - IMPL-001 完成
已产出文件：
  - src/main/db/index.ts（新增 mcp_servers 表）
  - src/main/repos/mcp-server-repo.ts（CRUD 操作）
  - src/main/repos/mcp-server-repo.test.ts（13 个测试）
未解决问题：无
下一步：继续 IMPL-002（MCP 配置 IPC 接口）
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.0 | 2026-03-25 |
| `../../feature.md` | v1.0 | 2026-03-25 |

---

## P.3 AC 验证映射（双层）

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-001-01 | 数据库写入验证 | vitest | src/main/repos/ | create STDIO server | 记录保存 | ✅ |
| AC-001-02 | 数据库查询验证 | vitest | src/main/repos/ | create HTTP server | 记录返回 | ✅ |
| AC-001-03 | 数据库更新验证 | vitest | src/main/repos/ | update server name | 记录更新 | ✅ |
| AC-002-01 | IPC 接口测试 | vitest | src/main/ipc/ | mcp:servers:create | 创建成功 | ✅ |
| AC-002-02 | IPC 接口测试 | vitest | src/main/ipc/ | mcp:servers:list | 列表返回 | ✅ |
| AC-002-03 | IPC 接口测试 | vitest | src/main/ipc/ | mcp:servers:delete | 删除成功 | ✅ |

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 验证方式 | 输出摘要 | 状态 |
|-------|--------------|---------------|---------|---------|------|
| AC-001-01 | 填写 STDIO 表单提交 | Server 出现在列表 | Manual | Form 显示正确 | ✅ |
| AC-001-02 | 填写 HTTP 表单提交 | Server 出现在列表 | Manual | Form 显示正确 | ✅ |
| AC-001-03 | 点击编辑修改名称 | 名称更新显示 | Manual | 待验证 | 🔲 |
| AC-002-01 | 点击 STDIO 测试 | 显示成功+工具数 | Manual | IPC handler ready | 🔲 |
| AC-002-02 | 点击 HTTP 测试 | 显示成功+工具数 | Manual | IPC handler ready | 🔲 |
| AC-002-03 | 测试不存在地址 | 显示超时错误 | Manual | IPC handler ready | 🔲 |
| AC-003-01 | 点击禁用开关 | 显示已禁用 | Manual | UI ready | 🔲 |
| AC-003-02 | 点击启用开关 | 触发连接 | Manual | UI ready | 🔲 |
| AC-004-01 | 点击删除确认 | 列表消失 | Manual | UI ready | 🔲 |
| AC-007-01 | 粘贴 JSON 导入 | 创建对应 Server | Manual | IPC ready | 🔲 |
| AC-007-02 | 导入重复名称 | 提示覆盖确认 | Manual | IPC ready | 🔲 |
| AC-007-03 | 导入错误 JSON | 显示格式错误 | Manual | IPC ready | 🔲 |
| AC-007-04 | 点击导出按钮 | 导出标准 JSON | Manual | IPC ready | 🔲 |
| AC-008-01 | 首次打开页面 | 显示空状态 | Playwright | 暂无 MCP Server | ✅ |
| AC-008-02 | 鼠标悬停卡片 | 显示阴影效果 | Manual | UI ready | 🔲 |

---

## 预期产出

- `src/main/db/index.ts` — 新增 mcp_servers 表
- `src/main/ipc/mcp.ts` — MCP IPC handlers
- `src/main/mcp/config.ts` — MCP 配置管理
- `src/renderer/pages/Settings/MCPServerList.tsx` — 网格卡片列表
- `src/renderer/pages/Settings/MCPServerForm.tsx` — 配置表单
