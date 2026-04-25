<!--
doc-id: DEFERRED-talor-desktop-p0-agent-loop
status: active
version: 1.0
last-updated: 2026-04-25
-->

# Deferred Backlog — talor-desktop P0 Agent Loop

> 范围外功能暂存。每次会话结束后通知用户确认 pending 项。

| ID | 功能 | 原因 | 目标 Phase/迭代 |
|----|------|------|----------------|
| D-001 | Context window 自动压缩（超限时 summarize 历史消息） | P0 仅做简单截断，summarize 需要额外 LLM 调用 | 后续 P1 迭代 |
| D-002 | 工具执行 Undo / 回滚（文件修改前备份） | 需要 snapshot 机制，复杂度高 | 后续 P1 迭代 |
| D-003 | PTY terminal（交互式命令支持） | 需要 node-pty 依赖，electron 集成复杂 | 后续 P2 迭代 |
| D-004 | MCP 工具风险分级（按工具名/schema 自动分级） | P0 阶段 MCP 工具全部静默执行 | 后续迭代 |
| D-005 | 多模态附件的 ContentBlock 统一迁移（图片 base64 存入 image block） | 附件现有路径独立工作，P0 不改 | 后续迭代 |
| D-006 | Token 用量实时显示（每轮 step 的 token 消耗） | 需要 AI SDK usage 字段解析 | 后续 P1 迭代 |
