# Phase 7：MCP 工具集成 — 实施文档

> 本文件是 Phase 7 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-mcp-phase-7
status: draft
version: 1.0
last-updated: 2026-03-25
depends-on: [IMPL-talor-desktop-mcp]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 0/4 (0%) |
| 本阶段 AC 验证率（双层） | 0/6 |
| 阶段状态 | ⬜ 待开始 |
| 阻塞项 | Phase 6 依赖 |

---

## P.1 IMPL 任务清单

> **优先级顺序**：P0（Critical Path）→ P1（错误处理 + 边界）→ P2（次要功能）

### P0 - Critical Path

#### IMPL-008：MCP Client 核心（STDIO + HTTP 传输）
- ← FD-talor-desktop-mcp
- AC: AC-005-01, AC-005-02
- 优先级：P0
- **核心必读**：
  - `src/main/tools/types.ts`（现有 toolRegistry 接口）
  - `src/main/tools/registry.ts`（现有工具注册）
  - `@modelcontextprotocol/sdk` 官方文档
- **按需参考**：
  - MCP 协议规范

#### IMPL-009：MCP 工具发现与注册
- ← FD-talor-desktop-mcp
- AC: AC-005-01
- 优先级：P0
- **核心必读**：
  - `src/main/tools/registry.ts`（现有 registerExternalProvider）
- **按需参考**：
  - toolRegistry 扩展点

### P1 - 错误处理 + 边界

#### IMPL-010：工具调用集成到 toolRegistry
- ← FD-talor-desktop-mcp
- AC: AC-005-01, AC-005-02
- 优先级：P1
- **核心必读**：
  - `src/main/tools/executor.ts`（现有工具执行器）
- **按需参考**：
  - ReAct 循环

#### IMPL-011：工具列表展示
- ← FD-talor-desktop-mcp
- AC: AC-006-01, AC-006-02
- 优先级：P1
- **核心必读**：
  - `src/renderer/components/ToolCallLog.tsx`（现有工具日志）
- **按需参考**：
  - UI 组件设计

---

## P.2 会话恢复 Checkpoint

```
上次完成到：Phase 6 已完成
当前状态：⬜ 待开始
已产出文件：
  - Phase 6 全部 IMPL
未解决问题：无
下一步：开始 Phase 7，从 IMPL-008 MCP Client 核心开始
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.0 | 2026-03-25 |
| `../../feature.md` | v1.0 | 2026-03-25 |
| `../phase-6/impl.md` | v1.0 | 2026-03-25 |

---

## P.3 AC 验证映射（双层）

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-005-01 | MCP 工具调用 | vitest | src/main/mcp/ | execute() | 返回结果 | ⬜ |
| AC-005-02 | 超时处理 | vitest | src/main/mcp/ | execute(timeout) | 超时错误 | ⬜ |
| AC-006-01 | 工具列表 | vitest | src/main/tools/ | listAllTools() | 包含 MCP | ⬜ |

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 验证方式 | 输出摘要 | 状态 |
|-------|--------------|---------------|---------|---------|------|
| AC-005-01 | 发送消息触发 MCP 工具 | 返回工具执行结果 | Playwright | 文件列表 | ⬜ |
| AC-005-02 | 调用耗时工具 | 返回超时错误 | Playwright | "执行超时" | ⬜ |
| AC-006-01 | 查看工具列表 | 显示 Server 名称+数量 | Playwright | "Server A (3 工具)" | ⬜ |
| AC-006-02 | 查看 Server 列表 | 显示各 Server 状态 | Playwright | "已连接/未连接" | ⬜ |

---

## 预期产出

- `src/main/mcp/client.ts` — MCP Client 核心
- `src/main/mcp/transport/stdio.ts` — STDIO 传输
- `src/main/mcp/transport/http.ts` — HTTP 传输
- `src/main/tools/registry.ts` — 扩展 MCP 工具注册
- `src/renderer/components/MCPToolList.tsx` — 工具列表组件
