# 手动测试指南：Phases 1-3 功能验证

## 概述

本指南提供详细的手动测试步骤，用于验证桌面客户端优化项目 Phases 1-3 的所有功能。

**测试日期**: 2026-02-05
**测试范围**: Phase 1（全局事件总线）、Phase 2（工作目录限制）、Phase 3（GUI 配置管理）

---

## 准备工作

### 1. 启动后端服务

```bash
cd talor
source venv/bin/activate  # macOS/Linux
# 或 venv\Scripts\activate  # Windows

talor serve
```

**预期结果**:
- ✅ 服务启动在 http://127.0.0.1:8000
- ✅ 控制台显示 "Application startup complete"
- ✅ 无错误信息

### 2. 启动前端开发服务器

```bash
cd talor-gui
npm run dev
```

**预期结果**:
- ✅ 服务启动在 http://localhost:5173
- ✅ 浏览器自动打开或手动访问
- ✅ 页面正常加载

### 3. 检查初始状态

访问 http://localhost:5173

**预期结果**:
- ✅ 应用界面正常显示
- ✅ 侧边栏显示 Sessions 列表
- ✅ 主区域显示欢迎界面或聊天界面

---

## Phase 1: 全局事件总线测试

### 测试 1.1: 单个 Session 事件通信

**目的**: 验证事件通过 GlobalBus 正确发布和接收

**步骤**:
1. 在主界面创建新 session（点击 "New Chat" 或类似按钮）
2. 发送一条消息："Hello, Talor!"
3. 观察消息显示和 Agent 响应

**预期结果**:
- ✅ 消息立即显示在聊天界面
- ✅ Agent 开始思考（显示 thinking 状态）
- ✅ Agent 响应显示在聊天界面
- ✅ 无延迟或错误

**验证点**:
- 事件通过 GlobalBus 发布
- SSE 连接正常接收事件
- 前端正确处理事件并更新 UI

### 测试 1.2: 多个 Session 事件隔离

**目的**: 验证不同 session 的事件不会互相干扰

**步骤**:
1. 创建 Session A，发送消息 "Test A"
2. 创建 Session B，发送消息 "Test B"
3. 切换回 Session A，发送消息 "Test A2"
4. 观察两个 session 的消息历史

**预期结果**:
- ✅ Session A 只显示 "Test A" 和 "Test A2" 的消息
- ✅ Session B 只显示 "Test B" 的消息
- ✅ 两个 session 的事件互不干扰
- ✅ 切换 session 时历史消息正确显示

**验证点**:
- GlobalBus 的 session_id 过滤正确工作
- SSE 端点正确过滤事件
- 前端正确管理多个 session 的状态

### 测试 1.3: SSE 连接稳定性

**目的**: 验证 SSE 连接的稳定性和重连机制

**步骤**:
1. 创建一个 session 并发送消息
2. 打开浏览器开发者工具 -> Network 标签
3. 找到 `/api/events` 的 SSE 连接
4. 观察连接状态

**预期结果**:
- ✅ SSE 连接状态为 "pending" 或 "active"
- ✅ 持续接收事件数据
- ✅ 无频繁断开重连

**可选测试**:
- 暂停后端服务 5 秒，然后重启
- 观察前端是否自动重连

---

## Phase 2: 工作目录限制测试

### 测试 2.1: 配置工作目录

**目的**: 验证工作目录配置功能

**步骤**:
1. 点击设置图标进入 Settings 页面
2. 切换到 "Workspace" 标签
3. 点击 "Add Directory" 按钮
4. 选择一个测试目录（例如：`~/test-workspace`）
5. 确认添加

**预期结果**:
- ✅ 目录成功添加到列表
- ✅ 显示完整路径
- ✅ 可以删除目录

**验证点**:
- 配置 API 正常工作
- 前端正确显示工作目录列表

### 测试 2.2: 工作目录内文件访问

**目的**: 验证 Agent 可以访问工作目录内的文件

**准备**:
1. 在工作目录创建测试文件：
```bash
mkdir -p ~/test-workspace
echo "Hello from workspace" > ~/test-workspace/test.txt
```

**步骤**:
1. 创建新 session
2. 发送消息："Read the file ~/test-workspace/test.txt"
3. 观察 Agent 响应

**预期结果**:
- ✅ Agent 成功读取文件
- ✅ 显示文件内容 "Hello from workspace"
- ✅ 无权限错误

### 测试 2.3: 工作目录外文件访问限制

**目的**: 验证 Agent 无法访问工作目录外的文件

**准备**:
1. 在工作目录外创建测试文件：
```bash
echo "Secret data" > ~/secret.txt
```

**步骤**:
1. 在同一 session 中发送消息："Read the file ~/secret.txt"
2. 观察 Agent 响应

**预期结果**:
- ✅ Agent 报告权限错误
- ✅ 错误消息清晰说明文件在工作目录外
- ✅ 建议用户添加工作目录

**错误消息示例**:
```
Error: Path '/Users/username/secret.txt' is outside configured workspace directories.
Please add this directory to your workspace configuration in Settings.
```

### 测试 2.4: Bash 命令工作目录限制

**目的**: 验证 bash 工具的 cwd 限制

**步骤**:
1. 发送消息："Run 'pwd' command"
2. 观察输出的当前目录

**预期结果**:
- ✅ 当前目录是配置的工作目录之一
- ✅ 不是系统根目录或其他敏感目录

### 测试 2.5: 多工作目录支持

**目的**: 验证支持多个工作目录

**步骤**:
1. 在 Settings -> Workspace 中添加第二个目录
2. 在两个目录中分别创建文件
3. 测试 Agent 可以访问两个目录中的文件

**预期结果**:
- ✅ 可以添加多个工作目录
- ✅ Agent 可以访问所有配置的工作目录
- ✅ 仍然无法访问未配置的目录

### 测试 2.6: 路径遍历攻击防护

**目的**: 验证防止路径遍历攻击

**步骤**:
1. 发送消息："Read the file ~/test-workspace/../secret.txt"
2. 观察 Agent 响应

**预期结果**:
- ✅ Agent 报告权限错误
- ✅ 路径规范化后检测到在工作目录外
- ✅ 攻击被成功阻止

---

## Phase 3: GUI 配置管理测试

### 测试 3.1: General Settings（通用设置）

**目的**: 验证通用设置功能

**步骤**:
1. 进入 Settings -> General 标签
2. 修改以下设置：
   - Default Model: 改为 "openai/gpt-4o"
   - Default Agent: 改为 "plan"
   - Language: 改为 "中文"
   - Theme: 改为 "dark"
3. 点击 "Save Changes"
4. 刷新页面

**预期结果**:
- ✅ 保存成功提示显示
- ✅ 刷新后设置保持不变
- ✅ 主题立即切换到暗色模式（如果实现了）
- ✅ 语言切换到中文（如果实现了）

**验证点**:
- 配置 API 正常工作
- 配置持久化成功
- 前端正确读取和显示配置

### 测试 3.2: Provider Settings（Provider 配置）

**目的**: 验证 LLM Provider 配置功能

#### 3.2.1 添加 Provider

**步骤**:
1. 进入 Settings -> Providers 标签
2. 点击 "Add Provider"
3. 填写表单：
   - Provider ID: "test-provider"
   - Provider Name: "Test Provider"
   - API Key: "sk-test-key-123"
   - Base URL: "https://api.example.com"
4. 点击 "Add"

**预期结果**:
- ✅ Provider 成功添加到列表
- ✅ API Key 显示为已配置（不显示明文）
- ✅ Base URL 正确显示

#### 3.2.2 编辑 Provider

**步骤**:
1. 点击刚添加的 Provider 的 "Edit" 按钮
2. 修改 Provider Name 为 "Updated Provider"
3. 点击 "Update"

**预期结果**:
- ✅ Provider 名称更新成功
- ✅ 其他信息保持不变

#### 3.2.3 测试连接

**步骤**:
1. 点击 Provider 的 "Test" 按钮
2. 观察测试结果

**预期结果**:
- ⚠️ 测试可能失败（因为是测试 API Key）
- ✅ 显示清晰的错误或成功消息
- ✅ UI 响应正常

#### 3.2.4 删除 Provider

**步骤**:
1. 点击 Provider 的 "Delete" 按钮
2. 确认删除

**预期结果**:
- ✅ Provider 从列表中移除
- ✅ 配置文件中也被删除

### 测试 3.3: MCP Settings（MCP 配置）

**目的**: 验证 MCP 服务器配置功能

#### 3.3.1 添加 MCP 服务器

**步骤**:
1. 进入 Settings -> MCP Servers 标签
2. 点击 "Add Server"
3. 填写表单：
   - Server ID: "test-mcp"
   - Server Name: "Test MCP Server"
   - Command: "npx"
   - Args: ["-y", "@test/mcp-server"]
4. 点击 "Add"

**预期结果**:
- ✅ MCP 服务器成功添加
- ✅ 显示在列表中
- ✅ 状态显示为已配置

#### 3.3.2 编辑和删除 MCP 服务器

**步骤**:
1. 编辑服务器名称
2. 删除服务器

**预期结果**:
- ✅ 编辑成功
- ✅ 删除成功

### 测试 3.4: Workspace Settings（工作目录配置）

**已在 Phase 2 测试中覆盖**

### 测试 3.5: API Key 加密存储

**目的**: 验证 API Key 安全存储

**步骤**:
1. 添加一个 Provider 并设置 API Key
2. 检查配置文件：
```bash
cat ~/.talor/config.yaml
```

**预期结果**:
- ✅ 配置文件中不包含明文 API Key
- ✅ 包含 `api_key_ref: "keyring:..."` 引用
- ✅ API Key 存储在系统密钥链中

**验证命令**（macOS）:
```bash
security find-generic-password -s "talor" -a "test-provider_api_key"
```

### 测试 3.6: 配置持久化

**目的**: 验证配置在重启后保持

**步骤**:
1. 配置所有设置（General, Providers, MCP, Workspace）
2. 停止后端服务
3. 重启后端服务
4. 刷新前端页面
5. 检查所有设置

**预期结果**:
- ✅ 所有设置保持不变
- ✅ Providers 列表完整
- ✅ MCP 服务器列表完整
- ✅ 工作目录列表完整
- ✅ General 设置正确

---

## 集成测试场景

### 场景 1: 完整的用户工作流

**目的**: 验证完整的用户体验

**步骤**:
1. 首次启动应用
2. 配置 Provider（添加 OpenAI API Key）
3. 配置工作目录（添加项目目录）
4. 创建新 session
5. 让 Agent 读取项目中的文件
6. 让 Agent 分析代码
7. 切换到另一个 session
8. 验证两个 session 独立工作

**预期结果**:
- ✅ 整个流程顺畅无阻
- ✅ 无错误或异常
- ✅ 性能良好

### 场景 2: 错误处理和恢复

**目的**: 验证错误处理机制

**步骤**:
1. 尝试访问不存在的文件
2. 尝试访问工作目录外的文件
3. 使用无效的 API Key
4. 断开网络连接后重连

**预期结果**:
- ✅ 所有错误都有清晰的错误消息
- ✅ 应用不崩溃
- ✅ 可以从错误中恢复

### 场景 3: 性能测试

**目的**: 验证应用性能

**步骤**:
1. 创建 5 个 session
2. 在每个 session 中发送多条消息
3. 快速切换 session
4. 观察响应时间和内存使用

**预期结果**:
- ✅ 响应时间 < 100ms
- ✅ 无明显卡顿
- ✅ 内存使用合理

---

## 测试检查清单

### Phase 1: 全局事件总线
- [ ] 单个 session 事件通信正常
- [ ] 多个 session 事件隔离正确
- [ ] SSE 连接稳定
- [ ] 事件包含 session_id
- [ ] 前端正确过滤事件

### Phase 2: 工作目录限制
- [ ] 可以配置工作目录
- [ ] 可以访问工作目录内文件
- [ ] 无法访问工作目录外文件
- [ ] Bash 命令 cwd 限制正确
- [ ] 支持多个工作目录
- [ ] 防止路径遍历攻击
- [ ] 错误消息清晰

### Phase 3: GUI 配置管理
- [ ] General Settings 正常工作
- [ ] 可以添加/编辑/删除 Provider
- [ ] API Key 加密存储
- [ ] 可以添加/编辑/删除 MCP 服务器
- [ ] 可以添加/删除工作目录
- [ ] 配置持久化正常
- [ ] 配置在重启后保持

### 集成测试
- [ ] 完整用户工作流顺畅
- [ ] 错误处理正确
- [ ] 性能良好
- [ ] 无内存泄漏

---

## 已知问题记录

在测试过程中发现的问题请记录在此：

### 问题 1: [标题]
- **描述**:
- **重现步骤**:
- **预期行为**:
- **实际行为**:
- **严重程度**: 高/中/低
- **状态**: 待修复/已修复

---

## 测试总结

### 测试统计
- 总测试项: ___
- 通过: ___
- 失败: ___
- 跳过: ___

### 总体评估
- [ ] 所有核心功能正常工作
- [ ] 无严重 bug
- [ ] 性能可接受
- [ ] 用户体验良好

### 建议
1.
2.
3.

---

## 下一步

根据测试结果：

**如果所有测试通过**:
- ✅ Phases 1-3 验证完成
- 可以考虑继续 Phase 4（Electron 打包）
- 或发布当前版本供用户使用

**如果发现问题**:
- 记录所有问题
- 按优先级修复
- 重新测试

---

## 附录：快速测试命令

### 启动服务
```bash
# 后端
cd talor && source venv/bin/activate && talor serve

# 前端
cd talor-gui && npm run dev
```

### 运行自动化测试
```bash
# 后端测试
cd talor && pytest tests/ -v

# 前端测试
cd talor-gui && npm run test:run
```

### 检查配置文件
```bash
# 查看配置
cat ~/.talor/config.yaml

# 查看日志
tail -f ~/.talor/logs/talor.log
```

### 清理测试数据
```bash
# 删除测试 session
rm -rf ~/.talor/sessions/test-*

# 重置配置（谨慎使用）
# mv ~/.talor/config.yaml ~/.talor/config.yaml.backup
```
