<!--
doc-id: SESSION-START-talor-phase2
status: active
last-updated: 2026-03-21
-->
# SESSION-START — 每次实施会话必读

> **AI 开发者**：在调用任何工具修改代码前，必须完成以下 5 个步骤。
> 跳过此清单 = 在没有地图的情况下开车——你会把精力花在错误的地方。
> **本文件由文档生成时填写项目专属内容，每次会话开始时更新 Step 2-3。**

---

## Step 1：确认当前阶段（从 IMPLEMENTATION.md §4.2 读取，不凭记忆）

| 字段 | 内容 |
|------|------|
| 当前阶段 | Phase 2.1：流式对话 MVP |
| 本阶段 Demo 目标 | 用户选择 Provider → 输入文字 → 看到流式打字机效果 → 点击停止中断 |
| 本阶段完成标准 | AC-001-01, AC-001-02, AC-001-03, AC-001-07, AC-003-05, AC-004-01, AC-004-02 全部通过 |
| 本阶段剩余工作 | IMPL-010 → IMPL-001 → IMPL-003 → IMPL-004 → IMPL-012 |
| Phase 2.2 | 会话管理与完善：IMPL-011, 002, 005, 006（AC-001-04~08, AC-002, AC-003, AC-005-11） |
| Phase 2.3 | 消息附件：IMPL-007, 008, 009（AC-005-01~10） |

---

## Step 2：确认已完成的工作（从 IMPLEMENTATION.md §4.1 会话恢复 Checkpoint 读取）

| 字段 | 内容 |
|------|------|
| 上次完成到 | 文档已生成：REQUIREMENTS.md、FEATURE-talor-phase2.md、IMPLEMENTATION.md |
| 当前状态 | 等待首次编码会话 |
| 已产出文件 | vibe/features/talor-desktop-phase2/ 下所有 L2/L3/L4 文档 |
| 未解决问题 | 无 |

**规则**：如果有未解决问题，本会话必须先处理它们，再开始新功能。

---

## Step 3：本次会话范围声明（每次会话开始时填写）

**本次会话要实现的具体功能（一句话）：**
> （等待会话开始时填写）

**以下内容不在本次会话范围内**（发现需要时记入 IMPLEMENTATION.md §4.6，不要立刻实现）：
- Tool 调用（bash/read/write 等内置工具）→ Phase 3
- employees/*.jsonc 数字员工契约加载 → Phase 3
- SSE 断线重连 → Phase 3
- 消息编辑、Regenerate、重发 → Phase 3
- MCP 工具集成 → Phase 3

**规则**：实施过程中想到"顺便加 X"时，写入 §4.6 范围外功能列表，不要实现。

---

## Step 4：命名一致性确认（从 REQUIREMENTS.md §1.3 术语表读取，不凭记忆）

> 本次会话涉及的模块/类/函数，必须使用以下规范名称。不允许使用同义词。

| 规格中的名称（§1.3） | 代码中必须用的名称 | 禁止的同义词 |
|-------------------|-----------------|-----------|
| Session（会话） | `ChatSession` / `session` | conversation, chat |
| Message（消息） | `ChatMessage` / `message` | turn, chatMessage |
| MessagePart（消息部分） | `MessagePart` / `messagePart` | content block, part |
| MessageType（消息类型） | `messageType` | content_type, messageKind |
| Attachment（附件） | `attachment` / `Attachment` | upload, file upload |
| TextPart（文本部分） | `textPart` / `TextPart` | textContent |
| FilePart（文件部分） | `filePart` / `FilePart` | fileBlock |
| ImagePart（图片部分） | `imagePart` / `ImagePart` | imageBlock |
| Streaming Response（流式响应） | `streaming` / `streamingMessage` | stream, realtime |
| Provider（LLM 提供商） | `provider` / `LLMProvider` | backend, service |
| Model（模型） | `model` / `ModelInfo` | engine, llmModel |
| SSE（Server-Sent Events） | `sse` | EventSource, WebSocket |
| Abort（流式中断） | `abort` / `cancelled` | stop, cancel |

---

## Step 5：质量基线确认（每次会话开始时 checkbox）

- [ ] 已读 IMPLEMENTATION.md §4.3 Gotchas，知道本次实施的陷阱点
- [ ] 已读 IMPLEMENTATION.md §4.2，知道当前阶段的 Critical Path 是什么
- [ ] 我知道本次修改后必须重新验证的 Demo 场景是什么
- [ ] 我知道 Critical Path 上哪些函数不能返回占位数据
- [ ] 我已确认上次会话的 Checkpoint 没有遗留未连接的孤岛模块
- [ ] 测试在本次修改前是通过的（不接受"测试一直就是 broken 的"）

---

## 验证执行环境（AC 双层验证必读，不凭记忆）

| 字段 | 内容 |
|------|------|
| 项目根目录 | `/Users/quinn.li/Desktop/talor` |
| 桌面端目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| Layer 1 测试命令 | `cd talor-desktop && npm run typecheck` |
| Layer 2 验证命令 | `cd talor-desktop && npm run dev`（手动 Playwright 操作） |
| 服务启动命令 | `cd talor-desktop && npm run dev` |
| 验证前置条件 | Ollama 运行中（`ollama serve`）或 API Key 已配置于 Provider |

> **规则**：本节由 klook-vibe-impl-plan 生成时填入，不得留空。每次 AC 验证前确认前置条件已满足。

---

完成以上 5 步后，方可开始实施。

**本会话结束时**：
1. 更新 `IMPLEMENTATION.md §4.0` 实施仪表盘（IMPL 完成率、AC 验证率）
2. 更新 `IMPLEMENTATION.md §4.1` 的"会话恢复 Checkpoint"
3. 更新 `IMPLEMENTATION.md §4.1` 的"已完成功能清单"
4. 如阶段完成：填写并提交 `phase-guard/phase-2.md` 证书
