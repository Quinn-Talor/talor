# Phase 4 IMPL — Shell 命令 + 错误处理

> 追溯链：US-003, US-004, US-006 → FD-talor-desktop-tool-calling → IMPL-talor-desktop-tool-calling Phase 4

## IMPL 任务清单

### P0（Critical Path）

| ID | 任务描述 | 文件路径 | 实施前必读 | 依赖 |
|----|---------|---------|-----------|------|
| IMPL-016 | bash 工具实现（工作目录内执行 + 危险命令过滤） | `src/main/tools/builtin/bash.ts` | requirements.md §1.4 US-006 | Phase-1 executor |
| IMPL-017 | 工具超时处理（>30s） | `src/main/tools/executor.ts` | requirements.md §1.7 | Phase-1 executor |
| IMPL-018 | UI 超时状态显示 | `src/renderer/components/ToolCallLog.tsx` | requirements.md §1.4 US-004 | Phase-2 ToolCallLog |

---

## Checkpoint（会话恢复点）

- [ ] bash 工具实现完成
- [ ] 超时处理实现完成
- [ ] UI 超时显示完成

---

## AC 验证映射

### Layer 2（E2E 测试）

| AC ID | 测试方式 | 预期结果 |
|-------|---------|---------|
| AC-003-01 | Playwright：发送多步骤任务 | 多轮工具调用成功 |
| AC-003-02 | Playwright：工具失败后继续 | 错误处理正确 |
| AC-003-03 | Playwright：循环上限处理 | 停止循环，提示用户 |
| AC-004-04 | Playwright：工具超时 | 显示超时状态 |
| AC-006-01 | Playwright：执行 npm install | 命令执行成功 |
| AC-006-02 | Playwright：命令超时 | 返回超时错误 |
| AC-006-03 | Playwright：命令失败 | 返回错误码和输出 |
| AC-006-04 | Playwright：访问workspace外 | 返回错误提示 |
| AC-006-05 | Playwright：危险命令 | 拒绝执行，返回错误 |

---

## 实施前必读

- requirements.md §1.4 US-003, US-004, US-006
- requirements.md §1.7, §1.8 AC-003-xx, AC-004-xx, AC-006-xx
- Phase 1-3 的 implementation.md

## 按需参考

- talor/src/tool/builtin/bash.py