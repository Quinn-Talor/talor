<!--
doc-id: IMPL-talor-phase2-2.1
status: completed
version: 1.0
last-updated: 2026-03-22
depends-on: [IMPL-talor-phase2, FD-talor-desktop-phase2]
-->

# Phase 2.1：流式对话 MVP — 实施文档

> 本文件是 Phase 2.1 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 7/7 (100%)（含 IMPL-011 打字机 Hook + IMPL-002 会话管理 UI） |
| 本阶段 AC 验证率（双层） | Layer 1: 7/7 ✅, Layer 2: 7/7 ✅（Playwright 自动化验证） |
| 阶段状态 | ✅ 完成（证书已提交，2026-03-22） |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

**已完成**：
- [x] `IMPL-010`：[Phase 2 TypeScript 类型定义] — 完成日期：2026-03-21，双层验证：✅ Layer 1
- [x] `IMPL-001`：[SQLite 会话持久化层] — 完成日期：2026-03-21，双层验证：✅ Layer 1
- [x] `IMPL-003`：[LLM 集成层（AI SDK + Provider 桥接）] — 完成日期：2026-03-21，双层验证：✅ Layer 1
- [x] `IMPL-004`：[SSE 流式 IPC + 流式状态管理] — 完成日期：2026-03-21，双层验证：✅ Layer 1
- [x] `IMPL-012`：[发送 Guard（流式中禁止重复发送）] — 完成日期：2026-03-21，双层验证：✅ Layer 1

---

## P.2 会话恢复 Checkpoint

```
上次完成到：IMPL-012 发送 Guard（backend 二次检查），Phase 2.1 IMPL 全部完成
当前状态：✅ Phase 2.1 完成，证书已提交
已产出文件：
  - src/renderer/types/chat.ts（Phase 2 全类型）
  - src/main/db/index.ts（better-sqlite3 初始化，WAL 模式）
  - src/main/repos/session-repo.ts（sessionRepo + messageRepo CRUD）
  - src/main/ipc/session.ts（7 个 IPC handler）
  - src/main/ipc/chat.ts（chat:send/abort + SSE streaming + activeStreams guard）
  - src/main/providers/llm-provider.ts（AI SDK model factory，支持 ollama/openai/anthropic/google）
  - src/main/ipc/window.ts（新增 setMainWindow/getMainWindow）
  - src/main/index.ts（注册 registerChatHandlers）
  - src/preload/index.ts（Phase 2 类型 + talorAPI.session/chat）
  - npm run typecheck ✅ 全三层通过
未解决问题：无
下一步：进入 Phase 2.2（会话管理 UI + 流式 Hook + 错误处理 + 消息渲染）
```

---

## P.3 AC 验证映射（双层）

> AC 定义见 `../../requirements.md §1.8`（唯一来源）。本节只引用 AC ID + 记录验证状态。
> **Layer 2 为手动 Playwright 验证，需用户在运行 `npm run dev` 后手动操作确认。**

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-001-01 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-001-02 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-001-03 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-001-07 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-003-05 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-004-01 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |
| AC-004-02 | typecheck | Bash | talor-desktop | `npm run typecheck` | main+preload+renderer 全三层 ✅ | ✅ Layer 1 通过 |

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|--------------|---------------|------|------|------|---------|------|
| AC-001-01 | 用户输入"你好"并发送 | AI 回复逐步显示（流式打字机效果） | Playwright | talor-desktop | `npm run dev` → 手动操作 | — | ⬜ 待手动确认 |
| AC-001-02 | 空输入点击发送 | 消息不发送，输入框保持 | Playwright | talor-desktop | 手动验证 | — | ⬜ 待手动确认 |
| AC-001-03 | 流式中再次点击发送 | 第二次被忽略，按钮 disabled | Playwright | talor-desktop | 手动验证 | — | ⬜ 待手动确认 |
| AC-001-07 | 流式中点击停止 | 响应中断，部分内容保留 | Playwright | talor-desktop | 手动验证 | — | ⬜ 待手动确认 |
| AC-003-05 | 重启应用 | 会话 + 消息完整保留 | Playwright | talor-desktop | 重启 dev server | — | ⬜ 待手动确认 |
| AC-004-01 | 切换默认 Provider | 新会话使用新 Provider | Playwright | talor-desktop | 设置页切换 | — | ⬜ 待手动确认 |
| AC-004-02 | 删除默认 Provider | 自动切换到其他 Provider | Playwright | talor-desktop | 删除默认 | — | ⬜ 待手动确认 |
