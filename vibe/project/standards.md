# Talor Desktop 硬性约束

> **长期维护文档**。定义 AI 编码时**不可违反的红线**。
> 每次编码会话必读。违反任何一条 = 阻塞合并。
>
> 项目地图见 `overview.md`。代码模式见 `patterns.md`。全局协议见 `protocols/`。

---

## S.1 禁止事项（违反即阻塞合并）

| 禁止 | 原因 | 错误示例 |
|------|------|---------|
| 在渲染进程直接调用 Node.js API | contextIsolation=true，渲染进程无 Node 权限；且绕过 contextBridge 安全边界 | `import fs from 'fs'` in renderer |
| 在主进程 IPC handler 中执行 UI 逻辑 | 职责混淆，IPC handler 只负责数据处理和 DB 操作 | 在 `ipc/chat.ts` 中操作 DOM 或直接更新渲染层状态 |
| 跨进程直接共享可变对象引用 | Electron 进程间通信是序列化拷贝，不支持引用传递 | 将 Map/Set 对象通过 IPC 传递后期望双向同步 |
| 在 IPC handler 外直接调用 `webContents.send()` | 主窗口引用不确定是否存在，必须通过 `getMainWindow()` 守卫 | `mainWindow.webContents.send(...)` 未检查 mainWindow 是否存在 |
| 工具注册后重复注册同名工具 | `toolRegistry.register()` 遇到重名会抛异常，影响应用启动 | 在多个模块中各自调用 `registerBuiltinTools()` |
| 绕过 ToolRegistry 直接执行工具 | 绕过上下文默认值注入（超时/大小限制）和统一错误处理 | 在 chat.ts 中直接调用 `bashTool.execute()` |
| 高风险工具跳过用户确认 | bash/write/edit 有破坏性操作风险，缺少确认会静默执行危险操作 | 将 HIGH_RISK_TOOLS 中的工具 `riskLevel` 改为 `'LOW'` |
| 明文存储 API Key | API Key 泄露会导致供应商账号被盗用 | 在 config-store 中以 plaintext 存入 `api_key` 字段 |
| 在工具中访问 workspace 外路径 | 路径穿越攻击（path traversal），可读取/写入系统任意文件 | 工具中未调用 `resolveInWorkspace()` 直接使用用户输入路径 |
| 在工具中访问敏感系统路径 | `/etc/`, `/.ssh/`, `/.aws/` 等路径包含凭证和系统配置 | `bash.ts` 中忽略 `isPathSensitive()` 检查 |
| `messages.content` 存非 JSON 字符串 | `parseBlocks()` 依赖 JSON.parse，非 JSON 会导致消息渲染异常 | 直接存 `role: 'assistant', content: 'text string'` |
| 在 SQLite 事务外执行多步写操作 | 部分写入失败会产生脏数据 | `sessionRepo.create()` + `messageRepo.create()` 无事务包裹 |
| 修改 `sessions` / `messages` 表字段名或删除字段 | 需要迁移脚本，直接修改会破坏已有数据 | 直接 `ALTER TABLE sessions DROP COLUMN workspace` |
| 在 PromptPipeline 插件中直接 import ConfigStore | 插件通过 `PipelineContext` 获取配置，直接 import 单例破坏可测试性 | `import { ConfigStore } from '../store/config-store'` in plugin |

---

## S.2 遵守事项

| 规则 | 说明 | 正确示例 |
|------|------|---------|
| 工具执行必须通过 `toolRegistry.execute()` | 统一注入上下文默认值（超时/大小限制），统一错误处理 | `await toolRegistry.execute(toolName, input, context)` |
| IPC channel 命名格式为 `module:action` | 保持一致性，便于全局搜索 | `chat:send`, `session:list`, `providers:create` |
| 所有 IPC handler 返回结构化结果 | renderer 侧通过固定 shape 处理成功/失败 | `{ success: true, data: ... }` 或抛 `Error` |
| 所有文件路径操作必须调用 `resolveInWorkspace()` 后再使用 | 防止路径穿越，确保路径在 workspace 内 | 见 `read.ts`, `write.ts`, `edit.ts` 一致实现 |
| 工具结果超过 `MAX_TOOL_RESULT_BYTES`（8KB）须截断 | 避免超出 LLM context window 限制 | `ipc/chat.ts` 中截断逻辑 |
| Provider API Key 存储必须通过 `SafeStorageService` | 使用 Electron safeStorage API 加密 | `SafeStorageService.encrypt(apiKey)` |
| 新建 IPC handler 必须在 `src/main/index.ts` 中注册 | 主进程入口统一管理所有 handler 生命周期 | `registerChatHandlers()` 模式 |
| 新增 builtin 工具必须在 `src/main/tools/builtin/index.ts` 中导出注册函数 | 统一初始化入口 | `export function registerBuiltinTools()` |
| Electron 主窗口引用通过 `getMainWindow()` 获取 | 防止窗口关闭后的 null 引用错误 | `const win = getMainWindow(); if (!win) return` |
| TypeScript strict 模式，禁止 `any` 类型滥用 | `tsconfig.base.json` 中启用 strict，`any` 会掩盖类型错误 | 使用 `unknown` + 类型守卫替代 `any` |
| 共享类型定义放在 `src/shared/` | 跨进程（main/preload/renderer）共用的类型必须放在 shared | `ContentBlock`, `ToolConfirmRequest` 在 `src/shared/types/message.ts` |
| 使用 `@shared/*` 路径别名引用共享类型 | tsconfig.base.json 中配置了 `@shared/*` alias，确保各进程一致解析 | `import type { ContentBlock } from '@shared/types/message'` |

---

## S.3 代码分层规则

| 层 | 路径 | 允许做 | 禁止做 |
|----|------|--------|--------|
| IPC Handler 层 | `src/main/ipc/*.ts` | 解析 IPC 参数、调用 repo/service、通过 `webContents.send()` 推送事件 | 直接操作数据库、业务逻辑内联 |
| Repository 层 | `src/main/repos/*.ts` | SQLite CRUD、SQL 查询、数据格式转换（行 → 领域对象） | 业务逻辑、IPC 通信、状态校验 |
| Service 层 | `src/main/services/*.ts` | 外部 API 调用（Provider fetch/test）、能力检测、加密 | 直接操作数据库、IPC 通信 |
| Store 层 | `src/main/store/*.ts` | electron-store 读写、配置 schema 定义 | 业务逻辑、IPC 通信 |
| Prompt 插件层 | `src/main/prompt/plugins/*.ts` | 构建 `CoreMessage[]`，读取 `PipelineContext` | 直接调用 DB、发起 LLM 请求 |
| 工具层 | `src/main/tools/builtin/*.ts` | 执行文件/命令操作，返回 `{ output: unknown }` | IPC 通信、直接操作 DB、发起 LLM 请求 |
| Preload 层 | `src/preload/index.ts` | contextBridge 暴露 API，IPC 调用代理 | 业务逻辑、直接访问 Node.js 模块 |
| Renderer 层 | `src/renderer/**` | UI 渲染、状态管理（Zustand）、调用 `talorAPI` | 直接使用 Node.js API、直接访问数据库 |
| Shared 层 | `src/shared/**` | 类型定义、常量 | 包含任何运行时逻辑或 side effect |

---

## S.4 测试规范

### 开发工作流（TDD）

1. **Red**：先写测试文件，定义函数签名和预期行为，确认失败
2. **Green**：实现最小可用逻辑，通过测试
3. **Refactor**：消除重复，保持测试通过

### 覆盖要求

- **单元测试**：每个 service / repo / tool 方法覆盖正常路径 + 至少 1 个错误路径
- **工具测试**：builtin 工具必须覆盖路径穿越、敏感路径、文件大小超限三类安全场景
- **有效测试**：工具和 repo 测试使用真实文件系统/真实 SQLite，不 mock 核心依赖

### 测试文件约定

- 测试文件与实现文件同目录，命名为 `<module>.test.ts`
- 使用 Vitest 框架（`vitest.config` 继承 electron-vite 配置）
- 运行命令：`npm run test`（单次）/ `npm run test:watch`（监听）

### 禁止项

- 禁止断言 mock 的返回值（测试的是 mock 本身，无意义）
- 禁止 mock 掉 `resolveInWorkspace()` 或 `isPathSensitive()`（安全逻辑必须真实测试）
- 禁止测试文件中使用 `process.chdir()`（会影响其他并行测试）

---

## S.5 安全协议

- **工具沙箱**：所有文件操作工具（read/write/edit/glob/grep/ls）必须调用 `resolveInWorkspace()` 验证路径在 workspace 内，`bash` 工具额外检查 `isPatternDangerous()` 和敏感路径
- **危险命令拦截**：`bash` 工具内置 `DANGEROUS_PATTERNS`（`rm -rf /`, `mkfs`, `dd if=`, fork bomb 等），匹配则直接拒绝执行
- **高风险工具确认**：`HIGH_RISK_TOOLS = ['bash', 'write', 'edit']`，执行前必须通过 `requestToolConfirm()` 获取用户明确授权
- **API Key 加密**：Provider API Key 通过 Electron `safeStorage.encryptString()` 加密后存入 `~/.talor/config.json`，读取时解密，不可明文落盘
- **附件验证**：附件上传前验证文件存在性、大小（≤50MB）、MIME 类型（仅允许白名单类型），图片额外读为 Base64
- **contextBridge 边界**：renderer 只能通过 `window.talorAPI` 暴露的有限方法与主进程通信，无法访问任意 Node.js API
- **工具结果截断**：单个工具结果超过 `MAX_TOOL_RESULT_BYTES`（8192 bytes）须截断，防止 token 溢出
- **binary 文件保护**：`read` 工具检测文件 magic bytes，拒绝读取二进制文件（PNG/JPEG/PDF/ELF 等）
