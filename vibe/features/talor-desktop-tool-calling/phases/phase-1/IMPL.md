# Phase 1 IMPL — 工具基础设施

> 追溯链：US-001, US-002 → FD-talor-desktop-tool-calling → IMPL-talor-desktop-tool-calling Phase 1

## IMPL 任务清单

### P0（Critical Path）

| ID | 任务描述 | 文件路径 | 实施前必读 | 依赖 |
|----|---------|---------|-----------|------|
| IMPL-001 | 工具类型定义（ToolDefinition, ToolResult, ToolCallLog 接口） | `src/main/tools/types.ts` | requirements.md §1.3, feature.md §F.4 | - |
| IMPL-002 | 工具注册表（register, getTool, getAllSchemas, execute） | `src/main/tools/registry.ts` | feature.md §F.4, types.ts | IMPL-001 |
| IMPL-003 | ReAct 执行器（支持单工具 + 并行工具调用循环） | `src/main/tools/executor.ts` | feature.md §F.4, registry.ts | IMPL-002 |

---

## Checkpoint（会话恢复点）

- [x] types.ts 定义完成
- [x] registry.ts 实现完成
- [x] executor.ts 基础实现完成

## 会话恢复（2026-03-23）

- 上次完成到：IMPL-001, IMPL-002, IMPL-003 全部完成
- 当前状态：已完成
- 已产出文件：
  - `src/main/tools/types.ts`（ToolDefinition, ToolResult, ToolCallLog, ToolConfig, ToolExecuteContext）
  - `src/main/tools/types.test.ts`（20 tests）
  - `src/main/tools/registry.ts`（register, getTool, getAllSchemas, execute, listTools, unregister, clear）
  - `src/main/tools/registry.test.ts`（19 tests）
  - `src/main/tools/executor.ts`（executeStream with ReAct loop + parallel execution）
  - `src/main/tools/executor.test.ts`（11 tests）
- 未解决问题：无
- 下一步：Phase 2（workspace + read + glob + UI）
- 依赖文档版本快照：
  - requirements.md: v1.1（approved）
  - feature.md: v1.1（approved）
  - OVERVIEW-talor-desktop.md: v1.3（active）

---

## AC 验证映射

> Phase 1 完成后，基础框架可验证

---

## 实施前必读

- requirements.md §1.3（术语表）
- feature.md §F.4
- OVERVIEW-talor-desktop.md §MO.4

## 按需参考

- Vercel AI SDK tool calling 文档