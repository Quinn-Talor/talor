<!--
doc-id: SESSION-START-phase3
phase: 3
status: active
created: 2026-03-22
-->

# Phase 3 会话启动检查清单

> 本文档锚定 Phase 3（模型切换与高级功能），每次开始 Phase 3 编码会话前执行。

---

## Step 1：全局进度确认

- [x] `implementation.md §4.0` 已读取
- **当前进度**：Phase 1 ✅ 完成 | Phase 2 ✅ 完成（Quinn — 2026-03-22 签收）| Phase 3 ⬜ 进行中
- **IMPL 完成率**：14/22（P0+P1 实现，P2 延期）→ Phase 3 目标：新增 6 个 IMPL（IMPL-023~028）
- **AC 验证率**：10/13 已通过（Phase 1+2 完成）→ Phase 3 新增 4 个 AC

---

## Step 2：版本一致性检查

| 文档 | 快照版本 | 实际版本 | 状态 |
|------|---------|---------|------|
| requirements.md | 1.0 | 1.0 | ✅ |
| feature.md | 1.0 | 1.0 | ✅ |
| OVERVIEW-talor-desktop.md | 1.2 | 1.2 | ✅ |
| implementation.md | 1.0 | 1.0 | ✅ |

---

## Step 3：会话恢复 Checkpoint

- **上次中断点**：Phase 3 未开始（本次首次会话）
- **未解决问题**：无
- **代码基线**：34/34 tests passing，typecheck clean

---

## Step 4：术语表摘要（来自 requirements.md §1.3）

| 术语 | 代码命名 | 说明 |
|------|---------|------|
| 会话 | session / ChatSession | 一个对话会话实例 |
| 模型 ID | model_id | 格式：`provider_id/model_name`，如 `openai/gpt-4o` |
| 模型不可用 | unavailable | 模型在 Provider 模型列表中不再存在 |
| 模型切换 | updateModel / switchModel | 更改会话使用的模型 |
| 附件 | attachment | 会话中的文件附件（图片等） |
| 能力 | capability / ModelCapability | 模型支持的功能（vision/tools 等） |
| 视觉支持 | supports_vision | 模型是否支持图片理解 |

---

## Step 5：核心必读清单（Phase 3 IMPL-023~028）

### 已确认加载的文件

| 文件 | 用途 | 关键内容 |
|------|------|---------|
| `src/main/ipc/session.ts` | IMPL-023/024 主文件 | `session:updateModel` handler 已存在（仅 DB 更新），需要补充消息清空 |
| `src/main/repos/session-repo.ts` | IMPL-023/024 | `updateModel()` 已存在，需要确认消息清空逻辑（在 ipc 层还是 repo 层） |
| `src/renderer/pages/Chat/index.tsx` | IMPL-026/027/028 | `handleModelChange` 已存在但无确认弹框；无模型不可用检测 |
| `src/preload/index.ts` | 类型定义参考 | `session.updateModel` 已暴露，类型完整 |
| `requirements.md §1.8` | AC 验收标准 | AC-012-03/04/05 完整定义 |
| `feature.md §F.3` | 状态机 | 会话模型状态机：default/selected/switching/unavailable |
| `feature.md §F.4` | IPC 协议 | `UpdateSessionModelRequest/Response` 接口定义 |

### 关键发现（已有实现）

**已存在，需要增强**：
- `session:updateModel` IPC 端点 ✅ (session.ts L36-38)
- `sessionRepo.updateModel()` ✅ (session-repo.ts L93-100)  
- `preload session.updateModel` ✅ (preload/index.ts L190-191)
- `handleModelChange()` in Chat/index.tsx ✅ (L149-161)

**缺失，需要实现**：
- AC-012-03: `session:updateModel` 应清空会话消息（After 切换模型历史清空）
- AC-012-03: 前端切换前显示确认弹框"切换模型将开始新对话，是否继续？"
- AC-012-03: 切换成功后显示"已切换模型"提示
- AC-012-04: 会话加载时检测 model_id 是否仍在 Provider 模型列表中
- AC-012-04: 模型不可用时显示横幅 + "选择其他模型"按钮
- AC-012-05: 切换时若有图片附件且目标模型 `supports_vision=false`，显示警告

---

## Step 6：本次会话声明

- **本次会话目标**：完成 Phase 3 全部 P0+P1 IMPL（IMPL-023~028），通过双层验证
- **当前阶段**：Phase 3
- **本次要完成的 IMPL**：IMPL-023, IMPL-024, IMPL-025, IMPL-026, IMPL-027, IMPL-028
- **已加载的上下文文档**：
  - `implementation.md`（§4.0 全局进度）
  - `phases/phase-3/impl.md`（§P.1 任务清单，§P.2 Checkpoint，§P.3 AC 映射）
  - `requirements.md §1.8`（AC-012-03/04/05）
  - `feature.md §F.3/F.4`（状态机 + IPC 协议）
  - `OVERVIEW-talor-desktop.md`（全文）
  - `src/main/ipc/session.ts`
  - `src/main/repos/session-repo.ts`
  - `src/preload/index.ts`
  - `src/renderer/pages/Chat/index.tsx`（L1-299）
- **上次遗留未解决问题**：无（Phase 3 首次会话）
- **文档版本一致性**：全部一致 ✅
- **🔲 待人工确认项**：无

---

## MCP Playwright/CDP 验证前检查清单

Layer 2 验证执行前必须完成：

1. [ ] App 运行中：`cd talor-desktop && npm run dev`（或确认已在运行）
2. [ ] CDP 端口可用：`curl -s http://localhost:9222/json | head -5`
3. [ ] Renderer 可达：`curl -s http://localhost:5173/` 返回 HTML
4. [ ] 至少有一个 Provider 已配置（Ollama 或 OpenAI）
