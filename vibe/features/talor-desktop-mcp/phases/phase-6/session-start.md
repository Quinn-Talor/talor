# Phase 6 会话启动检查

> 本文件是 Phase 6 会话启动前的检查清单。
> **每次开始新会话前必须完成 Step 1~6**。

---

## Step 1：加载上下文

- [ ] 读 `../../implementation.md` §4.0（实施仪表盘）
- [ ] 读 `phases/phase-6/impl.md` §P.0 + §P.1（当前进度 + IMPL 任务）
- [ ] 读 `../../requirements.md` §1.8（AC 验收标准）
- [ ] 读 `../../feature.md` §F.2（全局影响）

**会话目标**：完成 Phase 6 MCP Server 配置管理

---

## Step 2：检查阻塞项

- [ ] 无阻塞项

---

## Step 3：确定任务

### 本次会话任务

从 IMPL-001 开始，按顺序：

1. **IMPL-001**：数据库 mcp_servers 表
2. **IMPL-002**：MCP 配置 IPC 接口（CRUD）
3. **IMPL-003**：MCP 配置存储

---

## Step 4：术语一致性检查

> 引用 `../../requirements.md §1.3 术语表`

| 术语 | 代码命名 | 确认 |
|------|----------|------|
| MCP Server | `MCPServer` | ⬜ |
| STDIO 传输 | `StdioTransport` | ⬜ |
| HTTP 传输 | `HttpTransport` | ⬜ |
| 工具发现 | `discoverTools` | ⬜ |
| 工具注册 | `registerExternalProvider` | ⬜ |
| 连接状态 | `connectionStatus` | ⬜ |

---

## Step 5：验证环境准备

### 项目信息

- **项目路径**：`/Users/quinn.li/Desktop/talor/talor-desktop`
- **启动命令**：`npm run dev`
- **测试命令**：`npm test -- --run`

### Layer 1 验证

- [ ] TypeScript 类型检查：`npx tsc --noEmit`
- [ ] 单元测试：`npm test -- --run`

### Layer 2 验证

- [ ] 应用启动：`npm run dev`
- [ ] 打开设置页面
- [ ] 准备测试数据：npx 可用

---

## Step 6：开始编码

完成以上检查后，开始 IMPL-001 实施。
