# talor-desktop 工具调用功能设计文档

> **迭代级文档**。描述本次迭代**要改什么、怎么设计**。
> 迭代完成后，将本文档中的变更合并到 OVERVIEW / overview-talor-desktop，然后标记 archived。
>
> **追溯链**：US-000, US-001, US-002, US-003, US-004, US-005, US-006, US-007 → 本文档（FD-talor-desktop-tool-calling）→ IMPL-talor-desktop-tool-calling
> **依赖的 AC**：AC-000-01 ~ AC-007-04
>
> 产品需求见 `requirements.md §1.4 US-000~US-007`。
> 模块现状见 `OVERVIEW-talor-desktop.md`。
> 实施计划见 `implementation.md`。

---

<!--
doc-id: FD-talor-desktop-tool-calling
status: approved
version: 1.2
last-updated: 2026-03-24
depends-on: [REQ-talor-desktop-tool-calling]
generates: [IMPL-talor-desktop-tool-calling]
-->

---

## Pre-generation Checklist（生成前必须回答）

- [x] 已读 OVERVIEW-talor-desktop.md，了解模块当前状态
- [x] 本次变更涉及哪些状态机转换的新增或修改？（无新增状态机，纯功能扩展）
- [x] 是否涉及全局架构变更（新增中间件、Schema 大改、新 ADR）？（是，新增 Tool 模块 + 会话 workspace 字段）
- [x] 是否有并发/幂等要求？幂等键是什么？（工具调用为同步操作，无幂等要求）
- [x] 修改本功能会影响哪些下游服务？（无下游服务，纯前端+主进程变更）

---

## F.1 变更背景

**关联需求**：US-000, US-001, US-002, US-003, US-004, US-005, US-006, US-007（requirements.md §1.4）

**变更原因**：

当前 talor-desktop 仅支持纯文本对话，无法执行实际的文件操作任务。用户需要手动查找文件、复制路径、粘贴内容，流程繁琐。通过引入工具调用能力，用户可在聊天中直接要求 AI 执行 read/write/edit/glob/grep/ls/bash 等文件操作，AI 通过 ReAct 循环自动判断、调用工具、整合结果。

**变更范围**：
1. 新增 `src/main/tools/` 模块（工具注册表 + 7 个内置工具 + ReAct 执行器）
2. 新增并行工具调用支持（ReAct 执行器支持同时执行多个工具）
3. 修改会话表，新增 `workspace` 字段（会话级工作目录）
4. 修改 `src/main/ipc/chat.ts`（集成 ReAct 执行器）
5. 新增 UI 组件：工具调用指示器 + 可展开详情（`src/renderer/`）

---

## F.2 全局影响

### 新增模块/组件

| 组件 | 路径 | 职责 |
|------|------|------|
| 工具注册表 | `src/main/tools/registry.ts` | 存储工具定义（schema）+ 执行器引用 |
| 工具执行器 | `src/main/tools/executor.ts` | ReAct 循环：调用 LLM → 判断工具 → 执行 → 循环 |
| 工具类型定义 | `src/main/tools/types.ts` | ToolDefinition, ToolResult, ToolCallLog 接口 |
| 内置工具 | `src/main/tools/builtin/*.ts` | read/write/edit/glob/grep/ls/bash 7 个工具实现 |
| UI 组件 | `src/renderer/components/ToolCallLog.tsx` | 工具调用日志展示组件 |
| 工作目录选择器 | `src/renderer/components/WorkspaceSelector.tsx` | 会话级工作目录选择 UI |

### Schema 变更

**会话表（sessions）**：
```sql
-- 新增字段
ALTER TABLE sessions ADD COLUMN workspace TEXT;
```

**配置文件（config.json）**：
```json
{
  "tool": {
    "maxReadSizeBytes": 10485760,    // 默认 10MB
    "maxWriteSizeBytes": 10485760    // 默认 10MB
  }
}
```

### Schema / API / 全局协议变更

**变更前**：
```
chat:send IPC 只接收 text + attachments，返回 stream text chunks
```

**变更后**：
```
chat:send IPC 接收 text + attachments + workspace（会话的工作目录）
  ↓
  检查会话是否设置 workspace，未设置则拒绝工具调用
  ↓
  检查模型是否支持 tool_calling（通过 model-availability 检测）
  ↓
  支持：进入 ReAct 循环（streamText + tools，tools 受 workspace 限制）
  不支持：回退到纯文本 stream
```

### 环境差异变更

| 配置项 | dev 变更 | staging 变更 | prod 变更 |
|--------|---------|------------|---------|
| 工具可用路径 | 限制在会话 workspace 内 | 同 dev | 同 dev |
| 读取文件大小限制 | 默认 10MB（可配置） | 同 dev | 同 dev |
| 写入文件大小限制 | 默认 10MB（可配置） | 同 dev | 同 dev |

### 新增 Patterns

| Pattern 名称 | 使用场景 | 参考代码 |
|-------------|---------|---------|
| ReAct Loop | AI 模型多轮工具调用场景 | `src/main/tools/executor.ts` |
| Parallel Tool Execution | AI 模型并行调用多个工具场景 | `src/main/tools/executor.ts` (parallelExecute) |
| Tool Registry | 工具定义+执行器分离模式 | `src/main/tools/registry.ts` |
| Session-level Workspace | 每个会话独立的工作目录隔离 | 会话表 workspace 字段 |
| Streaming Tool Indicator | 流式响应中工具调用状态展示 | `src/renderer/components/ToolCallLog.tsx` |
| Workspace Path Validation | 工具执行时验证路径在工作目录内 | 各工具的 path validation |

---

## F.3 新增/变更的状态机转换

本次功能不涉及会话状态机转换的变更。工具调用属于纯功能扩展，不改变现有的会话/消息状态机。

**新增业务规则**：
- 会话无 workspace → 工具调用不可用
- 工具访问路径超出 workspace → 拒绝执行

---

## F.4 新增/变更的接口协议

### 新增接口

```
// src/main/tools/registry.ts
class ToolRegistry {
  register(tool: ToolDefinition, executor: (params: object, workspace: string) => Promise<ToolResult>): void
  getTool(name: string): ToolDefinition | undefined
  getAllSchemas(): ToolDefinition[]
  execute(name: string, params: object, workspace: string): Promise<ToolResult>
}

// src/main/tools/executor.ts
class ToolExecutor {
  constructor(model: LanguageModel, registry: ToolRegistry, workspace: string)
  run(messages: Message[], onToolCall?: (call: ToolCall) => void): AsyncIterable<StreamChunk>
}

// src/main/repos/session-repo.ts
interface Session {
  id: string
  workspace: string | null  // 新增：工作目录
  // ...
}

// IPC:session:updateWorkspace
ipcMain.handle('session:updateWorkspace', (sessionId, workspacePath) => {
  // 验证路径有效性，更新会话 workspace
})
```

### 变更接口

**变更前**：
```typescript
// src/main/ipc/chat.ts
ipcMain.handle('chat:send', (params) => {
  const result = streamText({ model, messages, onChunk })
  return result
})
```

**变更后**：
```typescript
// src/main/ipc/chat.ts
ipcMain.handle('chat:send', (params) => {
  // 获取会话的 workspace
  const session = sessionRepo.getById(params.session_id)
  if (!session.workspace) {
    throw new Error('WORKSPACE_NOT_SET')
  }
  
  // 检测模型能力
  if (model.supportsToolCalling) {
    // ReAct 循环，传递 workspace
    const executor = new ToolExecutor(model, toolRegistry, session.workspace)
    return executor.run(messages, onToolCall => {
      mainWindow.webContents.send('chat:toolCall', onToolCall)
    })
  } else {
    // 回退到纯文本
    return streamText({ model, messages, onChunk })
  }
})
```

---

## F.5 并发与幂等要求

### 幂等要求

| 操作 | 是否要求幂等 | 幂等键 | 处理方式 |
|------|------------|--------|---------|
| 工具执行 | 否 | N/A | 工具调用是同步操作，每次调用独立 |
| ReAct 循环 | 否 | N/A | 循环次数由模型决定，无幂等需求 |
| 工作目录设置 | 是 | session_id | 同一会话多次设置取最新值 |

### 并发锁策略

| 场景 | 锁类型 | 实现方式 | 超时配置 |
|------|--------|---------|---------|
| 会话 workspace 更新 | 本地锁 | sessionRepo 事务 | 无超时 |

### 重试机制

| 操作 | 是否重试 | 最大重试次数 | 重试间隔 | 不重试的条件 |
|------|---------|------------|---------|-----------|
| 工具执行失败 | 是 | 1 次 | 即时 | 权限错误、文件不存在、超范围等业务错误 |

### 竞态条件风险点

| 风险场景 | 可能后果 | 防护策略 |
|---------|---------|---------|
| 多会话同时设置 workspace | 覆盖问题 | workspace 按 session_id 隔离，无并发冲突 |
| 工具执行中 workspace 被删除 | 执行失败 | 检查 workspace 有效性后再执行 |

---

## F.6 涟漪分析（Ripple Analysis）

### 下游影响

| 变更内容 | 影响的下游模块/服务 | Breaking Change? | 迁移步骤 |
|---------|-----------------|----------------|---------|
| 会话表新增 workspace 字段 | 数据库需迁移 | ⚠️ 需确认 | ALTER TABLE sessions ADD COLUMN workspace |
| chat:send 返回格式变化 | 渲染进程需处理 toolCall 事件 | ⚠️ 需确认 | 新增事件监听 |
| 新增 UI 组件 | 无 | 否 | 新增组件 |

### 需要同步修改的关联模块

- [ ] `src/main/db/schema.sql`：新增 workspace 字段
- [ ] `src/main/repos/session-repo.ts`：新增 updateWorkspace 方法
- [ ] `src/main/providers/llm-provider.ts`：添加 `toolSchemas()` 方法导出工具 schema
- [ ] `src/renderer/pages/Chat/index.tsx`：处理 `chat:toolCall` 事件，更新 UI
- [ ] `src/renderer/pages/Chat/index.tsx`：新增工作目录设置 UI
- [ ] `OVERVIEW-talor-desktop.md`：合并工具模块的职责定义

### 需要通知的团队

- [ ] 无（桌面客户端独立模块）

---

## F.7 流程图

```mermaid
sequenceDiagram
    actor User
    participant UI as Chat/index.tsx
    participant IPC as ipc/chat.ts
    participant Repo as session-repo.ts
    participant LLM as llm-provider.ts
    participant Executor as tools/executor.ts
    participant Registry as tools/registry.ts
    participant Tools as tools/builtin/*.ts

    User->>UI: 发送消息
    UI->>IPC: chat:send(session_id, content)
    
    rect rgb(230, 245, 230)
        note right of IPC: 检查 workspace
    end
    
    IPC->>Repo: 获取会话 workspace
    Repo-->>IPC: workspace
    
    alt workspace 未设置
        IPC-->>UI: 返回错误"请先设置工作目录"
        UI->>User: 提示设置工作目录
    else workspace 已设置
        rect rgb(230, 245, 230)
            note right of IPC: 支持 tool calling?
        end
        
        alt 支持 tool calling
            IPC->>Executor: 创建 ToolExecutor(workspace)
            Executor->>LLM: streamText(model, messages, tools)
            
            rect rgb(255, 243, 224)
                note right of LLM: ReAct Loop
            end
            
            loop ReAct 循环
                LLM-->>Executor: chunk (toolCall)
                Executor->>Registry: execute(toolName, params, workspace)
                
                rect rgb(255, 235, 230)
                    note right of Registry: 验证路径在 workspace 内
                end
                
                Registry->>Tools: 调用工具函数
                Tools-->>Registry: ToolResult
                Registry-->>Executor: ToolResult
                Executor->>LLM: 将结果加入 messages，继续
                
                Executor->>UI: chat:toolCall (toolName, params, result)
                UI->>User: 显示工具调用指示器
            end
            
            LLM-->>Executor: chunk (text-delta)
            Executor->>UI: chat:stream (text-delta)
            UI->>User: 流式显示响应
        else 不支持 tool calling
            IPC->>LLM: streamText(model, messages)
            LLM-->>IPC: chunk (text-delta)
            IPC->>UI: chat:stream (text-delta)
            UI->>User: 流式显示响应
        end
    end
```

**异常路径**：
- workspace 未设置 → 返回错误，提示设置工作目录
- 工具执行失败 → 错误结果返回给 LLM，LLM 决定是否重试
- 工具执行超时（>30s） → 返回超时错误给 LLM
- 工具访问路径超出 workspace → 返回"无法访问工作目录外"错误
- 模型不支持 tool calling → 回退到纯文本模式

---

## F.8 AC 验证契约（Layer 2）

> 本节锁定 Layer 2 验证指令。L3 approved 时同步锁定，后续不可单方面修改。
> L4 §P.3 直接引用本节，不重新推导。

### Phase 3（US-002 write/edit/ls/grep 工具）

#### AC-005-01：write 工具创建新文件

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | 无（创建新文件） |
| 验证指令 | 1. 启动 Electron app（`npm run dev`）<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：`请帮我创建一个新文件 /tmp/test-e2e-write.txt，内容是 hello world`<br>4. 等待 AI 响应完成 |
| 预期断言 | 1. `window.talorAPI.chat.onToolCall` 捕获到 toolName='write' 的调用<br>2. 文件 `/tmp/test-e2e-write.txt` 存在且内容为 "hello world" |
| Teardown | 删除测试文件 `/tmp/test-e2e-write-*` |
| 关键参数溯源 | 文件路径 → Given 子句指定 `/tmp/test-e2e-write.txt` |

#### AC-005-02：write 工具对已存在文件

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | `fs.writeFileSync('/tmp/test-e2e-overwrite.txt', 'original content')` |
| 验证指令 | 1. 启动 Electron app<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：`请帮我创建一个新文件 /tmp/test-e2e-overwrite.txt，内容是 new content`<br>4. 等待 AI 响应完成 |
| 预期断言 | 1. `onToolCall` 捕获到 toolName='write' 的调用<br>2. 文件内容已更新（"new content"）或 LLM 正确处理了已存在情况 |
| Teardown | 删除测试文件 |
| 关键参数溯源 | 文件路径 → Given 子句指定 |

#### AC-005-03：write 工具父目录不存在

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | 确认 `/tmp/nonexistent-dir-xyz/` 不存在 |
| 验证指令 | 1. 启动 Electron app<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：`请帮我创建一个新文件 /tmp/nonexistent-dir-xyz/test.txt，内容是 hello`<br>4. 等待 AI 响应完成 |
| 预期断言 | 1. `onToolCall` 捕获到 toolName='write' 的调用<br>2. 工具返回错误（"父目录不存在"）或自动创建父目录（两种均可接受） |
| Teardown | 删除测试目录树 |
| 关键参数溯源 | 路径组合 → Given 子句 "父目录不存在" |

#### AC-005-04：edit 工具替换文件内容

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | `fs.writeFileSync('/tmp/test-e2e-edit.txt', 'hello world from edit test')` |
| 验证指令 | 1. 启动 Electron app<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：`请帮我把文件 /tmp/test-e2e-edit.txt 中的 "hello world" 替换成 "goodbye universe"`<br>4. 等待 AI 响应完成 |
| 预期断言 | 1. `onToolCall` 捕获到 toolName='edit' 的调用<br>2. 文件内容变为 "goodbye universe from edit test" |
| Teardown | 删除测试文件 |
| 关键参数溯源 | old/new 字符串 → Given 子句 "hello world" → "goodbye universe" |

#### AC-005-05：write 工具超大文件限制

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | 无（LLM 拒绝处理即为预期） |
| 验证指令 | 1. 启动 Electron app<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：请求创建 12MB 文件<br>4. 等待 AI 响应完成 |
| 预期断言 | LLM 拒绝处理超大内容（不调用 write 工具）或 write 工具返回大小超限错误 |
| Teardown | 确认 `/tmp/test-e2e-large.txt` 不存在 |
| 关键参数溯源 | 文件大小 → Given 子句 "超过 10MB" |

#### AC-002-04：grep 工具搜索文件内容

| 字段 | 内容 |
|------|------|
| 验证类型 | 单步验证 |
| 前置数据构造 | `fs.writeFileSync('/tmp/test-e2e-grep.txt', 'line 1: hello world\nline 2: foo bar\nline 3: hello again\nline 4: goodbye')` |
| 验证指令 | 1. 启动 Electron app<br>2. 创建测试会话，workspace = `/tmp`<br>3. 发送：`请在文件 /tmp/test-e2e-grep.txt 中搜索包含 "hello" 的行`<br>4. 等待 AI 响应完成 |
| 预期断言 | 1. `onToolCall` 捕获到 toolName='grep' 的调用<br>2. 工具返回包含 "hello" 的匹配行 |
| Teardown | 删除测试文件 |
| 关键参数溯源 | 搜索词 "hello" → Given 子句 |

---

### Phase 2（US-001 read/glob 工具，已验证）

| AC ID | 验证契约来源 | 验证状态 |
|-------|------------|---------|
| AC-001-01~05 | `phases/phase-2/verify-report.md` | ✅ 已完成 |
| AC-002-01~03 | `phases/phase-2/verify-report.md` | ✅ 已完成 |
| AC-004-01~02 | `phases/phase-2/verify-report.md` | ⚠️ 已完成（CDP 精度限制） |
| AC-007-01~04 | `phases/phase-2/verify-report.md` | ✅ 已完成 |

---

### Phase 4（US-003/004/006 bash 工具，待实施）

| AC ID | 验证契约 | 状态 |
|-------|---------|------|
| AC-003-01 | 多轮工具调用验证（ls → read） | ⬜ 待实施 |
| AC-003-03 | 循环上限处理验证 | ⬜ 待实施 |
| AC-004-04 | 超时 UI 显示验证 | ⬜ 待实施 |
| AC-006-01~05 | bash 工具各场景验证 | ⬜ 待实施 |

---

### Phase 5（US-007 MCP 接口预留）

| 内容 | 状态 |
|------|------|
| MCP 工具注册表接口设计 | ⬜ 待实施 |
| 无运行时 AC 验证（接口设计阶段） | — |

---

**验证执行入口脚本**：`node tests/e2e/layer2-tool-calling-phase3.js`（Phase 3 专用）
