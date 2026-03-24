# Phase 5：MCP 接口预留 — 实施文档

> 本文件是 Phase 5 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-tool-calling-phase-5
status: pending
version: 1.0
last-updated: 2026-03-24
depends-on: [IMPL-talor-desktop-tool-calling]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 0/1 (0%) |
| 本阶段 AC 验证率（双层） | 0/0 |
| 阶段状态 | ⬜ 未开始（接口设计阶段） |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

> **优先级顺序**：P0（Critical Path）→ P1（错误处理 + 边界）→ P2（次要功能）

### P0 - Critical Path

#### IMPL-019：MCP 工具接口预留
- ← FD-talor-desktop-tool-calling ← US-007（部分）
- AC: （无独立 AC，MCP 为接口设计不涉及运行时验证）
- 优先级：P0
- **核心必读**：
  - `../../feature.md §F.2`（MCP 协议设计）
  - `../../feature.md §F.4`（接口变更）
- **按需参考**：
  - MCP 协议规范
  - Vercel AI SDK MCP 集成文档

**已完成**：
- 无（本阶段尚未开始）

---

## P.2 会话恢复 Checkpoint

```
上次完成到：无（本阶段尚未开始）
当前状态：⬜ 未开始
已产出文件：无
未解决问题：无
下一步：开始 Phase 5，从 MCP 接口设计开始
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.2 | 2026-03-24 |
| `../../feature.md` | v1.2 | 2026-03-24 |
| `../../implementation.md` | v2.0 | 2026-03-24 |

---

## P.3 AC 验证映射（双层）

> AC 定义见 `../../requirements.md §1.8`（唯一来源）。本节只引用 AC ID + 记录验证状态。
> 注：MCP 预留为接口设计，不涉及运行时验证。US-007 并行工具已在 Phase 2 实现。

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-007-01 | `parallel tool calls` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/executor.test.ts` | —（已在 Phase 2 验证） | ✅ 已完成（Phase 2） |

### Layer 2：用户视角业务验证

> MCP 接口预留为设计阶段，无运行时 AC 验证。

| AC ID | 状态 | 说明 |
|-------|------|------|
| IMPL-019 MCP 接口设计 | ⬜ 未开始 | 接口设计，不涉及运行时验证 |

> **状态说明**：✅ 已通过 / ⬜ 未验证 / ❌ 未通过 / 🔲 需人工确认（纯 UI 动效）
