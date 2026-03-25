# Phase 7 会话启动检查

> 本文件是 Phase 7 会话启动前的检查清单。
> **每次开始新会话前必须完成 Step 1~6**。

---

## Step 1：加载上下文

- [ ] 读 `../../implementation.md` §4.0（实施仪表盘）
- [ ] 读 `phases/phase-7/impl.md` §P.0 + §P.1（当前进度 + IMPL 任务）
- [ ] 读 `../../requirements.md` §1.8（AC 验收标准）
- [ ] 读 `../../feature.md` §F.2（全局影响）
- [ ] 读 `phases/phase-6/impl.md`（确认 Phase 6 已完成）

**会话目标**：完成 Phase 7 MCP 工具集成

---

## Step 2：检查阻塞项

- [ ] Phase 6 已完成

---

## Step 3：确定任务

### 本次会话任务

从 IMPL-008 开始，按顺序：

1. **IMPL-008**：MCP Client 核心（STDIO + HTTP 传输）
2. **IMPL-009**：MCP 工具发现与注册
3. **IMPL-010**：工具调用集成到 toolRegistry
4. **IMPL-011**：工具列表展示

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
- [ ] 已配置 MCP Server（Phase 6）
- [ ] 准备测试 MCP Server：
  - STDIO: `npx -y @modelcontextprotocol/server-filesystem /tmp`
  - 或 HTTP: 可用的 MCP Server URL

---

## Step 6：开始编码

完成以上检查后，开始 IMPL-008 实施。
