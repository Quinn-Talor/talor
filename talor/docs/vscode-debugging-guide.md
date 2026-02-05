# VS Code 调试配置指南

## 概述

本项目已配置完整的 VS Code 调试支持，可以同时调试前后端代码。

## 调试配置

### 1. Backend (FastAPI) - 后端调试

**配置名称**: `Backend (FastAPI)`

**功能**:
- 启动 FastAPI/Uvicorn 开发服务器
- 支持断点调试 Python 代码
- 自动重载（代码修改后自动重启）
- 端口: `http://127.0.0.1:8000`

**使用方法**:
1. 在 VS Code 调试面板选择 "Backend (FastAPI)"
2. 按 F5 或点击绿色播放按钮
3. 在 Python 代码中设置断点
4. 访问 API 端点触发断点

**技术细节**:
- 使用 `debugpy` 调试器
- 运行虚拟环境中的 Python: `talor/venv/bin/python`
- 工作目录: `talor/`
- 启用外部库调试: `justMyCode: false`

### 2. Frontend (Vite) - 前端调试

**配置名称**: `Frontend (Vite)`

**功能**:
- 启动 Vite 开发服务器
- 支持热模块替换 (HMR)
- 端口: `http://localhost:5173`

**使用方法**:
1. 在 VS Code 调试面板选择 "Frontend (Vite)"
2. 按 F5 或点击绿色播放按钮
3. 浏览器自动打开 `http://localhost:5173`

**技术细节**:
- 使用 Node.js 运行 `npm run dev`
- 工作目录: `talor-gui/`
- 自动检测服务器启动并打开浏览器

### 3. Frontend (Chrome) - 浏览器调试

**配置名称**: `Frontend (Chrome)`

**功能**:
- 在 Chrome 中调试前端代码
- 支持断点调试 TypeScript/JavaScript
- 支持 Source Maps

**使用方法**:
1. 确保前端服务器已启动 (运行 Frontend (Vite) 或手动 `npm run dev`)
2. 在 VS Code 调试面板选择 "Frontend (Chrome)"
3. 按 F5 启动 Chrome 调试会话
4. 在 TypeScript/React 代码中设置断点

**技术细节**:
- 使用 Chrome DevTools Protocol
- URL: `http://localhost:5173`
- WebRoot: `talor-gui/src`
- 启用 Source Maps

## 组合配置（推荐）

### 🚀 Full Stack (Backend + Frontend)

**最常用的配置** - 同时启动前后端开发服务器

**使用方法**:
1. 在 VS Code 调试面板选择 "🚀 Full Stack (Backend + Frontend)"
2. 按 F5 启动
3. 等待两个服务器都启动完成
4. 浏览器访问 `http://localhost:5173`

**特点**:
- 同时启动后端 (8000) 和前端 (5173)
- 可以在前后端代码中设置断点
- 停止调试时自动停止所有服务
- 适合全栈开发和调试

### 🌐 Full Stack + Chrome

**完整调试体验** - 前后端 + 浏览器调试

**使用方法**:
1. 在 VS Code 调试面板选择 "🌐 Full Stack + Chrome"
2. 按 F5 启动
3. 自动打开 Chrome 并附加调试器

**特点**:
- 包含所有调试功能
- 可以调试 Python、TypeScript 和浏览器代码
- 适合复杂问题排查

## 快速开始

### 方式 1: 使用调试面板（推荐）

1. 打开 VS Code 调试面板 (Ctrl+Shift+D / Cmd+Shift+D)
2. 从下拉菜单选择 "🚀 Full Stack (Backend + Frontend)"
3. 按 F5 或点击绿色播放按钮
4. 等待服务启动完成
5. 浏览器访问 `http://localhost:5173`

### 方式 2: 使用命令面板

1. 按 Ctrl+Shift+P / Cmd+Shift+P
2. 输入 "Debug: Select and Start Debugging"
3. 选择 "🚀 Full Stack (Backend + Frontend)"

### 方式 3: 使用快捷键

1. 打开 `.vscode/launch.json`
2. 按 F5 启动当前选中的配置

## 调试技巧

### 后端调试

**设置断点**:
```python
# 在任何 Python 文件中点击行号左侧设置断点
async def create_session(title: str = "New Session") -> Session:
    # 断点会在这里暂停
    session = Session(id=str(uuid.uuid4()), title=title)
    return session
```

**查看变量**:
- 鼠标悬停在变量上查看值
- 使用调试控制台 (Debug Console) 执行表达式
- 查看 Variables 面板查看所有局部变量

**调试 API 请求**:
1. 在路由处理函数中设置断点
2. 从前端或 Postman 发送请求
3. 断点触发，检查请求数据

### 前端调试

**设置断点**:
```typescript
// 在 TypeScript/React 文件中设置断点
const handleSubmit = async () => {
  // 断点会在这里暂停
  const response = await fetch('/api/sessions');
  const data = await response.json();
};
```

**React 组件调试**:
- 在组件渲染逻辑中设置断点
- 检查 props 和 state
- 追踪组件生命周期

**浏览器调试**:
- 使用 Chrome DevTools (F12)
- 查看 Network 面板检查 API 请求
- 使用 React DevTools 检查组件树

## 常见问题

### 1. 后端启动失败

**问题**: `ModuleNotFoundError` 或 `ImportError`

**解决方案**:
```bash
cd talor
source venv/bin/activate  # macOS/Linux
pip install -e ".[dev]"
```

### 2. 前端启动失败

**问题**: `Cannot find module` 或依赖错误

**解决方案**:
```bash
cd talor-gui
npm install
```

### 3. 端口被占用

**问题**: `Address already in use: 8000` 或 `5173`

**解决方案**:
```bash
# 查找占用端口的进程
lsof -i :8000  # 后端
lsof -i :5173  # 前端

# 杀死进程
kill -9 <PID>
```

### 4. 断点不生效

**后端断点**:
- 确保使用虚拟环境中的 Python
- 检查 `justMyCode` 设置为 `false`
- 重启调试会话

**前端断点**:
- 确保 Source Maps 已启用
- 检查文件路径是否正确
- 清除浏览器缓存并刷新

### 5. Chrome 调试器无法连接

**解决方案**:
1. 确保前端服务器已启动
2. 手动访问 `http://localhost:5173` 确认可访问
3. 关闭其他 Chrome 调试会话
4. 重启 VS Code

## 性能优化

### 减少重启次数

**后端**:
- Uvicorn 已启用 `--reload`，代码修改自动重启
- 避免修改配置文件（需要手动重启）

**前端**:
- Vite HMR 自动更新，无需刷新浏览器
- 修改 CSS/组件立即生效

### 调试性能问题

**后端**:
```python
import time
start = time.time()
# 你的代码
print(f"Execution time: {time.time() - start:.2f}s")
```

**前端**:
```typescript
console.time('operation');
// 你的代码
console.timeEnd('operation');
```

## 相关文件

- `.vscode/launch.json` - 调试配置文件
- `talor/src/api/app.py` - 后端入口
- `talor-gui/src/main.tsx` - 前端入口
- `talor-gui/vite.config.ts` - Vite 配置

## 下一步

- 阅读 [手动测试指南](./manual-testing-guide.md)
- 查看 [项目结构文档](../../.kiro/steering/structure.md)
- 了解 [技术栈](../../.kiro/steering/tech.md)

---

**提示**: 使用 "🚀 Full Stack (Backend + Frontend)" 配置是最简单的开始方式！
