# talor-desktop 工具调用实施计划

> 本文档描述本次迭代的工程实施计划。依赖需求文档 `requirements.md` 和设计文档 `feature.md`。
> 文档 ID：`IMPL-talor-desktop-tool-calling`

---

<!--
doc-id: IMPL-talor-desktop-tool-calling
status: in-progress
version: 1.0
last-updated: 2026-03-23
depends-on: [FD-talor-desktop-tool-calling]
-->

---

## 4.0 实施仪表盘

### 总体进度表

| 指标 | 当前值 | 目标值 | 状态 |
|------|--------|--------|------|
| IMPL 完成率 | 3/15 | 100% | 🟡 进行中 |
| AC 验证率 | 0/32 | 100% | 🔴 未开始 |
| Phase 1 进度 | 完成 | 完成 | 🟢 |
| Phase 2 进度 | 未开始 | 完成 | ⚪ |
| Phase 3 进度 | 未开始 | 完成 | ⚪ |
| 阻塞项 | 0 | 0 | 🟢 |
| DEFERRED 项 | 0 | - | - |

### AC 验证明细表

| AC ID | 描述 | 验证方式 | 状态 | 日期 |
|-------|------|---------|------|------|
| AC-000-01 | 会话未设置工作目录时工具不可用 | Playwright E2E | ⬜ | - |
| AC-000-02 | 会话工作目录设置功能正常 | Playwright E2E | ⬜ | - |
| AC-000-03 | 会话切换后工作目录保持独立 | Playwright E2E | ⬜ | - |
| AC-000-04 | 工具无法访问工作目录外路径 | Playwright E2E | ⬜ | - |
| AC-001-01 | 读取文件成功 | Playwright E2E | ⬜ | - |
| AC-001-02 | 文件不存在返回错误 | Playwright E2E | ⬜ | - |
| AC-001-03 | 二进制文件返回错误 | Playwright E2E | ⬜ | - |
| AC-001-04 | 敏感路径返回错误 | Playwright E2E | ⬜ | - |
| AC-001-05 | 文件大小超限返回错误 | Playwright E2E | ⬜ | - |
| AC-001-03 | 二进制文件返回错误 | Layer 2 E2E | ⬜ | - |
| AC-001-04 | 敏感路径返回错误 | Layer 2 E2E | ⬜ | - |
| AC-002-01 | glob 搜索成功 | Layer 2 E2E | ⬜ | - |
| AC-002-02 | 空搜索模式返回错误 | Layer 2 E2E | ⬜ | - |
| AC-002-03 | 无匹配文件返回空 | Layer 2 E2E | ⬜ | - |
| AC-002-04 | grep 搜索成功 | Layer 2 E2E | ⬜ | - |
| AC-003-01 | 多轮工具调用 | Layer 2 E2E | ⬜ | - |
| AC-003-02 | 工具失败后继续 | Layer 2 E2E | ⬜ | - |
| AC-003-03 | 循环上限处理 | Layer 2 E2E | ⬜ | - |
| AC-004-01 | 工具调用指示器显示 | Layer 2 E2E | ⬜ | - |
| AC-004-02 | 展开详情功能 | Layer 2 E2E | ⬜ | - |
| AC-004-03 | 完成后指示器消失 | Layer 2 E2E | ⬜ | - |
| AC-004-04 | 超时处理 | Layer 2 E2E | ⬜ | - |
| AC-005-01 | 创建文件成功 | Layer 2 E2E | ⬜ | - |
| AC-005-02 | 文件存在询问覆盖 | Layer 2 E2E | ⬜ | - |
| AC-005-03 | 父目录不存在返回错误 | Layer 2 E2E | ⬜ | - |
| AC-005-04 | edit 工具成功 | Playwright E2E | ⬜ | - |
| AC-005-05 | 写入文件大小超限返回错误 | Playwright E2E | ⬜ | - |
| AC-006-01 | bash 工具执行成功 | Playwright E2E | ⬜ | - |
| AC-006-02 | bash 命令超时返回错误 | Playwright E2E | ⬜ | - |
| AC-006-03 | bash 命令失败返回错误 | Playwright E2E | ⬜ | - |
| AC-006-04 | bash 访问工作目录外被拒绝 | Playwright E2E | ⬜ | - |
| AC-006-05 | 危险命令被拒绝执行 | Playwright E2E | ⬜ | - |
| AC-007-01 | 并行工具调用成功 | Playwright E2E | ⬜ | - |
| AC-007-02 | 并行工具部分失败 | Playwright E2E | ⬜ | - |
| AC-007-03 | 并行工具全部失败 | Playwright E2E | ⬜ | - |
| AC-007-04 | 并行工具数量超限 | Playwright E2E | ⬜ | - |

---

## 4.1 Phase 索引

| Phase | 目录 | 状态 | IMPL 完成率 | 描述 |
|-------|------|------|-------------|------|
| Phase 1 | `phases/phase-1/` | 🟢 完成 | 3/3 | 工具基础设施（types + registry + executor基础） |
| Phase 2 | `phases/phase-2/` | ⚪ 未开始 | 0/3 | 工作目录 + read/glob + 基础 UI |
| Phase 3 | `phases/phase-3/` | ⚪ 未开始 | 0/3 | write + ls + grep + UI增强 |
| Phase 4 | `phases/phase-4/` | ⚪ 未开始 | 0/3 | bash + edit + 错误处理 |
| Phase 5 | `phases/phase-5/` | ⚪ 未开始 | 0/1 | MCP 预留 |

各 Phase 的 IMPL 任务详情、AC 验证映射、Checkpoint 见对应 `phases/phase-N/IMPL.md`。

---

## 4.2 实施规划

### 复杂度快照

- **① IMPL 任务数**：~15 个任务（4 分）
- **② 涉及模块**：tools/, session-repo, ipc/chat, renderer（3 分）
- **③ 状态机变更**：无（0 分）
- **④ 涟漪影响**：数据库迁移 + 多模块同步（2 分）
- **⑤ 并发/幂等**：工作目录设置（1 分）
- **⑥ 外部依赖**：无（0 分）
- **总分**：10 分 → **推荐 3 Phases**

### 关键路径（Critical Path）

1. 工具注册表 → ReAct 执行器 → chat.ts 集成 → UI 集成
2. read 工具 → 基础 UI 显示
3. glob 工具 → 基础 UI 显示

### 阶段计划

#### Phase 1：核心工具调用能力

- **目录**：`phases/phase-1/`
- **IMPL 任务**：
  1. 工具类型定义（types.ts）
  2. 工具注册表（registry.ts）
  3. ReAct 执行器（executor.ts）
  4. read 工具实现
  5. glob 工具实现
- **AC 覆盖**：AC-001-01~04, AC-002-01~04, AC-003-01, AC-004-01~03
- **退出标准**：用户发送"读取 src/main/index.ts" → AI 自动调用 read 工具 → 用户看到文件内容（带工具调用指示器）

#### Phase 2：完整工具集 + 错误处理

- **目录**：`phases/phase-2/`
- **IMPL 任务**：
  1. write 工具实现
  2. edit 工具实现
  3. grep 工具实现
  4. ls 工具实现
  5. 错误处理完善
  6. MCP 兼容接口预留
- **AC 覆盖**：AC-003-02~03, AC-004-04, AC-005-01~04
- **退出标准**：用户发送复杂多步骤任务 → AI 执行多个工具 → 用户看到最终结果

### 进入/退出条件

**Phase 1 进入条件**：
- requirements.md 已 approved
- feature.md 已 approved
- 项目环境可运行（npm run dev 正常）

**Phase 1 退出条件**：
- IMPL 任务全部完成
- Layer 1 单元测试通过
- Layer 2 E2E 测试通过（read + glob 工具）
- 用户可完成"读取文件"和"搜索文件"端到端流程

**Phase 2 进入条件**：
- Phase 1 已完成并签收

**Phase 2 退出条件**：
- IMPL 任务全部完成
- Layer 1 单元测试通过
- Layer 2 E2E 测试通过（所有工具）
- 用户可完成"创建/编辑文件"端到端流程

### Shippable Increment

| Phase | 增量描述 | 用户可感知能力 |
|-------|---------|---------------|
| Phase 1 | 工具调用基础框架 + read + glob | 用户可以让 AI 读取文件和搜索文件 |
| Phase 2 | 完整工具集 + 错误处理 | 用户可以让 AI 执行完整的文件操作任务 |

---

## 4.3 已知陷阱列表（Gotchas）

| ⚠️ 陷阱描述 | 正确做法 | 关联文档 |
|-----------|---------|---------|
| 模型不支持 tool calling 时需回退 | 在 chat.ts 中检测模型能力，不支持时走纯文本路径 | feature.md §F.4 |
| 工具执行超时需正确处理 | 设置 30s 超时，超时后返回错误给 LLM | requirements.md §1.7 |
| 文件路径安全验证 | 所有工具必须验证路径在工作目录范围内，禁止访问系统敏感路径 | requirements.md §1.7 |
| MCP 扩展预留 | 工具注册表接口设计需支持未来 MCP 工具接入 | feature.md §F.2 |

---

## 4.4 功能验收标准

### AC 验证方式

| 验证层 | 工具 | 执行命令 |
|-------|------|---------|
| Layer 1 | vitest | `cd talor-desktop && npx vitest run` |
| Layer 2 | Playwright E2E | `cd talor-desktop && node tests/e2e/layer2-tool-calling.js` |

### AC 状态追踪

见 §4.0 仪表盘 AC 验证明细表。

### 回滚验证步骤

1. 回滚代码改动
2. 运行 Layer 1 测试确保无回归
3. 确认原有聊天功能正常

### Playwright E2E 测试框架

**测试文件结构**：
```
tests/e2e/
├── layer2-tool-calling.js    # 主入口，执行所有 AC
├── pages/
│   └── ChatPage.ts            # Chat 页面 POM
├── fixtures/
│   └── test-workspace/        # 测试用工作目录
└── utils/
    └── run-playwright.ts     # Playwright 运行工具
```

**测试执行前提**：
1. Electron 应用已启动（`npm run dev`）
2. 已配置 CDP 连接（默认 `http://localhost:9222`）
3. 已创建测试工作目录 `tests/e2e/fixtures/test-workspace/`

**验证流程**：
1. 选择工作目录 → 验证目录被保存
2. 发送需要工具的消息 → 验证工具被调用
3. 验证工具返回结果在响应中
4. 验证 UI 指示器显示正确

---

## 4.5 发布清单

| 类别 | 变更项 | 验证方式 |
|------|--------|---------|
| 配置 | 无 | - |
| 数据库 | 无 | - |
| 实验 | 无 | - |
| 中间件 | 无 | - |
| 监控 | 无 | - |
| 回滚 | 依赖 git revert | 验证聊天功能正常 |

**迭代归档**：Phase 完成后调用 klook-vibe-overview 完成 L3→L1 合并。

---

## 4.6 范围外功能列表

| 功能 | 原因 | 延期至 |
|------|------|-------|
| bash/shell 工具 | 安全考虑，v1 排除 | 未来版本 |
| MCP 客户端 | 设计兼容，实际实现 v2 | v2 |
| 自定义工具注册 | UI 开发量较大 | 未来版本 |

详见 `runtime/DEFERRED.md`。

---

## 4.7 统一变更日志

| 日期 | 变更 | 文档版本 |
|------|------|---------|
| 2026-03-23 | Phase 1 完成（IMPL-001~003），工具基础设施（types + registry + executor），50 个测试通过 | v1.1 |