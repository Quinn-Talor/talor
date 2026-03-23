# Phase 2 会话启动检查

> 每个编码会话开始前必须完成此检查清单。

## Step 1：环境验证

- [ ] 项目路径：`/Users/quinn.li/Desktop/talor/talor-desktop`
- [ ] 依赖安装：`npm install` 已完成
- [ ] Phase 1 已完成并签收

## Step 2：上下文加载

- [ ] 已读取 requirements.md §1.3 术语表
- [ ] 已读取 requirements.md §1.4 US-003, US-004, US-005
- [ ] 已读取 requirements.md §1.8 AC-003-xx, AC-004-xx, AC-005-xx
- [ ] 已读取 feature.md §F.6
- [ ] 已读取 Phase 2 的 IMPL.md

## Step 3：任务确认

**本次会话目标**（从 IMPL.md 选择）：
- [ ] IMPL-004：workspace 字段 schema 变更
- [ ] IMPL-005：session-repo updateWorkspace 方法
- [ ] IMPL-006：IPC session:updateWorkspace handler
- [ ] IMPL-007：read 工具实现
- [ ] IMPL-008：glob 工具实现
- [ ] IMPL-009：chat.ts 集成执行器
- [ ] IMPL-010：UI WorkspaceSelector 组件
- [ ] IMPL-011：UI ToolCallLog 组件

## Step 4：命名一致性检查

**术语表关键术语**（requirements.md §1.3）：

| 术语 | 代码命名 |
|------|---------|
| 工具调用 | `tool_calling` |
| ReAct 循环 | `react_loop` |
| 工具注册表 | `tool_registry` |
| 工具执行器 | `tool_executor` |

## Step 5：验证命令确认

| 验证类型 | 命令 |
|---------|------|
| Layer 1 单元测试 | `npx vitest run` |
| Layer 2 E2E | `node tests/e2e/layer2-tool-calling.js` |
| 类型检查 | `npx tsc --noEmit` |