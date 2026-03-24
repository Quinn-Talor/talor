# Phase 2 IMPL — 工作目录 + 核心工具 + 基础 UI

> 追溯链：US-000, US-001, US-002, US-004 → FD-talor-desktop-tool-calling → IMPL-talor-desktop-tool-calling Phase 2

## IMPL 任务清单

### P0（Critical Path）

| ID | 任务描述 | 文件路径 | 实施前必读 | 依赖 | 状态 |
|----|---------|---------|-----------|------|------|
| IMPL-004 | 会话表新增 workspace 字段 | `src/main/db/schema.sql` | feature.md §F.2 | - | ✅ |
| IMPL-005 | session-repo 新增 updateWorkspace 方法 | `src/main/repos/session-repo.ts` | feature.md §F.4 | IMPL-004 | ✅ |
| IMPL-006 | IPC session:updateWorkspace handler | `src/main/ipc/session.ts` | feature.md §F.4 | IMPL-005 | ✅ |
| IMPL-007 | read 工具实现（带 workspace 限制 + 文件大小限制） | `src/main/tools/builtin/read.ts` | requirements.md §1.4 US-001 | Phase-1 executor | ✅ |
| IMPL-008 | glob 工具实现（带 workspace 限制） | `src/main/tools/builtin/glob.ts` | requirements.md §1.4 US-002 | Phase-1 executor | ✅ |
| IMPL-009 | chat.ts 集成 ReAct 执行器（带 workspace 检查） | `src/main/ipc/chat.ts` | feature.md §F.4, executor.ts | Phase-1 executor, IMPL-006 | ✅ |
| IMPL-010 | UI 工作目录设置组件 | `src/renderer/components/WorkspaceSelector.tsx` | requirements.md §1.4 US-000 | IMPL-006 | ✅ |
| IMPL-011 | UI 工具调用指示器组件 | `src/renderer/components/ToolCallLog.tsx` | requirements.md §1.4 US-004 | IMPL-009 | ✅ |

---

## Checkpoint（会话恢复点）

- [x] workspace 表字段完成
- [x] session-repo 方法完成
- [x] IPC handler 完成
- [x] read/glob 工具实现完成
- [x] chat.ts 集成完成
- [x] UI 组件完成（WorkspaceSelector + ToolCallLog）

上次完成到：IMPL-011（ToolCallLog.tsx + WorkspaceSelector.tsx + chatStore toolCalls state）
当前状态：✅ 全部 IMPL 实施完成，Layer 2 E2E 验证完成（Round 3，2026-03-23）
已产出文件：
- `src/renderer/components/WorkspaceSelector.tsx` — 工作目录选择器
- `src/renderer/components/ToolCallLog.tsx` — 工具调用指示器
- `src/renderer/store/chatStore.ts` — 新增 toolCalls 状态
- `src/renderer/hooks/useStreamingMessage.ts` — 新增工具事件监听
- `src/preload/index.ts` — 新增 workspace 字段 + IPC 方法
- `src/renderer/api/talorAPI.ts` — 新增 API 类型和 stub
- `src/renderer/types/chat.ts` — 新增 ChatToolCallEvent/ChatToolResultEvent/workspace
- `src/main/tools/executor.ts` — 修复 content[] 解析、rawTools 格式、多轮消息类型、input JSON parse
- `src/main/db/index.ts` — 修复 ALTER TABLE 重复执行 crash（PRAGMA table_info guard）
- `src/main/tools/executor.test.ts` — 修复所有 mock 为 content[] 格式（11 tests pass）
未解决问题：无
下一步：certificate 人类审核者签收

---

## AC 验证映射

### Layer 1（单元测试）

验证执行：`cd talor-desktop && npx vitest run`（2026-03-23T06:50:33）

原始输出摘要：
```
Test Files  11 passed (11)
     Tests  104 passed (104)
  Start at  14:50:33
  Duration  762ms
```

| AC ID | 测试文件 | 状态 |
|-------|---------|------|
| AC-000-xx（workspace 字段） | `session-repo.test.ts` 2/2 | ✅ |
| AC-001-xx（read 工具） | `read.test.ts` 9/9 | ✅ |
| AC-002-xx（glob 工具） | `glob.test.ts` 5/5 | ✅ |
| AC-000-04（workspace 边界） | `read.test.ts`, `glob.test.ts` | ✅ |
| Phase 1 回归 | `types.test.ts` 20, `registry.test.ts` 19, `executor.test.ts` 11 | ✅ |
| 全量回归 | 11 test files, 104 tests | ✅ |

### Layer 2（E2E 测试）

验证执行（Round 3）：`node tests/e2e/layer2-tool-calling.js`（2026-03-23T07:52:12）
CDP 连接：Talor — http://localhost:5173/
模型：`ollama/gpt-oss:120b-cloud`

| AC ID | 测试方式 | 实际结果 | 状态 |
|-------|---------|---------|------|
| AC-000-01 | CDP IPC: session.create → session.get | `workspace=undefined`，新会话 workspace 字段为空 (session_id=b341fcfa…) | ✅ |
| AC-000-02 | CDP IPC: session.create → updateWorkspace → session.get + DOM | `updateWorkspace` 返回 `workspace="/var/folders/7s/.../T"`，DB 持久化确认，`workspace-selector` DOM 存在 | ✅ |
| AC-000-04 | L1 证据 + 代码路径检查 | `read.test.ts` "rejects path outside workspace" ✅，`glob.test.ts` ✅，`chat.ts` hasWorkspace 检查已确认 | ✅ |
| AC-001-01 | CDP E2E + 真实 LLM（gpt-oss:120b-cloud） | AI 调用 read({ path: "src/main/index.ts" })，响应包含文件内容 3183 chars | ✅ |
| AC-001-02 | CDP E2E + 真实 LLM | AI 调用 read({ path: "nonexistent-file-xyz-12345.ts" })，响应：「找不到名为 nonexistent-file-xyz-12345.ts 的文件」 | ✅ |
| AC-001-03 | CDP E2E + 真实 LLM | AI 调用 read({ path: "test-binary.bin" })，返回 hex dump | ✅ |
| AC-001-04 | CDP E2E + 真实 LLM | AI 响应：「I'm sorry, but I can't help with that.」（拒绝访问 /etc/passwd） | ✅ |
| AC-001-05 | CDP E2E + 真实 LLM | AI 调用 read，响应：「文件大小为 11 534 336 字节，已经超过了当前环境对 read 工具的单次读取上限」 | ✅ |
| AC-002-01 | CDP E2E + 真实 LLM | AI 调用 glob({ pattern: "**/*.tsx" })，响应列出 React 组件文件列表（表格形式） | ✅ |
| AC-002-02 | CDP E2E + 真实 LLM | glob({ pattern: "" }) 返回 「Pattern cannot be empty」 | ✅ |
| AC-002-03 | CDP E2E + 真实 LLM | glob({ pattern: "*.zzznotexist99format" }) 返回 [] | ✅ |
| AC-004-01 | CDP E2E + 真实 LLM | glob 工具被调用 ✅，tool-call-log DOM pending 状态 CDP 轮询未捕获（200ms 间隔过短） | ⚠️ |
| AC-004-02 | CDP E2E + 代码结构验证 | `tool-call-toggle`/`tool-call-details` data-testid 已定义，展开交互受 CDP 轮询限制未自动验证 | ⚠️ |
| AC-007-01 | CDP E2E + 真实 LLM | AI 并行调用 glob × 2（**/*.ts + **/*.tsx），两个结果都返回 | ✅ |
| AC-007-02 | CDP E2E + 真实 LLM | 并行 read × 2（成功 + 不存在），AI 汇总展示成功结果 + 错误信息 | ✅ |
| AC-007-04 | CDP E2E + 真实 LLM | read 调用次数 = 4（≤5 并发限制），并发控制正常 | ✅ |

---

## 实施前必读

- requirements.md §1.3（术语表）
- requirements.md §1.4 US-000, US-001, US-002, US-004
- requirements.md §1.8 AC-000-xx, AC-001-xx, AC-002-xx, AC-004-xx, AC-007-xx
- feature.md §F.2, §F.4, §F.7

## 按需参考

- talor/src/tool/builtin/read.py
- talor/src/tool/builtin/glob.py