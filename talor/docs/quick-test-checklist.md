# 快速测试检查清单

## 🚀 快速开始（5 分钟）

### 1. 启动服务 ✅

**后端**:
```bash
cd talor
source venv/bin/activate
talor serve
```
等待看到: `Application startup complete`

**前端**:
```bash
cd talor-gui
npm run dev
```
访问: http://localhost:5173

---

## ⚡ 核心功能快速测试（15 分钟）

### ✅ 测试 1: 基本聊天功能（2 分钟）
1. [ ] 创建新 session
2. [ ] 发送消息 "Hello"
3. [ ] 收到 Agent 响应
4. [ ] 消息显示正常

**通过标准**: 聊天功能正常，无错误

---

### ✅ 测试 2: 多 Session 隔离（3 分钟）
1. [ ] 创建 Session A，发送 "Test A"
2. [ ] 创建 Session B，发送 "Test B"
3. [ ] 切换回 Session A
4. [ ] 验证只看到 "Test A" 的消息

**通过标准**: 两个 session 消息互不干扰

---

### ✅ 测试 3: 工作目录配置（3 分钟）
1. [ ] 进入 Settings -> Workspace
2. [ ] 添加目录: `~/test-workspace`
3. [ ] 创建测试文件:
```bash
mkdir -p ~/test-workspace
echo "Test content" > ~/test-workspace/test.txt
```
4. [ ] 在聊天中: "Read ~/test-workspace/test.txt"
5. [ ] 验证文件内容显示

**通过标准**: 可以读取工作目录内文件

---

### ✅ 测试 4: 工作目录限制（2 分钟）
1. [ ] 创建工作目录外文件:
```bash
echo "Secret" > ~/secret.txt
```
2. [ ] 在聊天中: "Read ~/secret.txt"
3. [ ] 验证收到权限错误

**通过标准**: 无法访问工作目录外文件

---

### ✅ 测试 5: Provider 配置（3 分钟）
1. [ ] 进入 Settings -> Providers
2. [ ] 点击 "Add Provider"
3. [ ] 填写:
   - ID: test-provider
   - Name: Test Provider
   - API Key: test-key-123
4. [ ] 保存并验证显示在列表中
5. [ ] 删除 Provider

**通过标准**: Provider CRUD 功能正常

---

### ✅ 测试 6: 配置持久化（2 分钟）
1. [ ] 在 Settings -> General 中修改:
   - Default Agent: plan
   - Theme: dark
2. [ ] 点击 "Save Changes"
3. [ ] 刷新页面
4. [ ] 验证设置保持不变

**通过标准**: 配置在刷新后保持

---

## 🎯 关键验证点

### Phase 1: 全局事件总线
- [x] 事件通信正常
- [x] Session 隔离正确
- [x] SSE 连接稳定

### Phase 2: 工作目录限制
- [x] 可以访问工作目录内文件
- [x] 无法访问工作目录外文件
- [x] 错误消息清晰

### Phase 3: GUI 配置管理
- [x] 所有设置页面可访问
- [x] 配置可以保存
- [x] 配置持久化正常

---

## 📊 测试结果

**日期**: ___________
**测试人**: ___________

### 结果统计
- 通过: ___ / 6
- 失败: ___
- 跳过: ___

### 发现的问题
1.
2.
3.

### 总体评估
- [ ] ✅ 所有核心功能正常
- [ ] ⚠️ 有小问题但可用
- [ ] ❌ 有严重问题需修复

---

## 🔧 故障排除

### 后端无法启动
```bash
# 检查端口占用
lsof -i :8000

# 查看日志
tail -f ~/.talor/logs/talor.log
```

### 前端无法连接后端
1. 确认后端运行在 http://127.0.0.1:8000
2. 检查浏览器控制台错误
3. 检查 CORS 设置

### 配置不生效
```bash
# 检查配置文件
cat ~/.talor/config.yaml

# 重启后端服务
```

---

## 📝 详细测试

需要更详细的测试？请参考:
- `manual-testing-guide.md` - 完整测试指南
- `phases-1-3-completion-summary.md` - 功能总结

---

## ✅ 完成

测试完成后：
1. [ ] 填写测试结果
2. [ ] 记录发现的问题
3. [ ] 决定下一步行动
