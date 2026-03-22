<!--
doc-id: IMPL-talor-model-management-phase3
status: draft
version: 1.0
last-updated: 2026-03-22
depends-on: [IMPL-talor-model-management-phase2]
-->

# Phase 3 IMPL — 模型切换与高级功能

> 追溯链：US-012 → FD-talor-desktop-model-management → 本文档（IMPL-talor-model-management-phase3）
> 依赖的 AC：AC-012-03, AC-012-04, AC-012-05

---

## §P.1 IMPL 任务清单

### P0 — Critical Path（必须完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-023 | 新增 IPC 端点：session:updateModel | US-012 | AC-012-03 | ⬜ 未开始 | 2h |
| IMPL-024 | 实现会话模型切换逻辑 | US-012 | AC-012-03 | ⬜ 未开始 | 3h |
| IMPL-025 | 实现模型不可用检测与处理 | US-012 | AC-012-04 | ⬜ 未开始 | 2h |

### P1 — 重要功能（Phase 3 内完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-026 | 前端：聊天页面模型切换UI | US-012 | AC-012-03 | ⬜ 未开始 | 3h |
| IMPL-027 | 实现模型与附件兼容性检查 | US-012 | AC-012-05 | ⬜ 未开始 | 2h |
| IMPL-028 | 前端：模型不可用警告和处理UI | US-012 | AC-012-04 | ⬜ 未开始 | 2h |

### P2 — 优化功能（可延期）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-029 | 模型切换历史记录 | US-012 | - | ⬜ 未开始 | 2h |
| IMPL-030 | 批量模型能力检测 | US-011 | - | ⬜ 未开始 | 2h |
| IMPL-031 | 模型推荐功能（基于任务） | US-012 | - | ⬜ 未开始 | 3h |

**Phase 3 IMPL 总计**：9 个任务（3 P0 + 3 P1 + 3 P2）

---

## §P.2 会话恢复 Checkpoint

### 实施前必读（每次开始前必须重新加载）

1. **Phase 1-2 成果**：前两个阶段的完整实现
2. **功能设计**：`feature.md` 所有相关章节
3. **需求定义**：`requirements.md` US-012 高级功能和关联 AC
4. **实施计划**：`implementation.md` §4.2 Phase 3 范围

### 依赖文档版本快照

| 文档 | doc-id | version | last-updated |
|------|--------|---------|--------------|
| requirements.md | REQ-talor-model-management | 1.0 | 2026-03-22 |
| feature.md | FD-talor-desktop-model-management | 1.0 | 2026-03-22 |
| OVERVIEW-talor-desktop.md | OVERVIEW-talor-desktop | 1.2 | 2026-03-22 |
| implementation.md | IMPL-talor-model-management | 1.0 | 2026-03-22 |

### 上次中断点记录
> 将在实施过程中填写

---

## §P.3 AC 验证映射（双层验证）

### AC-012-03：现有会话模型切换
### AC-012-04：模型不可用处理
### AC-012-05：模型与附件兼容性检查

> 详细验证指令将在 Phase 3 实施时填写，基于 Phase 1-2 完成后的代码状态。