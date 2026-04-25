# Phase 1 会话执行 Prompt
# talor-desktop P0 Agent Loop — 消息 Schema 升级 + ContentBlock 序列化

---

## §一 编码红线（违反任意一条立即停止，向用户报告）

<!-- from: OVERVIEW-talor-desktop.md §MO.2 + §MO.7 + §MO.8，语气改写为第二人称强制 -->

1. 你必须在 renderer 进程中通过 `talorAPI`（contextBridge）访问 main process，禁止 renderer 直接 import electron 模块
2. 你必须使用 Proxy 懒加载模式暴露 talorAPI，禁止在模块顶层直接赋值 `window.talorAPI`
3. 你必须通过 `SafeStorageService` 加密存储 API Key，禁止明文存储
4. 你必须对 config.json 写入使用原子 rename（先写 `.tmp`，成功后 rename），禁止直接覆盖
5. 你必须在流式 streaming 状态下禁用发送按钮，禁止重复发送
6. 你必须启用 SQLite 外键约束（`db.pragma('foreign_keys = ON')`），禁止省略
7. 你禁止修改 `venv/` 目录
8. 你禁止删除或重命名 SQLite 表字段（必须通过 DROP + 重建或 ALTER ADD COLUMN）
9. 你禁止升级 major 版本依赖
10. 你禁止超过 5 个文件的改动而不先列清单等确认（本 Phase 已在 impl.md 中列明，视为已确认）
11. 你必须保持 Ollama provider 的 base_url 不含 `/v1`（由 `provider.get_api_base_url()` 自动处理）

---

## §二 代码模式（原文复制，直接使用）

<!-- from: OVERVIEW-talor-desktop.md §MO.7 -->

### 原子写入（Good Pattern）

```typescript
// src/main/store/config-store.ts
async saveConfig(updates: Partial<AppConfig>): Promise<void> {
  const tmpPath = join(this.configDir, 'config.json.tmp');
  const configPath = join(this.configDir, 'config.json');
  
  const newConfig = { ...this.config, ...updates };
  await writeFile(tmpPath, JSON.stringify(newConfig, null, 2));
  await rename(tmpPath, configPath);  // atomic
  
  this.config = newConfig;
}
```

### 懒加载 talorAPI（Good Pattern）

```typescript
// src/renderer/api/talorAPI.ts
export const talorAPI = new Proxy({} as TalorAPI, {
  get(_, channel) {
    return async (...args: any[]) => {
      const api = await window.talorAPI;
      return api[channel](...args);
    };
  }
});
```

### SafeStorage 加密（Good Pattern）

```typescript
// src/main/services/safe-storage.ts
async function encryptApiKey(apiKey: string, providerId: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available');
  }
  const encrypted = safeStorage.encryptString(apiKey);
  const keyPath = join(app.getPath('home'), '.talor', 'api-keys.enc');
  // 加密存储到文件
}
```

### 禁止：直接赋值 window.talorAPI（Anti-Pattern）

```typescript
// ❌ 错误 - preload 时序问题
window.talorAPI = { ... };

// ✅ 正确 - 使用 Proxy 懒加载
export const talorAPI = new Proxy({} as TalorAPI, {
  get(_, channel) { ... }
});
```

---

## §三 术语表

<!-- from: requirements.md §1.3，原文复制 -->

| 术语 | 定义 | 代码命名 | 易混淆项 |
|------|------|----------|----------|
| ContentBlock | 消息内容的原子单元，有类型标注（text / tool_use / tool_result / image / file） | `ContentBlock` | MessagePart（旧类型，废弃） |
| tool_use block | 表示一次工具调用请求的 ContentBlock，含 toolCallId / toolName / input | `ToolUseBlock` | tool_result block |
| tool_result block | 表示一次工具执行结果的 ContentBlock，含 toolCallId / toolName / output / isError | `ToolResultBlock` | tool_use block |
| ReAct step | Agent 推理循环的一轮：LLM 输出 → 执行工具 → 追加消息 | `reactStep` | 单次 streamText 调用 |
| 推理链 | 一次用户消息触发的完整多步工具调用序列，含所有 tool_use + tool_result messages | `reasoningChain` | 单条 assistant message |
| assistant message | role='assistant' 的消息，content 可含 text block 和/或 tool_use blocks | `assistantMessage` | tool message |
| tool message | role='tool' 的消息，content 含一组 tool_result blocks，对应一轮 tool_use | `toolMessage` | assistant message |
| HIGH 级工具 | 执行前必须弹确认框的内置工具：bash / write / edit | `HIGH_RISK_TOOLS` | LOW 级工具 |
| LOW 级工具 | 静默执行的只读内置工具：read / glob / grep / ls | `LOW_RISK_TOOLS` | HIGH 级工具 |
| 工具确认请求 | 主进程向渲染进程发送的确认事件，含工具名 + 参数摘要 | `ToolConfirmRequest` | tool_call IPC 事件 |
| 工具确认响应 | 渲染进程回传的用户决策：approved / rejected | `ToolConfirmResponse` | tool_result |
| 清库迁移 | 丢弃全部历史 messages 数据，重建表结构 | `dropAndRecreate` | 兼容迁移 |

---

## §四 决策框架

<!-- from: requirements.md §1.7，原文复制 -->

**优先级排序**：正确性 > 安全性 > 性能 > 体验

| 场景 | 决策 |
|------|------|
| 消息模型 schema 变更 | 清库重来（丢失历史数据），不做兼容迁移 |
| content_type 缺失的旧消息 | parse 失败时降级为空 text block，不 crash |
| tool_result 大输出 | 截断到 50KB，不存全量 |
| 确认框超时 | 自动拒绝，不自动批准 |
| 用户拒绝工具执行 | Agent 收到拒绝 tool_result，由 Agent 自行决策，不强制终止 loop |
| MCP 工具风险分级 | P0 阶段全部 MCP 工具静默执行，后续迭代再分级 |

---

## §五 已知陷阱

<!-- from: implementation.md §4.3，语气改写为第二人称强制 -->

1. 你必须在 `electron.vite.config.ts` 为 main 和 renderer 都添加 `@shared` 别名，指向 `src/shared/`，否则 `src/shared/types/message.ts` 无法跨进程引用
2. 你必须注意 Vercel AI SDK `role: 'tool'` 消息格式：content 必须是 `{ type: 'tool-result', toolCallId, toolName, result }` 数组，不是 `tool_result`
3. 你在清库迁移后无需处理旧 content 纯文本问题（旧数据已清空），但仍保留 try/catch 降级到 `[{type:'text', text: content}]` 作为防御
4. 你必须在 `await result.toolResults` 之后才能写库，`toolResults` 是 Promise，提前调用无值
5. 你在使用 `ipcMain.once` 时必须处理 Promise.race 后的多余响应：收到响应后校验 toolCallId 一致才 resolve，多余响应直接忽略
6. 你在多 session 并发时必须用 toolCallId 区分不同 session 的 confirm 响应，禁止用 sessionId 作为唯一标识
7. 你必须确保 `ToolConfirmDialog.tsx` 在 `src/renderer/components/` 下，使其在 Tailwind `content` glob 覆盖范围内
8. 你在写 tool_result output 时必须统一 `String(output ?? '')` 处理 undefined，防止 JSON.stringify 产生 `null`

---

## §六 验证环境

<!-- [ON-DEMAND] 加载 phases/phase-1/impl.md §4 获取完整验证环境配置 -->

| 项目 | 值 |
|------|---|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| 启动命令 | `npm run dev` |
| DB 路径 | `~/.talor/chat.db` |
| 验证工具 | `sqlite3 ~/.talor/chat.db` |
| DB reset | `rm ~/.talor/chat.db` 后重启应用 |

---

## §七 会话状态

<!-- from: implementation.md §4.0 + phases/phase-1/impl.md §1/§2 -->

**当前 Phase**：Phase 1 — 消息 Schema 升级 + ContentBlock 序列化

**任务队列**（按 Critical Path 顺序执行）：
1. ⬜ IMPL-001：新建 `src/shared/types/message.ts`（共享类型）
2. ⬜ IMPL-002：DB 清库迁移（`src/main/db/index.ts`）
3. ⬜ IMPL-003：messageRepo 序列化/反序列化（4 个文件）

**阶段退出标准**：用户发送消息 → `messages` 表存储 ContentBlock JSON，sqlite3 可查到 `{type:"text"}` block（AC-001-01, AC-001-02 通过）

**下一 Phase**：Phase 2 — ReAct 推理链实时入库（需 Phase 1 certificate 签收）
