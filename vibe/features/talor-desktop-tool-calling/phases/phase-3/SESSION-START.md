# Phase 3 会话启动检查

> 每个编码会话开始前必须完成此检查清单。

## Step 1：环境验证

- [ ] 项目路径：`/Users/quinn.li/Desktop/talor/talor-desktop`
- [ ] Phase 1 已完成并签收

## Step 2：上下文加载

- [ ] 已读取 requirements.md §1.3 术语表
- [ ] 已读取 requirements.md §1.4 US-002, US-005
- [ ] 已读取 Phase 3 的 IMPL.md

## Step 3：任务确认

**本次会话目标**（从 IMPL.md 选择）：
- [ ] IMPL-012：write 工具
- [ ] IMPL-013：ls 工具
- [ ] IMPL-014：grep 工具
- [ ] IMPL-015：edit 工具

## Step 4：命名一致性检查

**术语表关键术语**（requirements.md §1.3）：

| 术语 | 代码命名 |
|------|---------|
| bash 工具 | `bash_tool` |
| edit 工具 | `edit_tool` |

## Step 5：验证命令确认

| 验证类型 | 命令 |
|---------|------|
| Layer 1 单元测试 | `npx vitest run` |
| Layer 2 E2E | `node tests/e2e/layer2-tool-calling.js` |
| 类型检查 | `npx tsc --noEmit` |