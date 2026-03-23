# Phase 3 IMPL — 写操作工具 + 目录工具

> 追溯链：US-002, US-005 → FD-talor-desktop-tool-calling → IMPL-talor-desktop-tool-calling Phase 3

## IMPL 任务清单

### P0（Critical Path）

| ID | 任务描述 | 文件路径 | 实施前必读 | 依赖 |
|----|---------|---------|-----------|------|
| IMPL-012 | write 工具实现（带 workspace 限制 + 文件大小限制） | `src/main/tools/builtin/write.ts` | requirements.md §1.4 US-005 | Phase-1 executor |
| IMPL-013 | ls 工具实现（带 workspace 限制） | `src/main/tools/builtin/ls.ts` | requirements.md §1.4 US-002 | Phase-1 executor |
| IMPL-014 | grep 工具实现（带 workspace 限制） | `src/main/tools/builtin/grep.ts` | requirements.md §1.4 US-002 | Phase-1 executor |
| IMPL-015 | edit 工具实现（字符串替换编辑） | `src/main/tools/builtin/edit.ts` | requirements.md §1.4 US-005 | IMPL-012 |

---

## Checkpoint（会话恢复点）

- [ ] write 工具实现完成
- [ ] ls 工具实现完成
- [ ] grep 工具实现完成
- [ ] edit 工具实现完成

---

## AC 验证映射

### Layer 2（E2E 测试）

| AC ID | 测试方式 | 预期结果 |
|-------|---------|---------|
| AC-005-01 | Playwright：创建文件 | 文件创建成功 |
| AC-005-02 | Playwright：创建已存在文件 | 询问是否覆盖 |
| AC-005-03 | Playwright：父目录不存在 | 返回错误提示 |
| AC-005-04 | Playwright：编辑文件 | 文件内容更新 |
| AC-005-05 | Playwright：写入>10MB文件 | 返回错误提示 |

---

## 实施前必读

- requirements.md §1.4 US-002, US-005
- requirements.md §1.8 AC-005-xx
- Phase 1, Phase 2 的 implementation.md

## 按需参考

- talor/src/tool/builtin/write.py
- talor/src/tool/builtin/edit.py
- talor/src/tool/builtin/grep.py
- talor/src/tool/builtin/ls.py