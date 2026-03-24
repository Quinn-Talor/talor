# Phase 4：bash 工具 + 超时处理 + UI 状态 — 实施文档

> 本文件是 Phase 4 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-tool-calling-phase-4
status: draft
version: 1.0
last-updated: 2026-03-24
depends-on: [IMPL-talor-desktop-tool-calling]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 2/3 (67%) |
| 本阶段 AC 验证率（双层） | 7/8 ✅ (Layer 1) |
| 阶段状态 | ✅ IMPL-016,017 完成，待继续 |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

> **优先级顺序**：P0（Critical Path）→ P1（错误处理 + 边界）→ P2（次要功能）

### P0 - Critical Path

#### IMPL-016：bash 工具实现
- ← FD-talor-desktop-tool-calling ← US-006
- AC: AC-006-01（⬜ 未验证）, AC-006-04（⬜ 未验证）, AC-006-05（⬜ 未验证）
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-006`（用户故事 + 边界 Case）
  - `../../feature.md §F.4`（接口变更）
- **按需参考**：
  - `talor/src/tool/builtin/bash.py`（talor 后端参考实现）

#### IMPL-017：工具超时处理
- ← FD-talor-desktop-tool-calling ← US-003
- AC: AC-003-01（⬜ 未验证）, AC-003-03（⬜ 未验证）
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-003` + §1.7
  - `../../feature.md §F.4`

#### IMPL-018：UI 超时状态显示
- ← FD-talor-desktop-tool-calling ← US-004
- AC: AC-004-04（⬜ 未验证）
- 优先级：P1
- **核心必读**：
  - `../../requirements.md §1.4 US-004`
  - `src/renderer/components/ToolCallLog.tsx`（现有实现）

**已完成**：
- [x] `IMPL-016`：bash 工具 — 完成日期：2026-03-24，Layer 1：6 tests ✅
- [x] `IMPL-017`：工具超时处理 — 完成日期：2026-03-24，Layer 1：12 tests ✅

---

## P.2 会话恢复 Checkpoint

```
上次完成到：IMPL-017（工具超时处理 + 测试，Layer 1 12 tests ✅）
当前状态：编码中
已产出文件：
  - src/main/tools/builtin/bash.ts
  - src/main/tools/builtin/bash.test.ts
  - src/main/tools/builtin/index.ts（更新，导出新工具）
  - src/main/tools/executor.test.ts（更新，新增 timeout 测试）
  - vibe/features/talor-desktop-tool-calling/phases/phase-4/verify-l2.sh
未解决问题：无
下一步：IMPL-018（UI 超时状态显示）
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.2 | 2026-03-24 |
| `../../feature.md` | v1.2 | 2026-03-24 |
| `../../implementation.md` | v2.0 | 2026-03-24 |

---

## P.3 AC 验证映射（双层）

> AC 定义见 `../../requirements.md §1.8`（唯一来源）。本节只引用 AC ID + 记录验证状态。

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-006-01 | `executes simple command` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/bash.test.ts` | 6 passed | ✅ |
| AC-006-02 | `handles timeout` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/bash.test.ts` | 6 passed | ✅ |
| AC-006-03 | `returns error for failed command` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/bash.test.ts` | 6 passed | ✅ |
| AC-006-04 | `enforces workspace boundary` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/bash.test.ts` | 6 passed | ✅ |
| AC-006-05 | `blocks dangerous commands` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/bash.test.ts` | 6 passed | ✅ |
| AC-003-01 | `should accumulate messages in ReAct loop` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/executor.test.ts` | 12 passed | ✅ |
| AC-003-03 | `should stop after max iterations` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/executor.test.ts` | 12 passed | ✅ |
| AC-004-04 | `tool timeout UI display` | Bash | `/talor-desktop` | `npx vitest run src/renderer/` | — | ⬜ IMPL-018 |

**Layer 1 全量回归**：142/142 passed（2026-03-24T09:15:59）

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 验证方式 | 输出摘要 | 状态 |
|-------|--------------|---------------|---------|---------|------|
| AC-006-01 | 执行 `echo hello` | 命令在工作目录内执行，返回输出 | Playwright E2E | 需 Provider 配置 | ⬜ 待 Provider |
| AC-006-02 | 执行耗时命令超时 | 返回超时错误，AI 提示超时 | Playwright E2E | 需 Provider 配置 | ⬜ 待 Provider |
| AC-006-03 | 执行失败命令 | 返回错误码和输出，AI 展示错误 | Playwright E2E | 需 Provider 配置 | ⬜ 待 Provider |
| AC-006-04 | 访问 workspace 外路径 | 返回错误提示 | Playwright E2E | 需 Provider 配置 | ⬜ 待 Provider |
| AC-006-05 | 危险命令（如 rm -rf /） | 拒绝执行，返回错误 | Playwright E2E | 需 Provider 配置 | ⬜ 待 Provider |
| AC-003-01 | 多轮工具调用（ls → read） | 所有工具调用完成，返回最终响应 | Playwright E2E | ⬜ 待 IMPL-017 | ⬜ |
| AC-003-03 | 连续 10 次调用未得到答案 | 停止循环，提示"任务较复杂" | Playwright E2E | ⬜ 待 IMPL-017 | ⬜ |
| AC-004-04 | 工具执行超时（>30s） | UI 显示超时状态 | Playwright E2E | ⬜ 待 IMPL-018 | ⬜ |

> **状态说明**：✅ 已通过 / ⬜ 未验证 / ❌ 未通过 / 🔲 需人工确认（纯 UI 动效）
> **注意**：Layer 2 E2E 需要配置 Provider 后才能执行验证。
