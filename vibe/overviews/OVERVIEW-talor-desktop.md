<!--
doc-id: OVERVIEW-talor-desktop
status: active
version: 1.2
last-updated: 2026-03-22
depends-on: [OVERVIEW]
-->

# OVERVIEW — talor-desktop 模块

> Talor Desktop 模块现状文档。详细描述 Electron 桌面客户端的职责、边界、依赖、接口和核心逻辑。
> 依赖项目级文档 `overview.md`，本模块文档是 AI agent 在 talor-desktop 项目中工作的起点。

---

## §MO.1 职责

### 负责

1. **桌面客户端入口** — Electron 主进程管理窗口生命周期、IPC handler 注册、应用启动
2. **LLM Provider 配置管理** — 配置 CRUD（list/create/update/delete/setDefault）、连接测试、API Key 加密
3. **聊天会话管理** — SQLite 持久化（sessions、messages 表）、会话创建/删除/重命名
4. **流式对话** — SSE 流式接收 LLM 响应、打字机效果渲染、中断功能
5. **消息附件**（开发中）— 文件选择、Base64 编码、多模态 LLM 调用

### 不负责

1. **LLM 执行** — 由后端 talor/Python 处理（但 Phase 2 后可直接调用 Vercel AI SDK）
2. **数字员工契约解析** — 由后端 talor 处理
3. **MCP 协议** — 由后端 talor 处理
4. **插件系统** — 由后端 talor 处理

---

## §MO.2 边界

| 边界类型 | 说明 |
|----------|------|
| **拥有** | `~/.talor/config.json`（Provider 配置）、`~/.talor/chat.db`（会话数据）、`~/.talor/api-keys.enc`（加密密钥） |
| **只读** | 无 |
| **禁止** | renderer 进程直接 import electron、renderer 直接访问网络、API Key 明文存储 |
| **上游** | 用户操作 → talor-desktop → 后端 talor（可选，Phase 2 后可直接调用 LLM） |
| **下游** | 无 |

---

## §MO.3 外部依赖

| 依赖项 | 类型 | 超时 | 降级策略 |
|--------|------|------|---------|
| Ollama | LLM Provider | 5000ms | 返回错误，提示"请先启动 Ollama" |
| OpenAI API | LLM Provider | 5000ms | 返回错误，提示"API Key 无效" |
| Anthropic API | LLM Provider | 5000ms | 返回错误，提示"API Key 无效" |
| Google API | LLM Provider | 5000ms | 返回错误，提示"API Key 无效" |
| SQLite (chat.db) | 本地数据库 | 1000ms | 初始化失败时创建新数据库 |
| Electron safeStorage | OS 加密 | 1000ms | 不可用时弹出警告，不加密存储 |

---

## §MO.4 代码索引

### 主进程（src/main/）

| 文件 | 职责 |
|------|------|
| `index.ts` | Electron 入口：窗口创建、handler 注册、DB 初始化 |
| `ipc/config.ts` | config:get / config:save |
| `ipc/providers.ts` | providers:list/create/update/delete/setDefault/testConnection |
| `ipc/session.ts` | session:list/create/delete/rename/getMessages |
| `ipc/chat.ts` | chat:send (SSE 流式) |
| `ipc/window.ts` | window:minimize/maximize/close/isMaximized |
| `store/config-store.ts` | ConfigStore 单例（electron-store + 原子写入） |
| `services/safe-storage.ts` | safeStorage 加密/解密 |
| `services/provider-tester.ts` | HTTP 连接测试 |
| `db/index.ts` | better-sqlite3 初始化 + Schema |
| `repos/session-repo.ts` | 会话/消息 CRUD |
| `providers/llm-provider.ts` | Vercel AI SDK 封装 |

### 预加载（src/preload/）

| 文件 | 职责 |
|------|------|
| `index.ts` | contextBridge 暴露 talorAPI |

### 渲染进程（src/renderer/）

| 文件 | 职责 |
|------|------|
| `App.tsx` | 状态路由（home ↔ settings） |
| `pages/Home.tsx` | 主页（会话列表侧边栏 + 聊天主区域） |
| `pages/Chat/index.tsx` | 聊天页面 |
| `pages/Settings/index.tsx` | 设置页 |
| `pages/Settings/ProviderList.tsx` | Provider 列表 |
| `pages/Settings/ProviderForm.tsx` | 新增/编辑表单 |
| `components/Header.tsx` | 窗口控件 |
| `components/MessageBubble.tsx` | 消息气泡（Markdown + 代码高亮） |
| `components/SessionItem.tsx` | 会话列表项 |
| `components/ConnectionTest.tsx` | 连接测试按钮 |
| `components/ConfirmDialog.tsx` | 危险操作确认 |
| `store/configStore.ts` | 配置状态管理 |
| `store/chatStore.ts` | 聊天状态（流式状态） |
| `api/talorAPI.ts` | 懒加载 Proxy |
| `hooks/useStreamingMessage.ts` | SSE 流式 Hook |
| `types/config.ts` | Provider 类型 |
| `types/chat.ts` | 会话/消息类型 |

---

## §MO.5 领域模型 + 接口协议

### AppConfig

```typescript
interface AppConfig {
  config_dir: string;                    // ~/.talor/
  providers: Record<string, Provider>;    // Provider 字典
  window_bounds: WindowBounds;           // 窗口尺寸/位置
}
```

### Provider

```typescript
interface Provider {
  id: string;           // UUIDv4
  type: 'ollama' | 'openai' | 'anthropic' | 'google';
  name: string;         // 业务展示名
  base_url: string;    // 服务端点
  models: string[];    // 可用模型列表
  enabled: boolean;
  is_default: boolean;
  created_at: string;  // ISO 8601
  updated_at: string;
  // api_key 不存储，通过 safeStorage 单独加密
}
```

### ChatSession

```typescript
interface ChatSession {
  id: string;           // UUIDv4
  title: string;        // 会话标题
  provider_id: string; // 关联 Provider ID
  model_id?: string;
  created_at: string;
  updated_at: string;
}
```

### ChatMessage

```typescript
interface ChatMessage {
  id: string;           // UUIDv4
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;     // JSON 字符串，含 parts
  created_at: string;
}
```

### StreamState

```typescript
type StreamState = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';
```

---

## §MO.6 状态机定义

### Provider 生命周期

```
[*] --> idle: 创建 Provider (uuid 生成)
idle --> testing: 用户点击测试连接
testing --> idle: 测试成功/失败
testing --> idle: 超时 5s
idle --> saving: 用户点击保存
saving --> idle: 保存失败
saving --> saved: 保存成功
saved --> idle: 用户触发编辑
saved --> deleted: 用户点击删除并确认
deleted --> [*]
```

### 测试状态

| 状态 | 值 | 含义 |
|------|-----|------|
| idle | `'idle'` | 未测试或测试已完成 |
| testing | `'testing'` | 测试请求进行中 |
| success | `'success'` | 测试成功，含 latency_ms |
| failure | `'failure'` | 测试失败，含 error_code + message |

### 表单模式

| 状态 | 值 | 含义 |
|------|-----|------|
| closed | `'closed'` | 默认/表单关闭 |
| creating | `'creating'` | 点击新增 Provider |
| editing | `'editing'` | 点击编辑 Provider |

### 聊天流式状态

| 状态 | 值 | 含义 |
|------|-----|------|
| idle | `'idle'` | 空闲，可发送消息 |
| streaming | `'streaming'` | SSE 流式接收中 |
| done | `'done'` | 流式完成 |
| error | `'error'` | 流式出错 |
| aborted | `'aborted'` | 用户主动中断 |

---

## §MO.7 核心逻辑规则

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

### 流式消息 Hook（Good Pattern）

```typescript
// src/renderer/hooks/useStreamingMessage.ts
const { sendMessage, abort } = useCallback((sessionId, content) => {
  setStreamState('streaming');
  const eventSource = talorAPI.chat.send(sessionId, content);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'text') {
      setPendingContent(prev => prev + data.content);
    } else if (data.type === 'done') {
      setStreamState('done');
    }
  };
  
  eventSource.onerror = () => setStreamState('error');
}, []);
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

### 禁止：流式时重复发送（Anti-Pattern）

```typescript
// ❌ 错误 - 无保护
const handleSend = () => talorAPI.chat.send(...);

// ✅ 正确 - 禁用按钮
<button disabled={streamState === 'streaming'} onClick={handleSend}>
  发送
</button>
```

---

## §MO.8 已知陷阱

| 陷阱 | 正确做法 | 关联文件 |
|------|---------|---------|
| preload 编译为 `.mjs`，main process 引用路径必须一致 | preload 路径写 `index.mjs` | `src/main/index.ts` |
| talorAPI 模块顶层直接赋值失败 | 使用 Proxy 懒加载 | `src/renderer/api/talorAPI.ts` |
| config.json 写入必须 atomic rename | 写 `config.json.tmp`，成功后 rename | `src/main/store/config-store.ts` |
| ollama base_url 不含 `/v1` | 按 type 构造不同 base_url | `src/main/services/provider-tester.ts` |
| AbortController 取消重复测试请求 | 维护一个 AbortController | `src/main/services/provider-tester.ts` |
| setDefault 需两步原子写 | 先全置 false，再目标置 true | `src/main/store/config-store.ts` |
| SSE 流式状态下禁止重复发送 | 流式中禁用发送按钮 | `src/renderer/store/chatStore.ts` |
| renderer 不能直接访问网络 | 所有 LLM 调用必须通过 main process IPC | `src/main/ipc/chat.ts` |
| better-sqlite3 需 native rebuild | `@electron/rebuild` 确保二进制兼容 | `package.json` devDependencies |
| SQLite 外键约束需显式启用 | `db.pragma('foreign_keys = ON')` | `src/main/db/index.ts` |

---

## §MO.9 Phase 边界

### Phase 1 ✅ 已完成

- 桌面客户端框架搭建
- Provider 配置 CRUD
- 连接测试服务
- API Key safeStorage 加密
- 窗口尺寸/位置持久化

### Phase 2 🔄 进行中

- **Phase 2.1 ✅** - 流式对话 MVP（打字机效果 + 中断功能）
- **Phase 2.2 ✅** - 错误处理 + Markdown 渲染
- **Phase 2.3 ⬜** - 消息附件功能（待开发）

### Phase 3 待规划

- Tool 调用 + 数字员工契约
- employees/*.jsonc 加载
- Agent 执行引擎集成