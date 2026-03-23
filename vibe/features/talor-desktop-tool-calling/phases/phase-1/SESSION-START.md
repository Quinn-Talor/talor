# Phase 1 会话启动检查

> 每个编码会话开始前必须完成此检查清单。

## Step 1：环境验证

- [ ] 项目路径：`/Users/quinn.li/Desktop/talor/talor-desktop`
- [ ] 依赖安装：`npm install` 已完成
- [ ] 开发服务器：`npm run dev` 可正常启动
- [ ] 测试命令：`npx vitest run` 可执行

## Step 2：上下文加载

- [ ] 已读取 requirements.md §1.3 术语表
- [ ] 已读取 requirements.md §1.4 US-001, US-002
- [ ] 已读取 requirements.md §1.8 AC-001-xx, AC-002-xx
- [ ] 已读取 feature.md §F.2, §F.4, §F.7
- [ ] 已读取当前 Phase 的 IMPL.md

## Step 3：任务确认

**本次会话目标**（从 IMPL.md 选择）：
- [ ] IMPL-001：工具类型定义
- [ ] IMPL-002：工具注册表
- [ ] IMPL-003：ReAct 执行器
- [ ] IMPL-004：read 工具
- [ ] IMPL-005：glob 工具
- [ ] IMPL-006：chat.ts 集成
- [ ] IMPL-007：UI 组件

## Step 4：命名一致性检查

**术语表关键术语**（requirements.md §1.3）：

| 术语 | 代码命名 |
|------|---------|
| 工具调用 | `tool_calling` |
| ReAct 循环 | `react_loop` |
| 工具注册表 | `tool_registry` |
| 工具执行器 | `tool_executor` |
| 工具调用日志 | `tool_call_log` |
| 工具调用指示器 | `tool_call_indicator` |
| 可展开详情 | `expandable_details` |
| 流式响应 | `stream_response` |

## Step 5：验证命令确认

| 验证类型 | 命令 |
|---------|------|
| Layer 1 单元测试 | `npx vitest run` |
| Layer 2 E2E | `node tests/e2e/layer2-tool-calling.js` |
| 类型检查 | `npx tsc --noEmit` |
| Lint | `npm run lint` |