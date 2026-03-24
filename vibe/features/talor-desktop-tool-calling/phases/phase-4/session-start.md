# Phase 4 会话启动检查

> 本文件是 Phase 4 的会话启动锚点。**每次本阶段会话开始前必须检查**。

---

## Step 1：读取当前状态

```
# 读取 IMPL 仪表盘
cat phases/phase-4/IMPL.md §P.0

# 读取 Checkpoint
cat phases/phase-4/IMPL.md §P.2
```

**当前阶段状态**：
- IMPL 完成率：0/3 (0%)
- AC 验证率：0/0
- 阶段状态：⬜ 未开始
- 上次完成到：无

---

## Step 2：确认进入条件

| 条件 | 状态 | 说明 |
|------|------|------|
| Phase 3 已签收 | ✅ | certificate.md 已完成 |
| requirements.md 已 approved | ✅ | v1.2 |
| feature.md 已 approved | ✅ | v1.2 |
| implementation.md 已 approved | ✅ | v2.0 |

**结论**：✅ Phase 4 可以开始

---

## Step 3：加载上下文

**实施前必读**（按顺序）：
1. `../../requirements.md §1.4 US-006` — bash 工具用户故事
2. `../../requirements.md §1.4 US-003` — 多轮工具调用
3. `../../requirements.md §1.4 US-004` — 工具调用 UI
4. `../../feature.md §F.4` — 接口变更

**按需参考**：
- `talor/src/tool/builtin/bash.py` — 后端参考实现
- `src/renderer/components/ToolCallLog.tsx` — 现有 UI 组件

---

## Step 4：命名一致性确认

**术语表**（来自 `../../requirements.md §1.3`）：
- 工具调用（Tool Call）：用户请求 AI 执行工具的行为
- bash 工具：在终端执行命令的工具
- 工作目录（Workspace）：会话的根目录，工具操作在此范围内
- 超时（Timeout）：工具执行超过 30s 后的处理

---

## Step 5：验证执行环境

| 项目 | 值 |
|------|-----|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| Layer 1 测试命令 | `npx vitest run` |
| Layer 2 验证工具 | Playwright E2E |
| Electron 启动 | `npm run dev` |
| CDP 端口 | 9222 |

**前置条件**：
1. ✅ Electron 应用已启动（`npm run dev`）
2. ✅ CDP 端口可访问（`curl http://localhost:9222/json`）
3. ✅ Provider 已配置（测试会话可创建）

---

## 实施顺序

按 `IMPL.md §P.1` 优先级：

1. **IMPL-016** (P0)：bash 工具实现
2. **IMPL-017** (P0)：工具超时处理
3. **IMPL-018** (P1)：UI 超时状态显示

---

## 预期产出

- `src/main/tools/builtin/bash.ts`
- `src/main/tools/builtin/bash.test.ts`
- 更新 `src/main/tools/builtin/index.ts`
- 更新 `src/main/services/tool-timeout.ts`（如需要）
- 更新 UI 组件超时显示
