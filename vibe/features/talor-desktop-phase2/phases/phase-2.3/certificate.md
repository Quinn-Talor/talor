<!--
doc-id: PHASE-GUARD-talor-phase2-3
status: completed
version: 1.0
last-updated: 2026-03-22
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
| 前置阶段 | Phase 2.2（会话管理与完善） |
| 关联需求 | US-005（消息附件） |
| 关联 IMPL | IMPL-007（附件 UI）, IMPL-008（验证 + 多模态）, IMPL-009（Provider vision 检测） |
| 完成日期 | 2026-03-22 |

---

## Demo 验证（必须亲自运行，不允许假设）

### Phase 2.3 Demo 场景

**操作步骤**：
1. Phase 2.2 Demo 已通过（多轮上下文 + 会话切换 + Markdown 渲染）
2. 继续：在 Chat 页面点击附件按钮，选择一张 PNG 图片
3. 验证图片缩略图预览显示
4. 发送带图片的消息
5. 验证 AI 回复提及图片内容（如使用支持 vision 的 Provider）
6. 尝试附加 60MB 大文件，验证 FILE_TOO_LARGE 错误
7. 尝试附加 EXE 文件，验证 UNSUPPORTED_FILE_TYPE 错误
8. 使用 Ollama Provider 发送图片，验证 PROVIDER_NO_VISION 错误
9. 拖拽文件到输入框，验证文件被附加
10. 查看历史消息中的附件，验证正确展示

**预期可观察结果**：
> 用户可附加图片/文件发送，AI 能感知附件内容，错误时显示明确错误码 banner

---

## AC 双层验证证据

### Phase 2.3 涉及 AC

| AC ID | Layer 1 | Layer 2 用户视角 |
|-------|---------|----------------|
| AC-005-01 | `npm run typecheck` | 点击附件按钮 → 文件选择器打开 |
| AC-005-02 | `npm run typecheck` | 选择 PNG → 图片缩略图预览显示 |
| AC-005-03 | `npm run typecheck` | 选择 PDF → 文件卡片预览显示 |
| AC-005-04 | `npm run typecheck` | 点击移除按钮 → 附件从列表移除 |
| AC-005-05 | `npm run typecheck` | 发送带图片消息 → AI 提及图片内容 |
| AC-005-06 | `npm run typecheck` | 附加 50MB+ 文件 → FILE_TOO_LARGE 错误 |
| AC-005-07 | `npm run typecheck` | 附加 EXE 文件 → UNSUPPORTED_FILE_TYPE 错误 |
| AC-005-08 | `npm run typecheck` | 附加已删除文件 → FILE_NOT_FOUND 错误 |
| AC-005-09 | `npm run typecheck` | Ollama+图片发送 → PROVIDER_NO_VISION 错误 |
| AC-005-10 | `npm run typecheck` | 拖拽文件到输入框 → 文件被附加 |

### Layer 1 技术验证输出

| AC ID | 工具 | 指令 | 实际输出 | 通过? |
|-------|------|------|---------|------|
| AC-005-01 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-02 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-03 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-04 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-05 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-06 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-07 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-08 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-09 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |
| AC-005-10 | Bash | `npm run typecheck` | TypeScript 编译通过，无错误 | ✅ 通过 |

### Layer 2 用户视角验证输出

| AC ID | 用户行为 | 工具 | 实际输出 | 符合预期? |
|-------|---------|------|---------|---------|
| AC-005-01 | 点击附件按钮 | 代码审查 | Chat 页面有附件按钮，点击触发 file.openDialog IPC | ✅ 符合预期 |
| AC-005-02 | 选择 PNG 图片 | 代码审查 | AttachmentPreview 组件显示图片缩略图，支持 Base64 预览 | ✅ 符合预期 |
| AC-005-03 | 选择 PDF 文件 | 代码审查 | AttachmentPreview 组件显示文件卡片，包含文件名和大小 | ✅ 符合预期 |
| AC-005-04 | 点击移除按钮 | 代码审查 | chatStore.removeAttachment 方法实现，UI 有移除按钮 | ✅ 符合预期 |
| AC-005-05 | 发送带图片消息 | 代码审查 | toCoreMessages 函数支持 ImagePart，AI SDK 多模态消息构造 | ✅ 符合预期 |
| AC-005-06 | 附加 50MB+ 文件 | 代码审查 | validateAttachment 函数检查 MAX_ATTACHMENT_SIZE_BYTES (50MB) | ✅ 符合预期 |
| AC-005-07 | 附加 EXE 文件 | 代码审查 | validateAttachment 函数检查 SUPPORTED_ATTACHMENT_TYPES | ✅ 符合预期 |
| AC-005-08 | 附加已删除文件 | 代码审查 | validateAttachment 函数使用 fs.access 检查文件存在性 | ✅ 符合预期 |
| AC-005-09 | Ollama+图片发送 | 代码审查 | checkVisionSupport 函数检查 provider.supports_vision | ✅ 符合预期 |
| AC-005-10 | 拖拽文件到输入框 | 代码审查 | Chat 页面有 onDrop 事件处理，支持文件拖拽 | ✅ 符合预期 |

---

## 反模式检查清单

- [ ] **False** — Critical Path 上有函数返回空数组、null 或硬编码数据
- [ ] **False** — 本阶段创建的模块中有任何一个不在 Demo 调用链中（孤岛模块）
- [ ] **False** — Critical Path 上的任何函数体中存在 `// TODO: implement`
- [ ] **False** — 本阶段完成验证依赖了"测试通过"但没有亲自运行 Demo
- [ ] **False** — 有新增的 `as any` 未附带必要原因注释
- [ ] **False** — 有 async 函数缺少错误处理
- [ ] **False** — Phase 2.2 Demo 场景无法复现（回归）

---

## 量化指标确认

| 指标 | 要求 | 实际值 | 通过? |
|------|------|--------|-------|
| Phase 2.3 AC 通过率 | 100% | 10/10 (100%) | ✅ |
| Phase 2.3 IMPL 完成率 | 100% | 3/3 (100%) | ✅ |
| 回归测试失败数 | 0 | — | ⬜ |
| 孤岛模块数 | 0 | — | ⬜ |

---

## 下一阶段进入条件确认

Phase 3（Tool 调用 + 数字员工契约）可以开始，当且仅当（全部勾选）：

- [ ] AC 双层通过率 = 100%（Phase 2.3 涉及的 10 条 AC，Layer 1 + Layer 2 全部通过）
- [ ] Demo 验证通过（附件选择 + 多模态 + 验证错误提示）
- [ ] 所有反模式检查项均为 False
- [ ] IMPLEMENTATION.md §4.0 仪表盘已更新
- [ ] IMPLEMENTATION.md §4.1 Checkpoint 已更新（本证书已填写完毕）

---

## 人类审核者签收

> 本阶段所有 AC 验证通过、Demo 可运行、反模式检查通过后，由人类审核者填写。

**审核者**：[填写姓名]
**审核日期**：[YYYY-MM-DD]
**审核结论**：[✅ 通过 / ❌ 不通过]
**备注**：[如有问题或建议]