# Talor GUI（React 19 + Vite + Zustand）

## 常用命令

```bash
npm run dev            # 启动 Vite 开发服务器（http://127.0.0.1:5173）
npm run build          # 生产构建（tsc + vite build）
npm run test           # Vitest 监听模式
npm run test:run       # Vitest 单次运行
npm run test:coverage  # 覆盖率报告
npm run lint           # ESLint 检查
npm run lint:fix       # ESLint 自动修复
npm run format         # Prettier 格式化
```

---

## TDD 规范

**写失败测试 → 最小实现 → 重构 → 重复**

- 测试文件与组件**同目录**，命名 `*.test.tsx` / `*.test.ts`
- 使用 `vitest` + `@testing-library/react` + `@testing-library/user-event`
- Store / Utils 优先单元测试；组件用 render + userEvent 集成测试
- 运行单个：`npm run test -- src/store/session.test.ts`
- 断言使用 `@testing-library/jest-dom` 提供的匹配器

---

## 目录结构

```
src/
  api/              # API 客户端（按功能拆分）
    agent.ts        # Agent API（processPromptAsync、列表等）
    session.ts      # 会话 API
    events.ts       # SSE 事件客户端
    provider.ts     # Provider/Model API
    client.ts       # 基础 HTTP 客户端
  components/
    chat/           # 聊天核心（ChatView、MessageList、MessageInput）
    session/        # 会话侧边栏（SessionList、SessionItem）
    settings/       # 设置页组件
    tools/          # 工具调用展示
    layout/         # 布局（Sidebar、MainArea）
    common/         # 通用组件
  pages/            # 页面（HomePage、SettingsPage）
  store/            # Zustand 状态（session.ts、…）
  hooks/            # 自定义 Hooks（useEvents、…）
  router/           # React Router 配置
  i18n/             # 国际化（zh、en）
  types/            # TypeScript 类型定义
  utils/            # 工具函数
  test/             # 测试工具库（setup、fixtures）
```

---

## 代码参考（新代码对照这些写，不要引入新模式）

| 场景 | 参考文件 |
|------|----------|
| 核心聊天 UI | `src/components/chat/ChatView.tsx` |
| 会话状态管理 | `src/store/session.ts` |
| API 客户端 | `src/api/agent.ts` |
| SSE 事件处理 | `src/hooks/useEvents.ts` |
| 组件测试示例 | `src/pages/HomePage.test.tsx` |
| API 单元测试 | `src/api/agent.test.ts` |

---

## 前端 ↔ 后端通信

```
代理配置：vite.config.ts → /api/* 代理到 http://localhost:8000

消息发送流程：
  1. POST /api/session/prompt/async  →  { status: processing, message_id }
  2. GET  /event?session_id=...      →  SSE 实时接收事件

SSE 事件类型：
  session.created    # 新会话创建
  message.created    # 消息创建（user / assistant）
  stream.text        # 流式文本 delta
  message.updated    # 消息内容完整更新
  agent.started      # Agent 开始执行
  agent.completed    # Agent 完成（含 iterations、reason）
  stream.done        # 本次响应结束
  session.updated    # 会话元信息更新
```

---

## 状态管理约定

- 所有全局状态用 **Zustand**（`src/store/`）
- 组件本地 UI 状态用 `useState`
- SSE 连接生命周期由 `useEvents` hook 管理
- 消息发送后立即乐观更新（optimistic update），SSE 事件去重（见 `session.ts` 中的 `alreadyExists` 检查）
