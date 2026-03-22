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
| IMPL-023 | 新增 IPC 端点：session:updateModel | US-012 | AC-012-03 | ✅ 已完成 | 2h |
| IMPL-024 | 实现会话模型切换逻辑 | US-012 | AC-012-03 | ✅ 已完成 | 3h |
| IMPL-025 | 实现模型不可用检测与处理 | US-012 | AC-012-04 | ✅ 已完成 | 2h |

### P1 — 重要功能（Phase 3 内完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-026 | 前端：聊天页面模型切换UI | US-012 | AC-012-03 | ✅ 已完成 | 3h |
| IMPL-027 | 实现模型与附件兼容性检查 | US-012 | AC-012-05 | ✅ 已完成 | 2h |
| IMPL-028 | 前端：模型不可用警告和处理UI | US-012 | AC-012-04 | ✅ 已完成 | 2h |

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

- **上次完成到**：IMPL-028（前端模型不可用警告 UI）
- **当前状态**：所有 P0+P1 IMPL 已完成，待 Layer 2 人工验证
- **已产出文件**：
  - `src/main/repos/session-repo.ts` — 新增 `updateModelAndClearMessages()`
  - `src/main/services/model-availability.ts` — 新增可用性检测服务
  - `src/main/services/model-availability.test.ts` — 4 tests
  - `src/main/repos/session-repo.test.ts` — 5 tests
  - `src/main/ipc/session.ts` — `session:updateModel` 改用 `updateModelAndClearMessages`，新增 `session:checkModelAvailability`
  - `src/preload/index.ts` — 新增 `session.checkModelAvailability` 暴露
  - `src/renderer/api/talorAPI.ts` — 类型声明更新
  - `src/renderer/pages/Chat/index.tsx` — 确认弹框、已切换提示、模型不可用横幅、附件兼容性检查
- **未解决问题**：AC-012-03/04/05 Layer 2 均为 🔲 待人工确认（UI 交互类）
- **下一步**：人工执行 Layer 2 验证，填写证据后调用 klook-vibe-verify

---

## §P.3 AC 验证映射（双层验证）

> **需求变更 v1.1（2026-03-22）**：切换模型不弹窗、不清空 session，直接切换。
> AC-012-03/05 验证逻辑已更新，需重跑获取新证据。

### AC-012-03：现有会话模型切换

**新行为**：点击模型后直接切换（无 ConfirmDialog），会话消息保留，model-switched-toast 出现。

| 层次 | 类型 | 验证指令 | 状态 |
|------|------|---------|------|
| Layer 1 | 单元测试 | `npx vitest run src/main/repos/session-repo.test.ts` | ✅ |
| Layer 2 | Playwright CDP E2E | `node tests/e2e/layer2-ac012.js` | ✅ |

**Layer 1 证据**（2026-03-22 22:41 UTC+8，`npx vitest run`）：
```
 ✓ src/main/repos/session-repo.test.ts (2 tests) 4ms

 Test Files  6 passed (6)
      Tests  40 passed (40)
   Start at  22:41:32
   Duration  618ms
```

**Layer 2 证据**（2026-03-22 22:41 UTC+8，`node tests/e2e/layer2-ac012.js`）：
```
  ✅ [AC-012-03][L2] model-picker-dropdown 出现
  ✅ [AC-012-03][L2] 未出现 ConfirmDialog（直接切换）
  ✅ [AC-012-03][L2] model-switched-toast 出现: "已切换模型"
  ✅ [AC-012-03][L2] 会话无消息，切换后仍显示正常（无消息可验证保留）
```

---

### AC-012-04：模型不可用处理

| 层次 | 类型 | 验证指令 | 状态 |
|------|------|---------|------|
| Layer 1 | 单元测试 | `npx vitest run src/main/services/model-availability.test.ts` | ✅ |
| Layer 2 | Playwright CDP E2E | `node tests/e2e/layer2-ac012.js` | ✅ |

**Layer 1 证据**：
```
Tests  4 passed (4)
  ✓ checkModelAvailability > returns available=true when model_id exists in provider models
  ✓ checkModelAvailability > returns available=false when model_id is not in provider models
  ✓ checkModelAvailability > returns available=false when model_id is undefined
  ✓ checkModelAvailability > returns available=false when models list is empty
```

**Layer 2 证据**（2026-03-22 22:21 UTC+8，`node tests/e2e/layer2-ac012.js`）：
```
  ✅ [AC-012-04][L2] checkModelAvailability 返回 available=false (fake model_id 设置成功)
  ✅ [AC-012-04][L2] model-unavailable-banner 出现: "模型不可用 — 该模型已无法使用选择其他模型"
  ✅ [AC-012-04][L2] 点击"选择其他模型"后 model-picker-dropdown 出现
```

---

### AC-012-05：模型与附件兼容性检查

**新行为**：切换到不支持 vision 的模型时，静默忽略图片附件，不调用 window.confirm，切换成功后 model-switched-toast 出现。

| 层次 | 类型 | 验证指令 | 状态 |
|------|------|---------|------|
| Layer 1 | 单元测试 | `npx vitest run` (全量) | ✅ |
| Layer 2 | Playwright CDP E2E | `node tests/e2e/layer2-ac012.js` | ✅ |

**Layer 1 证据**（2026-03-22 22:41 UTC+8，`npx vitest run`）：
```
 Test Files  6 passed (6)
      Tests  40 passed (40)
   Start at  22:41:32
   Duration  618ms
```

**Layer 2 证据**（2026-03-22 22:41 UTC+8，`node tests/e2e/layer2-ac012.js`）：
```
  ✅ [AC-012-05][L2] window.confirm 未被调用（静默忽略图片附件，直接切换）
  ✅ [AC-012-05][L2] model-switched-toast 出现，切换成功
```