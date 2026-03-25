# talor-desktop 工具调用实施文档

> AI 实施者执行参考。**每次会话开始前必须读 §4.0 实施仪表盘**，从 `phases/phase-N/impl.md §P.0 + §P.2` 获取阶段进度，结束时更新。
> 产品需求见 `requirements.md`。项目现状见 `overview.md`。功能设计见 `feature.md`。
> 各阶段 IMPL 任务、AC 验证映射、会话 Checkpoint 见 `phases/phase-N/impl.md`。

---

<!--
doc-id: IMPL-talor-desktop-tool-calling
status: in-progress
version: 2.0
last-updated: 2026-03-24
depends-on: [FD-talor-desktop-tool-calling]
-->

---

## 4.0 实施仪表盘

### 总体进度

| 指标 | 当前值 | 说明 |
|------|--------|------|
| IMPL 完成率 | 18/18 (100%) | IMPL-001~018 全部完成 |
| AC 验证率 | 38/41 (93%) | Phase 1-4 AC 已验证 |
| Phase 进度 | Phase 5 已签收 | Phase 6 待开始 |
| 阻塞项 | 0 | 无 |
| DEFERRED 项 | 0 pending | 见 deferred.md |

### 需求实施状态（US 维度）

| US ID | 用户故事 | 关联 IMPL | AC 通过率 | 状态 |
|-------|---------|----------|----------|------|
| US-000 | 会话工作目录 | IMPL-004~006 | 3/3 ✅ | ✅ 完成 |
| US-001 | 用户请求 AI 读取文件 | IMPL-007 | 5/5 ✅ | ✅ 完成 |
| US-002 | 用户请求 AI 搜索文件 | IMPL-008, IMPL-013, IMPL-014 | 4/4 ✅ | ✅ 完成 |
| US-003 | 用户请求 AI 执行多次工具调用 | IMPL-016 | 0/3 ⬜ | ⬜ Phase 4 |
| US-004 | 用户查看工具调用详情 | IMPL-011, IMPL-018 | 2/4 ⬜ | 🟡 Phase 2 部分 |
| US-005 | 用户请求 AI 写入文件 | IMPL-012, IMPL-015 | 5/5 ✅ | ✅ 完成 |
| US-006 | 用户请求 AI 执行 Shell 命令 | IMPL-016 | 0/5 ⬜ | ⬜ Phase 4 |
| US-007 | 用户请求 AI 并行执行多个工具 | IMPL-007~008 | 3/3 ✅ | ✅ 完成 |

> AC 双层验证明细（验证指令 + 证据）见各阶段 `phases/phase-N/impl.md §P.3`。

---

## 4.1 Phase 索引

| Phase | 实施文档 | 名称（用户能力） | 状态 | IMPL | AC 验证 |
|-------|---------|----------------|------|------|---------|
| Phase 1 | [phases/phase-1/impl.md](phases/phase-1/impl.md) | 工具基础设施（types + registry + executor） | ✅ 完成 | 3/3 | 0/0 |
| Phase 2 | [phases/phase-2/impl.md](phases/phase-2/impl.md) | 工作目录 + read/glob + 基础 UI | ✅ 完成待验收 | 8/8 | 16/16 |
| Phase 3 | [phases/phase-3/impl.md](phases/phase-3/impl.md) | write/edit/ls/grep 工具 | ✅ 已签收 | 4/4 | 5/5 |
| Phase 4 | [phases/phase-4/impl.md](phases/phase-4/impl.md) | bash 工具 + 超时处理 | ✅ 已签收 | 3/3 | 8/8 |
| Phase 5 | [phases/phase-5/impl.md](phases/phase-5/impl.md) | MCP 接口预留 | ✅ 已完成 | 1/1 | 162/162 |

> 各 Phase 进度见 §4.0 仪表盘。
> 每个 Phase 的会话启动检查见 `phases/phase-N/session-start.md`。
> 每个 Phase 的完成证书见 `phases/phase-N/certificate.md`。

---

## 4.2 实施规划

### 复杂度快照

| 维度 | 评估值 | 得分 |
|------|--------|------|
| ① IMPL 估算任务数 | ~15 个 | 4分 |
| ② 涉及模块数 | tools/, session-repo, ipc/chat, renderer | 3分 |
| ③ 状态机变更 | 无 | 0分 |
| ④ 涟漪/下游影响 | 数据库迁移 + 多模块同步 | 2分 |
| ⑤ 并发/幂等要求 | 工作目录设置 | 1分 |
| ⑥ 外部依赖阻塞 | 无 | 0分 |
| **总分** | — | **10分 → 5 个 Phase** |

### Phase 分拆依据

- **Phase 1**：Critical Path — 工具调用基础设施是一切的前提
- **Phase 2**：用户核心能力 — workspace + read + glob + ToolCallLog UI
- **Phase 3**：扩展工具集 — write/edit/ls/grep 完善文件操作能力
- **Phase 4**：高级功能 — bash 命令 + 超时处理
- **Phase 5**：架构预留 — MCP 接口预留

### 关键路径（Critical Path）

```
用户发送"读取 src/main/index.ts"
  → IPC chat:send(session_id, content)
  → 检查 workspace 已设置
  → executor.run(messages, tools)
  → LLM 判断需要调用 read 工具
  → toolRegistry.execute('read', params, workspace)
  → read.ts 读取文件内容
  → 返回结果给 LLM
  → LLM 整合结果生成最终响应
  → IPC chat:stream 逐块发送到前端
  → 用户看到文件内容（带工具调用指示器）
```

### 阶段计划

| 阶段 | 名称（用户能力） | 本阶段 IMPL 范围 | 驱动因素 | Demo 完成标准 |
|------|----------------------|----------------|---------|--------------|
| Phase 1 | 工具基础设施 | types + registry + executor | Critical Path | executor 可执行工具调用，11 tests 通过 |
| Phase 2 | read + glob + 工作目录 UI | workspace + 2 工具 + UI | 核心用户故事 | 用户可让 AI 读取文件和搜索文件 |
| Phase 3 | write/edit/ls/grep 工具 | 4 个工具实现 | 扩展工具集 | 用户可让 AI 读取、搜索、写入、编辑文件 |
| Phase 4 | bash + 超时处理 | bash 工具 + 超时逻辑 | 高级功能 | 用户可让 AI 执行 shell 命令 |
| Phase 5 | MCP 接口预留 | 接口设计 | 架构预留 | 工具注册表支持 MCP 扩展 |

### 进入/退出条件

| 阶段 | 进入条件 | 退出条件 |
|------|---------|---------|
| Phase 1 | requirements.md + feature.md 已 approved | IMPL 全部完成 + Layer 1 全部通过 |
| Phase 2 | Phase 1 已完成 | IMPL 全部完成 + Layer 1 + Layer 2 E2E 通过 |
| Phase 3 | Phase 2 已签收 | IMPL 全部完成 + Layer 1 全部通过 |
| Phase 4 | Phase 3 已签收 | IMPL 全部完成 + Layer 1 + Layer 2 E2E 通过 |
| Phase 5 | Phase 4 已签收 | 接口设计完成 |

---

## 4.3 已知陷阱列表（Gotchas）

| ⚠️ 陷阱描述 | 正确做法 | 关联文档 |
|------------|---------|---------|
| 模型不支持 tool calling 时需回退 | 在 chat.ts 中检测模型能力，不支持时走纯文本路径 | feature.md §F.4 |
| 工具执行超时需正确处理 | 设置 30s 超时，超时后返回错误给 LLM | requirements.md §1.7 |
| 文件路径安全验证 | 所有工具必须验证路径在工作目录范围内，禁止访问系统敏感路径 | requirements.md §1.7 |
| MCP 扩展预留 | 工具注册表接口设计需支持未来 MCP 工具接入 | feature.md §F.2 |
| streamText 单次调用只做一轮工具调用 | 需手动管理 ReAct 循环：调用 LLM → 执行工具 → 追加结果 → 再调用 LLM | chat.ts 实现 |
| AI SDK v6 要求 jsonSchema() 包装 JSON Schema | dynamicTool inputSchema 需用 jsonSchema(schema.parameters) 包装 | chat.ts 实现 |
| ReAct 循环中 tool-call 累积 | 每次迭代使用新的 assistant message，不要累积历史 tool-call | executor.ts / chat.ts |
| 工具名称区分 | 前端用 toolName，后端用 tool_name，保持一致 | types.ts / chat.ts IPC |

---

## 4.4 发布清单

### 配置项
- [ ] 新增/修改的环境变量已在 dev/staging/prod 配置
- [ ] Feature Flag 状态确认

### 数据库
- [ ] Migration 脚本已编写并在 staging 验证
- [ ] 回滚 Migration 脚本已准备

### 中间件
- [ ] Kafka topic 已创建（如新增）
- [ ] Redis key 命名已确认，TTL 已设置

### 监控
- [ ] 关键 API 的 P99 延迟监控已设置
- [ ] 错误率告警已设置

### 回滚
- [ ] 回滚方案已文档化
- [ ] 回滚脚本已测试

**回滚命令**：
```bash
# 1. 回滚服务版本
git revert [commit-hash]

# 2. 验证服务健康
curl http://localhost:5173/health
```

**回滚后验证检查点**：
- [ ] 关键 API 可正常返回
- [ ] DB 数据一致性
- [ ] 之前的 Demo 场景仍可跑通
- [ ] 监控指标恢复正常

### 文档更新（⭐ 迭代完成后必须执行）
- [ ] overview.md 已更新（合并 FEATURE 中的全局变更：ADR、Schema、Patterns）
- [ ] overview-<module>.md 已更新（合并 FEATURE 中的模块变更：状态机、接口）
- [ ] feature.md 标记为 `status: archived`

---

## 4.5 范围外功能（Deferred Backlog）

> 实施中发现的超出当前阶段范围的功能，统一记录到 `deferred.md`（唯一权威来源）。

**操作规则**：
- 发现超出范围的功能 → 立即写入 `deferred.md`，不得「顺便实现」
- 每次会话结束时通知用户确认 pending 项
- 查看当前 pending 项：见 [`deferred.md`](deferred.md)

---

## 4.6 统一变更日志

| 日期 | 变更文档 | 变更摘要 | 影响的关联文档/ID | 已同步? |
|------|---------|---------|----------------|--------|
| 2026-03-24 | implementation.md | Phase 3 签收完成，Phase 4 就绪（IMPL-016~018 待实施） | phase-3/certificate.md, phase-4/IMPL.md, phase-4/session-start.md, phase-4/certificate.md | ✅ |
| 2026-03-24 | implementation.md | Phase 3 完成，IMPL-012~015 实现，write/edit/ls/grep 工具 | phase-3/IMPL.md, phase-3/certificate.md, phase-3/verify-report.md | ✅ |
| 2026-03-24 | implementation.md | Phase 2 完成，IMPL-004~011 实现，流式渲染修复 Round 7 | phase-2/IMPL.md, phase-2/certificate.md | ✅ |
| 2026-03-23 | implementation.md | Phase 1 完成，IMPL-001~003 实现，工具基础设施 | phase-1/IMPL.md | ✅ |
