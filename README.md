# Talor - AI 编程助手

Talor 是一个 AI 驱动的编程助手，提供智能代码补全、对话式编程和工具集成。

## 🚀 快速开始

### 前提条件

- Python 3.11+
- Node.js 18+
- npm 或 yarn

### 安装

#### 后端

```bash
cd talor
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -e ".[dev]"
```

#### 前端

```bash
cd talor-gui
npm install
```

### 运行

#### 启动后端

```bash
cd talor
source venv/bin/activate
talor serve
```

后端将在 http://127.0.0.1:8000 运行

#### 启动前端

```bash
cd talor-gui
npm run dev
```

前端将在 http://localhost:5173 运行

### 访问应用

在浏览器中打开: http://localhost:5173

## 🔧 开发

### VS Code 调试

本项目提供了完整的 VS Code 调试配置：

#### 后端调试 (🔴)
- **🔴 Backend: Start Server** - 启动后端服务器
- **🔴 Backend: Debug Current File** - 调试当前 Python 文件
- **🔴 Backend: Test Current File** - 调试当前测试文件

#### 前端调试 (🔵)
- **🔵 Frontend: Chrome** - 在 Chrome 中调试前端
- **🔵 Frontend: Edge** - 在 Edge 中调试前端
- **🔵 Frontend: Diagnostic Page** - 打开诊断页面

#### 全栈调试 (🟢)
- **🟢 Full Stack: Chrome** - 同时调试前后端（Chrome）
- **🟢 Full Stack: Edge** - 同时调试前后端（Edge）

**使用方法**:
1. 按 `F5` 或点击调试面板
2. 选择一个配置
3. 开始调试

详细说明请查看: [.vscode/DEBUG_CONFIGURATIONS.md](.vscode/DEBUG_CONFIGURATIONS.md)

### 运行测试

#### 后端测试

```bash
cd talor
source venv/bin/activate
pytest tests/ -v
```

#### 前端测试

```bash
cd talor-gui
npm test
```

#### 集成测试

```bash
bash test_integration.sh
```

### 代码格式化

#### 后端

```bash
cd talor
source venv/bin/activate
black src/ tests/
```

#### 前端

```bash
cd talor-gui
npm run format
```

### 代码检查

#### 后端

```bash
cd talor
source venv/bin/activate
ruff check src/ tests/
mypy src/
```

#### 前端

```bash
cd talor-gui
npm run lint
```

## 📚 文档

- [项目文档](PROJECT_DOCUMENTATION.md) - 完整的项目架构和 API 文档
- [快速开始指南](QUICK_START.md) - 快速启动和故障排查
- [调试配置说明](.vscode/DEBUG_CONFIGURATIONS.md) - VS Code 调试配置详解
- [API 测试](.vscode/api-tests.http) - REST Client API 测试文件

## 🛠️ 技术栈

### 后端
- **FastAPI** - 现代 Web 框架
- **Python 3.11+** - 编程语言
- **SQLite** - 数据库
- **LiteLLM** - 多 LLM 提供商支持
- **FastMCP** - Model Context Protocol 集成

### 前端
- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **Zustand** - 状态管理
- **React Router** - 路由

## 📁 项目结构

```
talor/
├── talor/                  # 后端项目
│   ├── src/               # 源代码
│   │   ├── api/          # FastAPI 应用
│   │   ├── agent/        # Agent 系统
│   │   ├── bus/          # 事件总线
│   │   ├── cli/          # CLI 命令
│   │   ├── config/       # 配置管理
│   │   ├── core/         # 核心功能
│   │   ├── mcp/          # MCP 集成
│   │   ├── provider/     # LLM 提供商
│   │   ├── session/      # 会话管理
│   │   └── tool/         # 工具系统
│   ├── tests/            # 测试
│   └── pyproject.toml    # Python 项目配置
│
├── talor-gui/             # 前端项目
│   ├── src/              # 源代码
│   │   ├── api/         # API 客户端
│   │   ├── components/  # React 组件
│   │   ├── hooks/       # React Hooks
│   │   ├── pages/       # 页面组件
│   │   ├── router/      # 路由配置
│   │   ├── store/       # 状态管理
│   │   └── types/       # TypeScript 类型
│   ├── public/          # 静态资源
│   └── package.json     # Node.js 项目配置
│
└── .vscode/              # VS Code 配置
    ├── launch.json       # 调试配置
    ├── tasks.json        # 任务配置
    └── settings.json     # 编辑器设置
```

## 🔍 诊断工具

如果遇到问题，可以使用以下诊断工具：

### 检查服务状态

```bash
bash check_frontend.sh
```

### 运行集成测试

```bash
bash test_integration.sh
```

### 访问诊断页面

在浏览器中打开: http://localhost:5173/diagnostic.html

## 🐛 故障排查

### 后端无法启动

1. 检查虚拟环境: `which python`
2. 重新安装依赖: `pip install -e ".[dev]"`
3. 检查端口占用: `lsof -i :8000`
4. 查看日志: `tail -f talor/server.log`

### 前端无法启动

1. 检查 Node.js 版本: `node --version`
2. 重新安装依赖: `rm -rf node_modules && npm install`
3. 检查端口占用: `lsof -i :5173`
4. 清除缓存: `rm -rf .vite`

### 页面打不开

1. 清除浏览器缓存 (Cmd+Shift+R / Ctrl+Shift+R)
2. 检查浏览器控制台错误 (F12)
3. 访问诊断页面: http://localhost:5173/diagnostic.html
4. 查看 [QUICK_START.md](QUICK_START.md)

## 🤝 贡献

欢迎贡献！请查看贡献指南。

## 📄 许可证

MIT License

## 🔗 相关链接

- [FastAPI 文档](https://fastapi.tiangolo.com/)
- [React 文档](https://react.dev/)
- [Vite 文档](https://vitejs.dev/)
- [LiteLLM 文档](https://docs.litellm.ai/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## 💬 支持

如有问题，请：
1. 查看文档
2. 运行诊断工具
3. 检查 GitHub Issues
4. 提交新 Issue

---

**提示**: 使用 VS Code 的调试配置可以大大提高开发效率！按 `F5` 开始调试。
