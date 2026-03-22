<!--
doc-id: PHASE-GUARD-talor-phase2-1
status: completed
version: 1.0
last-updated: 2026-03-21
depends-on: [IMPL-talor-phase2]
-->
# Phase 2.1 完成证书（Phase Completion Certificate）

> 此证书必须在开始 Phase 2.2 前填写并提交。
> **任何一项未满足 = Phase 2.1 未完成，不允许进入下一阶段。**
> **填写人：AI 实施者（在每个阶段结束时完成）**

---

## 阶段身份

| 字段 | 内容 |
|------|------|
| 阶段编号 | Phase 2.1 |
| 阶段名称 | 流式对话 MVP |
| 关联需求 | US-001（流式对话）、US-003（会话持久化）、US-004（Provider 切换） |
| 关联 IMPL | IMPL-010, 001, 003, 004, 012 |
| 完成日期 | （待填写） |

---

## Demo 验证（必须亲自运行，不允许假设）

### Demo 场景

**操作步骤**：
1. `cd talor-desktop && npm run dev` 启动应用
2. 在设置页配置并选择默认 Provider（如 Ollama）
3. 返回聊天页，输入"你好"并发送
4. 观察 AI 回复的流式打字机效果（文字逐步显示）
5. 在 AI 响应过程中点击停止按钮
6. 关闭应用，重新 `npm run dev`
7. 验证之前的会话和消息历史仍然存在

**预期可观察结果**：
> 用户看到 AI 回复逐步显示（打字机效果），点击停止后响应中断，重启后历史会话和消息完整保留

---

## AC 双层验证证据（必填，任何一行为空 = 阶段未完成）

### Phase 2.1 涉及 AC

| AC ID | 阶段归属 | Layer 1 技术验证 | Layer 2 用户视角 |
|-------|---------|----------------|----------------|
| AC-001-01 | 2.1+2.2 | `npm run typecheck` 通过 | 用户看到打字机效果 |
| AC-001-02 | 2.1 | `npm run typecheck` 通过 | 空输入点击不发送 |
| AC-001-03 | 2.1 | `npm run typecheck` 通过 | 流式中按钮 disabled |
| AC-001-07 | 2.1 | `npm run typecheck` 通过 | 点击停止，中断 + 部分保留 |
| AC-003-05 | 2.1 | SQLite CRUD 验证 | 重启后会话 + 消息保留 |
| AC-004-01 | 2.1 | Provider 切换验证 | 新会话用新 Provider |
| AC-004-02 | 2.1 | Provider 删除验证 | 自动切换到其他 Provider |

### Layer 1 技术验证输出

| AC ID | 工具 | 指令 | 实际输出（工具原始输出摘要） | 通过? |
|-------|------|------|--------------------------|------|
| AC-001-01 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-001-02 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-001-03 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-001-07 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-003-05 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-004-01 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |
| AC-004-02 | Bash | `cd talor-desktop && npm run typecheck` | — | ⬜ |

### Layer 2 用户视角业务验证输出

| AC ID | 用户行为 | 工具 | 指令 | 实际输出 | 符合预期? |
|-------|---------|------|------|---------|---------|
| AC-001-01 | 输入文字发送 | Playwright | `npm run dev` → 手动 | — | ⬜ |
| AC-001-02 | 空输入点击发送 | Playwright | `npm run dev` → 手动 | — | ⬜ |
| AC-001-03 | 流式中再次点击 | Playwright | `npm run dev` → 手动 | — | ⬜ |
| AC-001-07 | 点击停止 | Playwright | `npm run dev` → 手动 | — | ⬜ |
| AC-003-05 | 重启验证 | Playwright | 重启 dev server | — | ⬜ |
| AC-004-01 | 切换 Provider | Playwright | 设置页切换 | — | ⬜ |
| AC-004-02 | 删除默认 Provider | Playwright | 删除默认 | — | ⬜ |

---

## 反模式检查清单（全部必须为 False）

- [ ] **False** — Critical Path 上有函数返回空数组、null 或硬编码数据
- [ ] **False** — 本阶段创建的模块中有任何一个不在 Demo 调用链中（孤岛模块）
- [ ] **False** — Critical Path 上的任何函数体中存在 `// TODO: implement`
- [ ] **False** — 本阶段完成验证依赖了"测试通过"但没有亲自运行 Demo
- [ ] **False** — 有新增的 `as any`、`as unknown as T` 未附带必要原因注释
- [ ] **False** — 有 async 函数缺少错误处理
- [ ] **False** — Phase 1 的 Provider CRUD Demo 场景无法复现（回归）

---

## 本阶段孤岛模块记录

| 模块名 | 当前状态 | 处理决定 |
|--------|---------|---------|
| — | — | 已连接 / defer 到 Phase 2.2 |

---

## 量化指标确认（全部必须达标）

| 指标 | 要求 | 实际值 | 通过? |
|------|------|--------|-------|
| Phase 2.1 AC 通过率 | 100% | （待填写） | 待验证 |
| Phase 2.1 IMPL 完成率 | 100%（5/5） | （待填写） | 待验证 |
| 回归测试失败数 | 0 | （待填写） | 待验证 |
| 孤岛模块数 | 0 | （待填写） | 待验证 |

---

## 下一阶段进入条件确认

Phase 2.2（会话管理与完善）可以开始，当且仅当（全部勾选）：

- [ ] AC 双层通过率 = 100%（Phase 2.1 涉及的 7 条 AC）
- [ ] Demo 验证通过（已亲自运行并观察到预期结果）
- [ ] 所有反模式检查项均为 False
- [ ] IMPLEMENTATION.md §4.0 仪表盘已更新
- [ ] IMPLEMENTATION.md §4.1 Checkpoint 已更新
