# Talor Desktop 事件协议

> 本项目为 Electron 桌面应用，无独立事件总线（无 Kafka / EventBridge / WebSocket pub-sub）。
>
> 所有 main → renderer 推送事件（`chat:stream`, `chat:tool-call`, `chat:tool-result`, `chat:tool-confirm`）
> 均通过 Electron `webContents.send()` 实现，完整文档见 [`api.md`](./api.md) — chat 模块推送事件章节。
