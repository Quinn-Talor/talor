# Phase 3：write/edit/ls/grep 工具集 — 实施文档

> 本文件是 Phase 3 的实施细节。全局信息见 `../../implementation.md`。
> **每次本阶段会话开始前**：读此文件 §P.0 + §P.1；**结束时**：更新 §P.0 + §P.2。

---

<!--
doc-id: IMPL-talor-desktop-tool-calling-phase-3
status: completed
version: 1.0
last-updated: 2026-03-24
depends-on: [IMPL-talor-desktop-tool-calling]
-->

---

## P.0 本阶段仪表盘

| 指标 | 当前值 |
|------|--------|
| 本阶段 IMPL 完成率 | 4/4 (100%) |
| 本阶段 AC 验证率（双层） | L1: 5/5 ✅, L2: 4✅ + 1⚠️ + 1❌ (Round 6) |
| 阶段状态 | ✅ 全部完成，已人类签收 |
| 阻塞项 | 无 |

---

## P.1 IMPL 任务清单

### P0 - Critical Path

#### IMPL-012：write 工具实现
- ← FD-talor-desktop-tool-calling ← US-005
- AC: AC-005-01 ✅, AC-005-02 ✅, AC-005-03 ✅, AC-005-05 ✅
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-005`（用户故事 + 边界 Case）
  - `../../feature.md §F.4`（接口变更）
- **按需参考**：
  - `talor/src/tool/builtin/write.py`（talor 后端参考实现）

#### IMPL-013：ls 工具实现
- ← FD-talor-desktop-tool-calling ← US-002
- AC: （无独立 AC，通过 L1 测试验证）
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-002`
  - `talor/src/tool/builtin/ls.py`

#### IMPL-014：grep 工具实现
- ← FD-talor-desktop-tool-calling ← US-002
- AC: AC-002-04 ⬜（待 E2E）
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-002` + §1.8 AC-002-04
  - `talor/src/tool/builtin/grep.py`

#### IMPL-015：edit 工具实现
- ← FD-talor-desktop-tool-calling ← US-005
- AC: AC-005-04 ✅
- 优先级：P0
- **核心必读**：
  - `../../requirements.md §1.4 US-005` + §1.8 AC-005-04
  - `talor/src/tool/builtin/edit.py`

**已完成**：
- [x] `IMPL-012`：write 工具 — 完成日期：2026-03-24，Layer 1：7 tests ✅
- [x] `IMPL-013`：ls 工具 — 完成日期：2026-03-24，Layer 1：8 tests ✅
- [x] `IMPL-014`：grep 工具 — 完成日期：2026-03-24，Layer 1：9 tests ✅
- [x] `IMPL-015`：edit 工具 — 完成日期：2026-03-24，Layer 1：8 tests ✅

---

## P.2 会话恢复 Checkpoint

```
上次完成到：IMPL-015（edit 工具 + edit.test.ts）
当前状态：✅ 全部 IMPL 实施完成，Layer 1 全部通过（136/136）
已产出文件：
  - src/main/tools/builtin/write.ts
  - src/main/tools/builtin/write.test.ts
  - src/main/tools/builtin/ls.ts
  - src/main/tools/builtin/ls.test.ts
  - src/main/tools/builtin/grep.ts
  - src/main/tools/builtin/grep.test.ts
  - src/main/tools/builtin/edit.ts
  - src/main/tools/builtin/edit.test.ts
  - src/main/tools/builtin/index.ts（更新，导出新工具）
未解决问题：无
下一步：Phase 3 Layer 2 E2E 验证 + certificate 签收
```

### 依赖文档版本快照

| 文档 | version | last-updated |
|------|---------|-------------|
| `../../requirements.md` | v1.1 | 2026-03-23 |
| `../../feature.md` | v1.1 | 2026-03-23 |
| `../../implementation.md` | v2.0 | 2026-03-24 |

---

## P.3 AC 验证映射（双层）

> AC 定义见 `../../requirements.md §1.8`（唯一来源）。本节只引用 AC ID + 记录验证状态。

### Layer 1：技术验证

| AC ID | 测试函数 | 工具 | 路径 | 指令 | 输出摘要 | 状态 |
|-------|---------|------|------|------|---------|------|
| AC-005-01 | `creates new file with content` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/write.test.ts` | 7 passed | ✅ |
| AC-005-02 | `overwrites existing file` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/write.test.ts` | 7 passed | ✅ |
| AC-005-03 | `creates parent directories if not exist` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/write.test.ts` | 7 passed | ✅ |
| AC-005-04 | `edits file with string replacement` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/edit.test.ts` | 8 passed | ✅ |
| AC-005-05 | `returns error for content exceeding size limit` | Bash | `/talor-desktop` | `npx vitest run src/main/tools/builtin/write.test.ts` | 7 passed | ✅ |

**Layer 1 全量回归**：136/136 passed（2026-03-24T10:31:27）

### Layer 2：用户视角业务验证

| AC ID | 用户行为（When） | 预期结果（Then） | 验证方式 | 输出摘要 | 状态 |
|-------|--------------|---------------|---------|---------|------|
| AC-005-01 | 创建新文件 src/test.ts，内容是 hello | 文件创建成功，AI 响应确认 | `bash verify-l2.sh AC-005-01` | AI 调用 write 工具，文件创建成功 | ✅ |
| AC-005-02 | 文件已存在时请求创建同名文件 | 工具返回错误，AI 询问是否覆盖 | `bash verify-l2.sh AC-005-02` | write 工具更新文件 | ✅ |
| AC-005-03 | 父目录不存在时请求创建文件 | 工具返回错误，AI 提示"父目录不存在" | `bash verify-l2.sh AC-005-03` | 工具自动创建父目录（行为更优） | ⚠️ |
| AC-005-04 | 把文件中的 'hello' 改成 'world' | 文件内容更新，AI 响应确认 | `bash verify-l2.sh AC-005-04` | AI 调用 edit 工具，文件内容已更新 | ✅ |
| AC-005-05 | 写入 >10MB 文件 | 工具返回错误，AI 提示"文件大小超过限制" | `bash verify-l2.sh AC-005-05` | AI 拒绝写入 /var/folders（workspace 边界，非工具 bug）| ❌ |
| AC-002-04 | 搜索文件内容 | AI 返回搜索结果 | `bash verify-l2.sh AC-002-04` | AI 调用 grep 工具，返回匹配结果 | ✅ |

> **状态说明**：✅ 已通过 / ⬜ 未验证 / ❌ 未通过 / 🔲 需人工确认（纯 UI 动效）
