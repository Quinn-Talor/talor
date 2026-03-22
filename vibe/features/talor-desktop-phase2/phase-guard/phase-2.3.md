<!--
doc-id: PHASE-GUARD-talor-phase2-3
status: pending
version: 1.0
last-updated: 2026-03-21
depends-on: [PHASE-GUARD-talor-phase2-2, IMPL-talor-phase2]
-->

# Phase 2.3 完成证书（Phase Completion Certificate）

> 此证书必须在开始 Phase 3 前填写并提交。
> **任何一项未满足 = Phase 2.3 未完成，不允许进入下一阶段。**
> **填写人：AI 实施者（在每个阶段结束时完成）**

---

## 阶段身份

| 字段 | 内容 |
|------|------|
| 阶段编号 | Phase 2.3 |
| 阶段名称 | 消息附件支持 |
| 前置阶段 | Phase 2.1 + Phase 2.2 |
| 关联需求 | US-005（消息附件） |
| 关联 IMPL | IMPL-007, 008, 009 |
| 完成日期 | （待填写） |

---

## Demo 验证（必须亲自运行，不允许假设）

### Phase 2.3 Demo 场景

**操作步骤**：
1. Phase 2.1 + 2.2 Demo 已通过
2. 点击附件按钮，选择一张本地 PNG/JPG 图片
3. 验证图片缩略图出现在输入框下方
4. 发送"帮我分析这个截图"
5. 验证 AI 回复提及图片内容
6. 选择一个 PDF 文件，验证文件卡片显示
7. 选择一个 50MB+ 的文件，验证 FILE_TOO_LARGE 错误
8. 选择一个 EXE 文件，验证 UNSUPPORTED_FILE_TYPE 错误
9. 在 Ollama（非多模态）Provider 下选择图片发送，验证 PROVIDER_NO_VISION 错误
10. 拖拽文件到输入框，验证自动附加

**预期可观察结果**：
> 用户附加图片后 AI 正确感知并响应，附件验证失败时显示明确的 error_code 提示（FILE_TOO_LARGE / UNSUPPORTED_FILE_TYPE / PROVIDER_NO_VISION）

---

## AC 双层验证证据

### Phase 2.3 涉及 AC

| AC ID | Layer 1 | Layer 2 用户视角 |
|-------|---------|----------------|
| AC-005-01 | `npm run typecheck` | 点击附件 → 文件选择器打开 |
| AC-005-02 | `npm run typecheck` | 选择 PNG → 缩略图显示 |
| AC-005-03 | `npm run typecheck` | 选择 PDF → 文件卡片显示 |
| AC-005-04 | `npm run typecheck` | 点击 X → 附件移除 |
| AC-005-05 | `npm run typecheck` | 发送图片 → AI 提及图片 |
| AC-005-06 | `npm run typecheck` | 50MB 文件 → FILE_TOO_LARGE |
| AC-005-07 | `npm run typecheck` | EXE 文件 → UNSUPPORTED_FILE_TYPE |
| AC-005-08 | `npm run typecheck` | 不存在文件 → FILE_NOT_FOUND |
| AC-005-09 | `npm run typecheck` | Ollama + 图片 → PROVIDER_NO_VISION |
| AC-005-10 | `npm run typecheck` | 拖拽文件 → 自动附加 |

### Layer 1 技术验证输出

| AC ID | 工具 | 指令 | 实际输出 | 通过? |
|-------|------|------|---------|------|
| AC-005-01 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-02 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-03 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-04 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-05 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-06 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-07 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-08 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-09 | Bash | `npm run typecheck` | — | ⬜ |
| AC-005-10 | Bash | `npm run typecheck` | — | ⬜ |

### Layer 2 用户视角验证输出

| AC ID | 用户行为 | 工具 | 实际输出 | 符合预期? |
|-------|---------|------|---------|---------|
| AC-005-01 | 点击附件 | Playwright | — | ⬜ |
| AC-005-02 | 选择 PNG | Playwright | — | ⬜ |
| AC-005-03 | 选择 PDF | Playwright | — | ⬜ |
| AC-005-04 | 点击 X | Playwright | — | ⬜ |
| AC-005-05 | 发送图片 | Playwright | — | ⬜ |
| AC-005-06 | 50MB 文件 | Playwright | — | ⬜ |
| AC-005-07 | EXE 文件 | Playwright | — | ⬜ |
| AC-005-08 | 不存在文件 | Playwright | — | ⬜ |
| AC-005-09 | Ollama + 图片 | Playwright | — | ⬜ |
| AC-005-10 | 拖拽文件 | Playwright | — | ⬜ |

---

## 反模式检查清单

- [ ] **False** — Critical Path 上有函数返回空数组、null 或硬编码数据
- [ ] **False** — 本阶段创建的模块中有任何一个不在 Demo 调用链中（孤岛模块）
- [ ] **False** — Critical Path 上的任何函数体中存在 `// TODO: implement`
- [ ] **False** — 本阶段完成验证依赖了"测试通过"但没有亲自运行 Demo
- [ ] **False** — 有新增的 `as any` 未附带必要原因注释
- [ ] **False** — 有 async 函数缺少错误处理
- [ ] **False** — Phase 2.1 + 2.2 Demo 场景无法复现（回归）

---

## 量化指标确认

| 指标 | 要求 | 实际值 | 通过? |
|------|------|--------|-------|
| Phase 2.3 AC 通过率 | 100% | （待填写） | 待验证 |
| Phase 2.3 IMPL 完成率 | 100%（3/3） | （待填写） | 待验证 |
| 回归测试失败数 | 0 | （待填写） | 待验证 |
| 孤岛模块数 | 0 | （待填写） | 待验证 |

---

## Phase 2 整体完成确认

Phase 2 全部完成（Phase 2.1 + 2.2 + 2.3），当且仅当：

- [ ] Phase 2.1 证书已提交
- [ ] Phase 2.2 证书已提交
- [ ] Phase 2.3 证书已提交
- [ ] 所有 31 条 AC 双层通过率 = 100%
- [ ] 所有 12 个 IMPL 完成率 = 100%
- [ ] OVERVIEW-talor-desktop.md 已合并 Phase 2 变更
- [ ] FEATURE-talor-phase2.md 标记为 `status: archived`
- [ ] REQUIREMENTS.md 标记为 `status: archived`
- [ ] CLAUDE.md 更新 Phase 2 完成状态

---

## 下一阶段进入条件确认

Phase 3（数字员工契约 + Tool 调用）可以开始，当且仅当（全部勾选）：

- [ ] Phase 2 全部 3 个子阶段证书已提交
- [ ] AC 双层通过率 = 100%（全部 31 条）
- [ ] Demo 验证通过（Phase 2.1 + 2.2 + 2.3 全部亲自运行）
- [ ] 所有反模式检查项均为 False
- [ ] IMPLEMENTATION.md §4.0 仪表盘全绿
- [ ] OVERVIEW-talor-desktop.md 已合并 Phase 2 变更
- [ ] DEFERRED.md 中的 5 项 pending 已全部处理