# Phase 2 IMPL — 工作目录 + 核心工具 + 基础 UI

> 追溯链：US-000, US-001, US-002, US-004 → FD-talor-desktop-tool-calling → IMPL-talor-desktop-tool-calling Phase 2

## IMPL 任务清单

### P0（Critical Path）

| ID | 任务描述 | 文件路径 | 实施前必读 | 依赖 |
|----|---------|---------|-----------|------|
| IMPL-004 | 会话表新增 workspace 字段 | `src/main/db/schema.sql` | feature.md §F.2 | - |
| IMPL-005 | session-repo 新增 updateWorkspace 方法 | `src/main/repos/session-repo.ts` | feature.md §F.4 | IMPL-004 |
| IMPL-006 | IPC session:updateWorkspace handler | `src/main/ipc/session.ts` | feature.md §F.4 | IMPL-005 |
| IMPL-007 | read 工具实现（带 workspace 限制 + 文件大小限制） | `src/main/tools/builtin/read.ts` | requirements.md §1.4 US-001 | Phase-1 executor |
| IMPL-008 | glob 工具实现（带 workspace 限制） | `src/main/tools/builtin/glob.ts` | requirements.md §1.4 US-002 | Phase-1 executor |
| IMPL-009 | chat.ts 集成 ReAct 执行器（带 workspace 检查） | `src/main/ipc/chat.ts` | feature.md §F.4, executor.ts | Phase-1 executor, IMPL-006 |
| IMPL-010 | UI 工作目录设置组件 | `src/renderer/components/WorkspaceSelector.tsx` | requirements.md §1.4 US-000 | IMPL-006 |
| IMPL-011 | UI 工具调用指示器组件 | `src/renderer/components/ToolCallLog.tsx` | requirements.md §1.4 US-004 | IMPL-009 |

---

## Checkpoint（会话恢复点）

- [ ] workspace 表字段完成
- [ ] session-repo 方法完成
- [ ] IPC handler 完成
- [ ] read/glob 工具实现完成
- [ ] chat.ts 集成完成
- [ ] UI 组件完成

---

## AC 验证映射

### Layer 2（E2E 测试）

| AC ID | 测试方式 | 预期结果 |
|-------|---------|---------|
| AC-000-01 | Playwright：未设置workspace | 工具不可用，提示"请先设置工作目录" |
| AC-000-02 | Playwright：设置workspace | workspace保存成功 |
| AC-000-04 | Playwright：访问workspace外路径 | 返回错误"无法访问工作目录外" |
| AC-001-01 | Playwright：发送"读取 src/main/index.ts" | 响应包含文件内容 |
| AC-001-02 | Playwright：读取不存在文件 | 返回错误提示 |
| AC-001-03 | Playwright：读取二进制文件 | 返回错误提示 |
| AC-001-04 | Playwright：读取敏感路径 | 返回错误提示 |
| AC-001-05 | Playwright：读取>10MB文件 | 返回错误提示 |
| AC-002-01 | Playwright：搜索 *.tsx 文件 | 返回匹配文件列表 |
| AC-002-02 | Playwright：空搜索模式 | 返回错误提示 |
| AC-002-03 | Playwright：搜索无结果 | 返回空列表 |
| AC-004-01 | Playwright：工具调用指示器 | 指示器显示 |
| AC-004-02 | Playwright：展开详情 | 显示工具名/参数/结果 |
| AC-007-01 | Playwright：并行调用多个工具 | 多个结果同时返回 |
| AC-007-02 | Playwright：并行中部分失败 | 部分成功部分失败 |
| AC-007-04 | Playwright：并行数量超限 | 提示"部分工具已忽略" |

---

## 实施前必读

- requirements.md §1.3（术语表）
- requirements.md §1.4 US-000, US-001, US-002, US-004
- requirements.md §1.8 AC-000-xx, AC-001-xx, AC-002-xx, AC-004-xx, AC-007-xx
- feature.md §F.2, §F.4, §F.7

## 按需参考

- talor/src/tool/builtin/read.py
- talor/src/tool/builtin/glob.py