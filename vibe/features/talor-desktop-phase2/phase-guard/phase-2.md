<!--
doc-id: PHASE-GUARD-talor-phase2-2
status: pending
version: 1.0
last-updated: 2026-03-21
depends-on: [PHASE-GUARD-talor-phase2-1, IMPL-talor-phase2]
-->

# Phase 2.2 完成证书（Phase Completion Certificate）

> 此证书必须在开始 Phase 2.3 前填写并提交。
> **任何一项未满足 = Phase 2.2 未完成，不允许进入下一阶段。**
> **填写人：AI 实施者（在每个阶段结束时完成）**

---

## 阶段身份

| 字段 | 内容 |
|------|------|
| 阶段编号 | Phase 2.2 |
| 阶段名称 | 会话管理与完善 |
| 前置阶段 | Phase 2.1（流式对话 MVP） |
| 关联需求 | US-001（流式完善）、US-002（多轮上下文）、US-003（会话管理） |
| 关联 IMPL | IMPL-011, 002, 005, 006 |
| 完成日期 | （待填写） |

---

## Demo 验证（必须亲自运行，不允许假设）

### Phase 2.2 Demo 场景

**操作步骤**：
1. Phase 2.1 Demo 已通过（打字机效果 + 中断 + 重启持久化）
2. 继续：连续发送"我叫张三" → "我叫什么？" → "用 Python 写 hello world"
3. 验证 AI 回复正确引用上下文
4. 点击"新建会话"，验证新会话创建
5. 在侧边栏切换回之前的会话，验证消息加载
6. 发送包含代码的消息，验证 Markdown + 语法高亮渲染
7. 断网发送消息，验证 LLM_CONNECTION_FAILED 错误 banner
8. 删除一个历史会话，验证确认弹窗 + 移除

**预期可观察结果**：
> 多轮对话 AI 记住上下文，会话切换/删除/新建可用，Markdown 正确渲染，LLM 错误时显示 error_code banner

---

## AC 双层验证证据

### Phase 2.2 涉及 AC

| AC ID | Layer 1 | Layer 2 用户视角 |
|-------|---------|----------------|
| AC-001-04 | `npm run typecheck` | 断网发送 → LLM_CONNECTION_FAILED banner |
| AC-001-05 | `npm run typecheck` | 错误 API Key → AUTH_FAILED banner |
| AC-001-06 | `npm run typecheck` | 等待 60s+ → LLM_TIMEOUT banner |
| AC-001-08 | `npm run typecheck` | 发送代码 → Markdown 语法高亮 |
| AC-002-01 | `npm run typecheck` | "我叫张三"→"我叫什么？" → AI 提及"张三" |
| AC-002-02 | `npm run typecheck` | 连续 5 轮 → 消息列表递增 |
| AC-002-03 | `npm run typecheck` | 发送 21 条 → 不崩溃 |
| AC-002-04 | `npm run typecheck` | 长对话 → 正常响应（自动截断） |
| AC-003-01 | `npm run typecheck` | 点击新建 → 创建空会话 |
| AC-003-02 | `npm run typecheck` | 点击历史 → 消息加载 |
| AC-003-03 | `npm run typecheck` | 删除会话 → 确认 + 移除 |
| AC-003-04 | `npm run typecheck` | 删除当前 → 自动切换 |
| AC-003-06 | `npm run typecheck` | 创建 20+ 会话 → 可滚动 |
| AC-005-11 | `npm run typecheck` | 查看历史附件 → 正确展示 |

### Layer 1 技术验证输出

| AC ID | 工具 | 指令 | 实际输出 | 通过? |
|-------|------|------|---------|------|
| AC-001-04 | Bash | `npm run typecheck` | — | ⬜ |
| AC-001-05 | Bash | `npm run typecheck` | — | ⬜ |
| AC-001-06 | Bash | `npm run typecheck` | — | ⬜ |
| AC-001-08 | Bash | `npm run typecheck` | — | ⬜ |
| AC-002-01 | Bash | `npm run typecheck` | — | ⬜ |
| AC-002-02 | Bash | `npm run typecheck` | — | ⬜ |
| AC-002-03 | Bash | `npm run typecheck` | — | ⬜ |
| AC-002-04 | Bash | `npm run typecheck` | — | ⬜ |
| AC-003-01 | Bash | `npm run typecheck` | — | ⬜ |
| AC-003-02 | Bash | `npm run typecheck` | — | ⬜ |
| AC-003-03 | Bash | `npm run typecheck` | — | ⬜ |
| AC-003-04 | Bash | `npm run typecheck` | — | ⬜ |
| AC-003-06 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-11 | Bash | `npm run typecheck` | — | ⬜ |

### Layer 2 用户视角验证输出

| AC ID | 用户行为 | 工具 | 实际输出 | 符合预期? |
|-------|---------|------|---------|---------|
| AC-001-04 | 断网发送 | Playwright | — | ⬜ |
| AC-001-05 | 错误 API Key | Playwright | — | ⬜ |
| AC-001-06 | 等待超时 | Playwright | — | ⬜ |
| AC-001-08 | 发送代码 | Playwright | — | ⬜ |
| AC-002-01 | 上下文测试 | Playwright | — | ⬜ |
| AC-002-02 | 5 轮对话 | Playwright | — | ⬜ |
| AC-002-03 | 21 条消息 | Playwright | — | ⬜ |
| AC-002-04 | 长对话 | Playwright | — | ⬜ |
| AC-003-01 | 新建会话 | Playwright | — | ⬜ |
| AC-003-02 | 加载历史 | Playwright | — | ⬜ |
| AC-003-03 | 删除会话 | Playwright | — | ⬜ |
| AC-003-04 | 删除当前 | Playwright | — | ⬜ |
| AC-003-06 | 20+ 会话 | Playwright | — | ⬜ |
| AC-005-11 | 历史附件 | Playwright | — | ⬜ |

---

## 反模式检查清单

- [ ] **False** — Critical Path 上有函数返回空数组、null 或硬编码数据
- [ ] **False** — 本阶段创建的模块中有任何一个不在 Demo 调用链中（孤岛模块）
- [ ] **False** — Critical Path 上的任何函数体中存在 `// TODO: implement`
- [ ] **False** — 本阶段完成验证依赖了"测试通过"但没有亲自运行 Demo
- [ ] **False** — 有新增的 `as any` 未附带必要原因注释
- [ ] **False** — 有 async 函数缺少错误处理
- [ ] **False** — Phase 2.1 Demo 场景无法复现（回归）

---

## 量化指标确认

| 指标 | 要求 | 实际值 | 通过? |
|------|------|--------|-------|
| Phase 2.2 AC 通过率 | 100% | （待填写） | 待验证 |
| Phase 2.2 IMPL 完成率 | 100%（4/4） | （待填写） | 待验证 |
| 回归测试失败数 | 0 | （待填写） | 待验证 |
| 孤岛模块数 | 0 | （待填写） | 待验证 |

---

## 下一阶段进入条件确认

Phase 2.3（消息附件）可以开始，当且仅当（全部勾选）：

- [ ] AC 双层通过率 = 100%（Phase 2.2 涉及的 14 条 AC）
- [ ] Demo 验证通过（已亲自运行）
- [ ] 所有反模式检查项均为 False
- [ ] IMPLEMENTATION.md §4.0 仪表盘已更新
- [ ] IMPLEMENTATION.md §4.1 Checkpoint 已更新
