# Talor Desktop Client

Talor 的桌面客户端，基于 React 19 + TypeScript + Vite 构建。

## 定位

**桌面应用** - 本地运行的 AI Agent 助手客户端

- 当前：Web 技术栈（开发模式）
- 计划：打包为原生桌面应用（Electron/Tauri）

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

# 启动开发服务器（开发模式）
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

## 开发命令

```bash
# 测试
npm run test              # 监听模式
npm run test:run          # 单次运行
npm run test:coverage     # 带覆盖率

# 代码质量
npm run format            # Prettier 格式化
npm run format:check      # 检查格式
npm run lint              # ESLint 检查
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

### 开发模式

开发服务器通过 Vite 代理将 API 请求转发到后端：

- `/api/*` → `http://127.0.0.1:8000`
- `/event` → `http://127.0.0.1:8000`（SSE）
- `/ws` → `ws://127.0.0.1:8000`（WebSocket）

确保后端服务运行在 8000 端口。

### 桌面打包（计划）

未来将支持打包为原生桌面应用：

- **Electron** - 跨平台桌面应用
- **Tauri** - 轻量级原生应用

## 路线图

- [ ] 原生桌面打包（Electron/Tauri）
- [ ] 系统托盘集成
- [ ] 全局快捷键
- [ ] 自动更新
- [ ] 离线模式优化
- [ ] 性能优化（虚拟滚动等）
