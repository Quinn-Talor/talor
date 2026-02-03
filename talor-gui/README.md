# Talor GUI

Talor 的 Web 前端界面，基于 React 19 + TypeScript + Vite 构建。

## 功能

- 会话管理（创建、切换、删除）
- 实时聊天界面
- Markdown 渲染（代码高亮）
- 工具调用可视化
- 多语言支持（中/英）
- 深色/浅色主题

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 开发命令

```bash
# 测试
npm run test:run          # 单次运行
npm run test:coverage     # 带覆盖率

# 代码质量
npm run format            # Prettier 格式化
npm run lint:fix          # ESLint 修复
```

## 技术栈

- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Zustand** - 状态管理
- **TailwindCSS v4** - 样式
- **i18next** - 国际化
- **react-markdown + shiki** - Markdown 渲染
- **Vitest + fast-check** - 测试

## 项目结构

```
src/
├── api/          # API 客户端（REST + SSE）
├── components/   # React 组件
│   ├── chat/     # 聊天 UI
│   ├── common/   # 共享组件
│   ├── session/  # 会话管理
│   └── settings/ # 设置界面
├── hooks/        # 自定义 Hooks
├── i18n/         # 国际化资源
├── pages/        # 页面组件
├── store/        # Zustand 状态
├── types/        # TypeScript 类型
└── utils/        # 工具函数
```

## 配置

开发服务器通过 Vite 代理将 API 请求转发到后端：

- `/api/*` → `http://127.0.0.1:8000`
- `/event` → `http://127.0.0.1:8000`（SSE）
- `/ws` → `ws://127.0.0.1:8000`（WebSocket）

确保后端服务运行在 8000 端口。
