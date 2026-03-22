<!--
doc-id: SESSION-START-talor-phase2-2.3
status: draft
version: 1.0
last-updated: 2026-03-22
depends-on: [IMPL-talor-phase2]
-->

# SESSION-START — Phase 2.3 实施会话必读

> **AI 开发者**：在调用任何工具修改代码前，必须完成以下 5 个步骤。
> 本文件专属于 **Phase 2.3**。全局信息见 `../../implementation.md`。
> **本文件由文档生成时填写项目专属内容，每次会话开始时更新 Step 2-3。**

---

## Step 1：确认本阶段目标

> 直接读以下文件，不在此抄写。

- [ ] 已读 `impl.md §P.0`，确认本阶段状态和阻塞项
- [ ] 已读 `../../implementation.md §4.2`，确认本阶段 Demo 目标和退出标准
- [ ] 已读 `impl.md §P.1`，确认本阶段剩余 IMPL 列表和 P0/P1/P2 优先级

**Phase 2.3 目标**：
- IMPL-007（P0）：消息附件 UI（文件选择 + 拖拽 + 预览 + 移除）
- IMPL-008（P1）：附件验证 + 多模态支持
- IMPL-009（P2）：Provider 多模态能力检测

**Phase 2.3 Demo 目标**：用户可附加图片/文件发送，AI 能感知附件内容，错误时显示明确提示

---

## Step 2：确认已完成的工作

> 直接读 `impl.md §P.2`，不在此抄写。

- [ ] 已读 `impl.md §P.2`，确认上次完成到哪、当前状态、已产出文件
- [ ] 若有未解决问题，已列入本次会话优先处理项（必须先处理，再开始新功能）

**当前 Checkpoint**：Phase 2.2 完成 ✅，Phase 2.3 待开始

---

## Step 3：本次会话范围声明（每次会话开始时填写）

**本次会话要实现的具体功能（一句话）：**
> 实现 Phase 2.3 IMPL-007 基础：添加附件按钮、附件状态管理、基本预览 UI

**以下内容不在本次会话范围内**（发现需要时写入 `../../deferred.md`，不要立刻实现）：
- Tool 调用（bash/read/write 等内置工具）
- employees/*.jsonc 数字员工契约加载
- 对话历史的复杂统计/搜索功能
- MCP 工具集成
- SSE 断线重连
- 消息编辑、Regenerate、重发
- 消息权限审批流程
- Phase 3 功能

**规则**：实施过程中想到"顺便加 X"时，立即写入 `../../deferred.md`，不要实现。

---

## Step 4：命名一致性确认（从 ../../requirements.md §1.3 术语表读取，不凭记忆）

> 本次会话涉及的模块/类/函数，必须使用以下规范名称。不允许使用同义词。

| 规格中的名称（§1.3） | 代码中必须用的名称 | 禁止的同义词 |
|-------------------|-----------------|-----------|
| 附件（Attachment） | `attachment` / `Attachment` | upload, fileUpload |
| 消息部分（MessagePart） | `messagePart` / `MessagePart` | contentPart, part |
| 文本部分（TextPart） | `textPart` / `TextPart` | plainText, textContent |
| 文件部分（FilePart） | `filePart` / `FilePart` | documentPart, fileContent |
| 图片部分（ImagePart） | `imagePart` / `ImagePart` | photoPart, imageContent |
| 消息类型（MessageType） | `messageType`，枚举：`text`/`attachment` | contentType, type |
| 文件大小（size_bytes） | `size_bytes` | fileSize, size |
| MIME 类型（mime_type） | `mime_type` | contentType, mimeType |
| 多模态（Multimodal） | `multimodal` / `supports_vision` | vision, imageSupport |

---

## Step 5：质量基线确认（每次会话开始时 checkbox）

- [ ] 已读 `../../implementation.md §4.3` Gotchas，知道本次实施的陷阱点
- [ ] 已读 `../../implementation.md §4.2`，知道当前阶段的 Critical Path 是什么
- [ ] 已读 `impl.md §P.1`，知道本阶段 P0/P1/P2 优先级排序
- [ ] 我知道本次修改后必须重新验证的 Demo 场景是什么
- [ ] 我已确认上次会话的 Checkpoint 没有遗留未连接的孤岛模块
- [ ] 测试在本次修改前是通过的（不接受"测试一直就是 broken 的"）

---

## 验证执行环境（AC 双层验证必读，不凭记忆）

| 字段 | 内容 |
|------|------|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| Layer 1 测试命令 | `npm run typecheck` |
| 测试包路径规则 | main: `src/main/**/*.ts`, preload: `src/preload/**/*.ts`, renderer: `src/**/*.{ts,tsx}` |
| Layer 2 验证工具 | 代码审查（无自动化测试） |
| 服务启动命令 | `cd talor-desktop && npm run dev` |
| 验证前置条件 | Electron 应用可启动，Provider 已配置 |

> **规则**：本节由 klook-vibe-plan 生成时填入，不得留空。每次 AC 验证前确认前置条件已满足。

---

完成以上 5 步后，方可开始实施。

**本会话结束时**：
1. 更新 `impl.md §P.0` 本阶段仪表盘（IMPL 完成率、AC 验证率）
2. 更新 `impl.md §P.2` 会话恢复 Checkpoint
3. 更新 `../../implementation.md §4.0` 全局仪表盘（同步 Phase 进度）
4. 如阶段完成：运行 `klook-vibe-verify`，再填写 `certificate.md`