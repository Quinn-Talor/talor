<!--
doc-id: OVERVIEW-talor-desktop
status: active
version: 1.0
last-updated: 2026-03-21
-->

# OVERVIEW — Talor Desktop

> Talor Desktop 模块现状文档。本文档是 Phase 1 的实施总结，包含技术栈、模块依赖、全局协议、Patterns、ADR。
> 本文档由 Phase 1 完成后生成，替代 `vibe/features/talor-desktop-phase1/FEATURE-talor-phase1.md` 中的架构决策。

---

## §O.1 技术栈

| 组件 | 技术选型 | 版本 |
|------|---------|------|
| 运行时 | Electron | ^34.2.0 |
| 前端框架 | React | ^19.0.0 |
| 状态管理 | Zustand | ^5.0.3 |
| 构建工具 | electron-vite | ^3.0.0 |
| 前端构建 | Vite | ^6.2.2 |
| 语言 | TypeScript (strict) | ^5.8.2 |
| 样式 | Tailwind CSS | ^3.4.17 |
| 打包 | electron-builder | ^25.1.8 |
| 持久化 | electron-store | ^10.0.0 |
| 加密 | Electron safeStorage (OS级) | 内置 |
| 日志 | electron-log | ^5.2.4 |

---

## §O.2 模块架构

```
talor-desktop/
├── src/
│   ├── main/                          # Electron 主进程（Node.js, CJS）
│   │   ├── index.ts                   # 入口：窗口创建 + handler 注册
│   │   ├── ipc/
│   │   │   ├── config.ts              # config:get / config:save
│   │   │   ├── window.ts              # window:minimize/maximize/close/isMaximized
│   │   │   └── providers.ts           # providers:list/create/update/delete/setDefault/testConnection
│   │   ├── store/
│   │   │   └── config-store.ts        # ConfigStore 单例（electron-store + 原子写入）
│   │   └── services/
│   │       ├── provider-tester.ts     # HTTP 连接测试（AbortController）
│   │       └── safe-storage.ts        # safeStorage API Key 加密
│   ├── preload/                       # 预加载脚本（contextBridge）
│   │   └── index.ts                   # 暴露 window.talorAPI（.mjs）
│   └── renderer/                      # React 前端（ESM, Vite 打包）
│       ├── main.tsx                   # React 根入口
│       ├── App.tsx                    # 状态路由（home ↔ settings）
│       ├── pages/
│       │   ├── Home.tsx              # 主页
│       │   └── Settings/
│       │       ├── index.tsx          # 设置页
│       │       ├── ProviderList.tsx  # Provider 列表
│       │       └── ProviderForm.tsx  # 新增/编辑表单
│       ├── components/
│       │   ├── Header.tsx            # 窗口控件 + 设置按钮
│       │   ├── ConnectionTest.tsx     # 连接测试按钮
│       │   ├── ConfirmDialog.tsx     # 危险操作确认
│       │   └── EmptyState.tsx        # 空状态
│       ├── store/
│       │   └── configStore.ts        # Zustand 状态管理
│       ├── api/
│       │   └── talorAPI.ts          # window.talorAPI 懒加载 Proxy
│       ├── lib/
│       │   └── validation.ts        # 表单验证
│       └── types/
│           └── config.ts             # TypeScript 类型定义
├── talor-desktop/                    # 主进程 tsconfig
├── tsconfig.main.json
├── tsconfig.preload.json
├── tsconfig.json                      # renderer tsconfig
├── electron.vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── electron-builder.yml
```

---

## §O.3 环境差异

| 配置项 | dev | staging | prod |
|--------|-----|---------|------|
| config_dir | `~/.talor/` | `~/.talor/` | `~/.talor/` |
| 窗口默认尺寸 | 1200x800 | 1200x800 | 1200x800 |
| 连接测试超时 | 5000ms | 5000ms | 5000ms |
| 日志级别 | debug (electron-log) | info | error |
| safeStorage | 始终可用 | 始终可用 | 始终可用 |

---

## §O.4 IPC 通道定义

### config:get
- **参数**: 无
- **返回**: `AppConfig`（config_dir, providers, window_bounds）

### config:save
- **参数**: `Partial<AppConfig>`
- **返回**: `void`

### providers:list
- **参数**: 无
- **返回**: `Provider[]`

### providers:create
- **参数**: `ProviderInput`
- **返回**: `Provider`

### providers:update
- **参数**: `id: string`, `updates: ProviderInput`
- **返回**: `Provider`

### providers:delete
- **参数**: `id: string`
- **返回**: `void`

### providers:setDefault
- **参数**: `id: string`
- **返回**: `void`

### providers:testConnection
- **参数**: `{ type, base_url, api_key? }`
- **返回**: `ConnectionTestResult`

### window:minimize / maximize / close
- **参数**: 无
- **返回**: `void`（send，非 invoke）

### window:isMaximized
- **参数**: 无
- **返回**: `boolean`

---

## §O.5 全局约束（禁止事项）

- `contextIsolation` 必须为 `true`，`nodeIntegration` 必须为 `false`
- 不得在 renderer 进程中直接 import `electron` 模块
- API Key 不得明文存储，必须通过 `safeStorage` 加密
- `config.json` 写入必须使用原子 rename（先写 `.tmp` 再 rename）
- preload 编译输出为 `.mjs`，main process 中引用必须为 `index.mjs`（非 `.js`）
- `talorAPI` 必须在 renderer 侧使用懒加载（Proxy/函数封装），不得在模块顶层直接赋值 `window.talorAPI`

---

## §O.6 状态机

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
| `idle` | `'idle'` | 未测试或测试已完成 |
| `testing` | `'testing'` | 测试请求进行中 |
| `success` | `'success'` | 测试成功，含 latency_ms |
| `failure` | `'failure'` | 测试失败，含 error_code + message |

### 表单模式

| 模式 | 值 | 触发 |
|------|-----|------|
| `closed` | `'closed'` | 默认/表单关闭 |
| `creating` | `'creating'` | 点击新增 Provider |
| `editing` | `'editing'` | 点击编辑 Provider |

---

## §O.7 ADR（架构决策）

| ADR-ID | 决策 | 原因 | 备选方案及放弃原因 |
|--------|------|------|-----------------|
| ADR-001 | Electron + TypeScript + React 19 + Zustand + Tailwind CSS | 成熟生态、跨平台、TypeScript 一致性高、社区资源丰富 | Tauri：Rust 生态学习成本高 |
| ADR-002 | main process 通过 IPC handle 封装所有磁盘和网络操作，renderer 通过 preload 暴露的 API 调用 | 安全性原则：renderer 不可直接访问 fs/network | renderer 直接 import fs：contextIsolation=false，安全风险高 |
| ADR-003 | API Key 使用 Electron safeStorage 加密存储到 `~/.talor/api-keys.enc` | OS 级加密，安全性最高 | electron-store 加密：加密密钥明文存储 |
| ADR-004 | Provider 配置以 `provider.id`（UUIDv4）为唯一键，name 为业务展示名，允许重复 | 唯一性由系统分配 ID 保证，用户可自由命名 | name 唯一约束：用户命名体验受限 |
| ADR-005 | 配置文件存放在 `~/.talor/` 目录 | 符合 Unix 惯例，与 `talor/` Python 项目配置隔离 | 工作目录内：平台差异大，用户权限问题多 |

---

## §O.8 Patterns（代码模式索引）

| Pattern 名称 | 使用场景 | 实现位置 |
|-------------|---------|---------|
| IPC Bridge | renderer 通过 preload 暴露的 API 与 main process 通信 | `src/preload/index.ts` → `window.talorAPI` |
| Config Store Singleton | electron-store 单例封装，确保配置读写一致性 + 原子写入 | `src/main/store/config-store.ts` |
| SafeStorage Encryption | API Key 的 OS 级加密/解密封装 | `src/main/services/safe-storage.ts` |
| Provider Tester | 按 provider_type 构造测试请求，返回标准化结果 | `src/main/services/provider-tester.ts` |
| Zustand Config Store | renderer 侧配置状态管理，分离 UI 状态和配置状态 | `src/renderer/store/configStore.ts` |
| Lazy talorAPI Proxy | renderer 模块顶层使用 Proxy 懒加载 talorAPI，防止 preload 时序问题 | `src/renderer/api/talorAPI.ts` |

---

## §O.9 已知陷阱（Gotchas）

| 陷阱 | 正确做法 | 关联文件 |
|------|---------|---------|
| preload 编译为 `.mjs`，main process 引用路径必须一致 | preload 路径写 `index.mjs` | `src/main/index.ts` |
| talorAPI 在模块顶层直接赋值 `window.talorAPI` 会失败（preload 时序） | 使用 Proxy 懒加载 | `src/renderer/api/talorAPI.ts` |
| config.json 写入必须使用 atomic rename（write then rename） | 写 `config.json.tmp`，成功后 rename | `src/main/store/config-store.ts` |
| ollama base_url 不含 `/v1`（原生 API 用 `/api/chat`） | 按 type 构造不同 base_url | `src/main/services/provider-tester.ts` |
| AbortController 取消重复测试请求 | 维护一个 AbortController，测试前取消旧请求 | `src/main/services/provider-tester.ts` |
| setDefault 需两步原子写 | 先全置 false，再目标置 true | `src/main/store/config-store.ts` |

---

## §O.10 配置文件格式

```typescript
// ~/.talor/config.json（明文）
interface AppConfig {
  config_dir: string;
  providers: Record<string, Provider>;
  window_bounds: WindowBounds;
}

interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
  is_maximized: boolean;
}

interface Provider {
  id: string;           // UUIDv4
  type: 'ollama' | 'openai' | 'anthropic' | 'google';
  name: string;          // 业务展示名
  base_url: string;     // 服务端点
  models: string[];     // 可用模型列表
  enabled: boolean;
  is_default: boolean;   // 默认 Provider
  created_at: string;   // ISO 8601
  updated_at: string;    // ISO 8601
  // api_key 不存储在 config.json，通过 safeStorage 单独加密
}

interface ConnectionTestResult {
  status: 'success' | 'failure';
  latency_ms?: number;
  models_count?: number;
  error_code?: string;
  message?: string;
}
```

---

## §O.11 Phase 边界

**Phase 1 已完成**（2026-03-21）：
- 桌面客户端框架搭建
- Provider 配置 CRUD（list/create/update/delete/setDefault）
- 连接测试服务（ollama / openai / anthropic / google）
- API Key safeStorage 加密
- 窗口尺寸/位置持久化

**Phase 2 待规划**：
- Agent 执行引擎
- 会话管理和对话功能
- SSE 流式对话
- 数字员工定义加载（employees/*.jsonc）
