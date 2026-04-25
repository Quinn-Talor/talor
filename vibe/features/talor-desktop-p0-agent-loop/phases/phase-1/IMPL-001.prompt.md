# IMPL-001 执行 Prompt
# 新建共享类型文件 `src/shared/types/message.ts`

---

## 第一步：你要实现什么

<!-- from: phases/phase-1/impl.md §2 IMPL-001 -->

创建 `src/shared/types/message.ts`，包含：
1. `ContentBlock` 联合类型及其 5 个子类型（TextBlock, ImageBlock, FileBlock, ToolUseBlock, ToolResultBlock）
2. `HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] as const`
3. `HighRiskTool` 类型
4. `MAX_TOOL_RESULT_BYTES = 50 * 1024`
5. `ToolConfirmRequest` 和 `ToolConfirmResponse` 接口（供 Phase 3 使用，在此一并定义）

同时修改 `electron.vite.config.ts`，为 main 和 renderer 添加 `@shared` 别名。

---

## 第二步：验收条件（AC）

<!-- from: requirements.md §1.8，原文复制 -->

**AC-001-01（部分）**：
- Given: 数据库文件 `~/.talor/chat.db` 存在，`messages` 表无 `content_type` 列（旧版 schema）
- When: 启动 talor-desktop
- Then: `[数据]` `messages` 表包含 `content_type TEXT NOT NULL DEFAULT 'blocks'` 列

**AC-001-02（部分）**：
- Given: talor-desktop 运行中，存在活跃会话
- When: 用户发送纯文本消息"分析 src 目录结构"（无附件）
- Then: `[数据]` messages 表新增记录：role='user', content_type='blocks', content 为合法 JSON 数组，反序列化后包含 `{type:"text", text:"分析 src 目录结构"}`

---

## 第三步：接口设计

<!-- from: feature.md §F.2，原文复制 -->

```typescript
// src/shared/types/message.ts

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | FileBlock
  | ToolUseBlock
  | ToolResultBlock

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  image: string        // base64 data URL
  mimeType: string
}

export interface FileBlock {
  type: 'file'
  filename: string
  mimeType: string
  path: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  toolCallId: string
  toolName: string
  input: unknown
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolCallId: string
  toolName: string
  output: string       // 已截断，≤ 50KB
  isError: boolean
}

export const MAX_TOOL_RESULT_BYTES = 50 * 1024  // 50KB
export const HIGH_RISK_TOOLS = ['bash', 'write', 'edit'] as const
export type HighRiskTool = typeof HIGH_RISK_TOOLS[number]

export interface ToolConfirmRequest {
  sessionId: string
  messageId: string
  toolCallId: string
  toolName: string           // 'bash' | 'write' | 'edit'
  inputSummary: string       // 用于 UI 展示的参数摘要（≤ 500 chars）
  inputFull: unknown         // 完整 input，用于实际执行
}

export type ToolConfirmDecision = 'approved' | 'rejected'

export interface ToolConfirmResponse {
  toolCallId: string
  decision: ToolConfirmDecision
}
```

**electron.vite.config.ts 别名配置**：
```typescript
// 在 main 和 renderer 的 resolve.alias 中各添加：
'@shared': resolve(__dirname, 'src/shared')
```

---

## 第四步：代码索引

<!-- from: OVERVIEW-talor-desktop.md §MO.4 -->

| 文件 | 当前职责 | 本任务变更 |
|------|---------|-----------|
| `src/main/db/index.ts` | better-sqlite3 初始化 + Schema | 下一 IMPL 修改 |
| `src/main/repos/session-repo.ts` | 会话/消息 CRUD | 下一 IMPL 修改 |
| `src/preload/index.ts` | contextBridge 暴露 talorAPI | 下下 IMPL 修改 |
| `src/renderer/types/chat.ts` | 会话/消息类型 | 下下 IMPL 修改 |
| **新建** `src/shared/types/message.ts` | 共享 ContentBlock 类型 | **本任务新建** |
| **修改** `electron.vite.config.ts` | 构建配置 | **本任务修改** |

---

## 第五步：声明

完成本 IMPL 后，更新 `phases/phase-1/impl.md §1 Checkpoint`：
```
上次停在：IMPL-001 完成
当前卡点：无
下次从：IMPL-002 开始
```

---

## 第六步：验证

**Layer 1（构建验证）**：
```bash
cd /Users/quinn.li/Desktop/talor/talor-desktop
npx tsc --noEmit
# 期望：0 错误
```

**Layer 2（@shared 别名验证）**：
```bash
# 在 chat.ts 或 session-repo.ts 中临时 import ContentBlock
# import type { ContentBlock } from '@shared/types/message'
# 构建不报错即验证通过
```

验证通过后：
1. 更新 `phases/phase-1/impl.md §1 Checkpoint`
2. 更新 `implementation.md §4.0` IMPL 完成率（1/7）
