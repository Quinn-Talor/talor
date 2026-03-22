<!--
doc-id: IMPL-talor-model-management-phase2
status: draft
version: 1.1
last-updated: 2026-03-22
depends-on: [IMPL-talor-model-management-phase1]
-->

# Phase 2 IMPL — 能力检测与缓存

> 追溯链：US-011 → FD-talor-desktop-model-management → 本文档（IMPL-talor-model-management-phase2）
> 依赖的 AC：AC-011-01, AC-011-02, AC-011-03, AC-011-04

---

## §P.0 本阶段仪表盘

| 指标 | 当前值 | 目标值 | 状态 |
|------|--------|--------|------|
| **IMPL 完成率** | 7/10 (70%) | 10/10 (100%) | 🔄 P0 + P1 完成（P2 未开始） |
| **AC 验证率** | 4/4 (100%) | 4/4 (100%) | ✅ 全部通过 |
| **阶段状态** | 进行中 | 已完成 | 🔄 P1 已完成，P2（IMPL-020~022）为可选优化 |
| **阻塞项** | 无 | - | ✅ |

---

## §P.1 IMPL 任务清单

### P0 — Critical Path（必须完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-013 | 扩展 ModelInfo 接口：新增 capabilities 字段 | US-011 | AC-011-01 | ✅ 已完成（字段在 Phase 1 已实现，src/main/types/models.ts + src/renderer/types/models.ts） | 1h |
| IMPL-014 | 实现模型能力检测逻辑 | US-011 | AC-011-01, AC-011-02 | ✅ 已完成 | 4h |
| IMPL-015 | 新增 IPC 端点：providers:detectCapabilities | US-011 | AC-011-01 | ✅ 已完成 | 2h |
| IMPL-016 | 实现能力检测降级策略 | US-011 | AC-011-02 | ✅ 已完成（getCapabilitiesWithFallback，与 IMPL-014 合并实现） | 2h |

### P1 — 重要功能（Phase 2 内完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-017 | 前端：模型详情展示页面/组件 | US-011 | AC-011-03 | ✅ 已完成（CapabilityBadge + 详情面板 + testHint，双层验证 ✅） | 3h |
| IMPL-018 | 实现持久化缓存（config-store） | US-011 | AC-010-04 | ✅ 已完成（isCacheValid + getModels 持久化缓存，双层验证 ✅） | 3h |
| IMPL-019 | 新增 IPC 端点：providers:updateModelCapabilities | US-011 | AC-011-04 | ✅ 已完成（applyManualCapabilities + IPC handler + preload，双层验证 ✅） | 2h |

### P2 — 优化功能（可延期到 Phase 3）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-020 | 前端：能力手动配置表单 | US-011 | AC-011-04 | ⬜ 未开始 | 3h |
| IMPL-021 | 缓存过期自动刷新逻辑 | US-010 | AC-010-04 | ⬜ 未开始 | 2h |
| IMPL-022 | 能力检测结果可视化 | US-011 | AC-011-03 | ⬜ 未开始 | 2h |

**Phase 2 IMPL 总计**：10 个任务（4 P0 + 3 P1 + 3 P2）

---

## §P.2 会话恢复 Checkpoint

### 实施前必读（每次开始前必须重新加载）

1. **Phase 1 成果**：`phases/phase-1/impl.md` 和验证报告
2. **功能设计**：`feature.md` §F.2 Schema 变更、§F.5 并发要求
3. **需求定义**：`requirements.md` US-011 和关联 AC
4. **实施计划**：`implementation.md` §4.2 Phase 2 范围

### 依赖文档版本快照

| 文档 | 版本 | 最后更新 | 关键变更 |
|------|------|---------|---------|
| OVERVIEW-talor-desktop.md | 1.2 | 2026-03-22 | 当前模块现状 |
| requirements.md | 1.0 | 2026-03-22 | US-011 + Phase 2 相关 AC |
| feature.md | 1.0 | 2026-03-22 | §F.2 能力字段、§F.5 并发要求 |
| implementation.md | 1.1 | 2026-03-22 | Phase 1 完成后更新 §4.0 |
| phases/phase-1/impl.md | 1.0 | 2026-03-22 | Phase 1 P0 全部完成，AC-010-04⚠️，AC-012-01❌ |

### 上次中断点记录

| 字段 | 值 |
|------|---|
| 上次完成到 | Bug fix: `src/main/providers/llm-provider.ts` — model_id 前缀剥离（`ollama/qwen3-coder:480b-cloud` → `qwen3-coder:480b-cloud`），E2E 全流程 4步验证通过 |
| 当前状态 | P0 全部完成，bug fix 已验证。P1（IMPL-017~019）未开始 |
| 已产出文件 | `src/main/services/capability-detector.ts`（detectModelCapabilities + getCapabilitiesWithFallback），`src/main/services/capability-detector.test.ts`（10 个 Vitest 单元测试），`src/main/ipc/providers.ts`（新增 providers:detectCapabilities handler），`src/preload/index.ts`（新增 detectCapabilities 方法），`src/renderer/api/talorAPI.ts`（新增 detectCapabilities 类型 + stub），`src/main/providers/llm-provider.ts`（bug fix: 剥离 provider.type/ 前缀，修复 Ollama 404 Not Found）|
| Bug Fix 记录 | **根因**：`chat:send` IPC 传入 `ollama/qwen3-coder:480b-cloud` 给 Ollama API，Ollama 只接受不带前缀的格式。**修复**：`rawModel.replace(new RegExp('^${provider.type}/'), '')`。**E2E 验证**：新建会话→选模型→发消息→收响应，全部 ✅ PASS（13s，AI 回复"收到了。"） |
| 未解决问题 | AC-010-04 内存缓存 hit 未触发（根因待 IMPL-018 排查）|
| 下一步 | 从 IMPL-017（前端：模型详情展示页面/组件，AC-011-03）开始 Phase 2 P1 |

---

## §P.3 AC 验证映射（双层验证）

### AC-011-01：模型能力自动检测

**Layer 1 技术验证**
- **工具**：Bash + TypeScript 编译检查 + Vitest 单元测试
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck && npm test
  ```
- **实际输出**：
  ```
  > talor-desktop@0.1.0 typecheck
  (main/preload/renderer 全部通过，exit 0)

  > talor-desktop@0.1.0 test
  ✓ src/main/services/capability-detector.test.ts (10 tests) 7ms
  Test Files  1 passed (1)
  Tests  10 passed (10)
  ```
- **状态**：✅ PASS

**Layer 2 用户视角验证（Playwright CDP，2026-03-22）**
- **工具**：Node.js + Playwright CDP（http://localhost:9222）
- **实际输出**：
  ```json
  {
    "providers_count": 1,
    "provider_id": "7a8ff895-79c0-4f66-a550-e4ac62d464f0",
    "provider_name": "Ollama Local",
    "models_count": 2,
    "first_model_id": "ollama/qwen3-coder:480b-cloud",
    "first_model_name": "qwen3-coder:480b-cloud",
    "first_model_capabilities_before": 1,
    "detect_success": true,
    "capabilities_after": 2,
    "has_text_generation": true,
    "supports_vision": false,
    "supports_tools": true,
    "capability_types": ["text_generation", "function_calling"],
    "fallback_throws_on_invalid_provider": true
  }
  ```
- **AC-011-01 Then 逐项确认**：
  - ✅ detectCapabilities IPC 调用成功（detect_success: true）
  - ✅ qwen3-coder 支持 function_calling（tools），正确不支持 vision
  - ✅ capabilities_after = 2（text_generation + function_calling）
- **状态**：✅ PASS

### AC-011-02：能力检测失败处理

**Layer 1 技术验证**
- 与 AC-011-01 Layer 1 相同（`getCapabilitiesWithFallback` 测试覆盖）
- 测试用例：`getCapabilitiesWithFallback > returns DEFAULT_MODEL_CAPABILITIES when fn throws`
- **状态**：✅ PASS

**Layer 2 用户视角验证**
- 无效 Provider/Model 时 IPC 抛出错误，renderer 可 catch：`fallback_throws_on_invalid_provider: true`
- 后端 `getCapabilitiesWithFallback` 在内部错误时返回 `DEFAULT_MODEL_CAPABILITIES`（仅含 text_generation，source='default'）
- **状态**：✅ PASS

### AC-011-03：模型能力详情展示

**Layer 1 技术验证（IMPL-017，2026-03-22）**
- **工具**：Bash + Vitest + TypeScript typecheck
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck && npm test
  ```
- **实际输出**：
  ```
  > talor-desktop@0.1.0 typecheck
  (main/preload/renderer 全部通过，exit 0)

  > talor-desktop@0.1.0 test
  ✓ src/renderer/lib/capability-detail.test.ts (10 tests) 2ms
  ✓ src/main/services/capability-detector.test.ts (10 tests) 8ms
  Test Files  2 passed (2)
  Tests  20 passed (20)
  ```
- **状态**：✅ PASS

**Layer 2 用户视角验证（Playwright CDP，2026-03-22）**
- **工具**：Node.js + Playwright CDP（http://localhost:9222）
- **指令**：`node /tmp/verify-impl017-v3.js`
- **实际输出**：
  ```json
  {
    "capability_badges_count": 4,
    "detail_panel_shown": true,
    "detail_text": "文本生成支持自然语言文本的生成、续写、改写和问答对话。•写一篇产品介绍•总结这段文字•翻译以下内容💡在聊天框发送任意文本消息即可测试",
    "test_hint": "💡在聊天框发送任意文本消息即可测试"
  }
  ```
- **AC-011-03 Then 逐项确认**：
  - ✅ 能力 badge 正确渲染（capability_badges_count: 4）
  - ✅ 点击 badge 后详情面板弹出（detail_panel_shown: true）
  - ✅ 详情包含能力描述（"支持自然语言文本的生成..."）
  - ✅ 详情包含使用示例（"写一篇产品介绍" 等）
  - ✅ 提供测试提示 testHint（"在聊天框发送任意文本消息即可测试"）
  - ✅ vision/image_understanding → 描述含"支持分析 PNG、JPEG 格式图片"（Layer 1 vitest 验证）
- **状态**：✅ PASS

### AC-011-04：模型能力手动配置

**Layer 1 技术验证（IMPL-019，2026-03-22）**
- **工具**：Bash + Vitest + TypeScript typecheck
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck && npm test
  ```
- **实际输出**：
  ```
  ✓ src/main/services/capability-updater.test.ts (7 tests) 2ms
  ✓ src/renderer/lib/capability-detail.test.ts (10 tests) 2ms
  ✓ src/main/services/provider-fetcher.test.ts (7 tests) 3ms
  ✓ src/main/services/capability-detector.test.ts (10 tests) 8ms
  Test Files  4 passed (4)
  Tests  34 passed (34)
  ```
- **状态**：✅ PASS

**Layer 2 用户视角验证（Playwright CDP，2026-03-22）**
- **工具**：Node.js + Playwright CDP（http://localhost:9222）
- **指令**：`node /tmp/verify-impl019.js`
- **实际输出**：
  ```json
  {
    "model_id": "ollama/qwen3-coder:480b-cloud",
    "capabilities_count": 2,
    "all_source_manual": true,
    "vision_supported": true,
    "text_supported": true,
    "all_have_detected_at": true,
    "first_cap_source": "manual"
  }
  ```
- **AC-011-04 Then 逐项确认**：
  - ✅ IPC handler 存在并可调用（capabilities_count: 2）
  - ✅ 全部能力标记为 source='manual'（all_source_manual: true）
  - ✅ supports_vision 正确更新（vision_supported: true，因手动设置 image_understanding=true）
  - ✅ 每个能力有 detected_at 时间戳（all_have_detected_at: true）
  - 🔲 前端 UI "手动设置"表单（IMPL-020，P2 延期，当前仅 IPC 端点实现）
- **状态**：✅ PASS（IPC + 数据层）、🔲 前端 UI 待 IMPL-020

### AC-010-04：模型缓存管理

**Layer 1 技术验证（IMPL-018，2026-03-22）**
- **工具**：Bash + Vitest + TypeScript typecheck
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck && npm test
  ```
- **实际输出**：
  ```
  ✓ src/renderer/lib/capability-detail.test.ts (10 tests) 2ms
  ✓ src/main/services/provider-fetcher.test.ts (7 tests) 3ms
  ✓ src/main/services/capability-detector.test.ts (10 tests) 8ms
  Test Files  3 passed (3)
  Tests  27 passed (27)
  ```
- **状态**：✅ PASS

**Layer 2 用户视角验证（Playwright CDP，2026-03-22）**
- **工具**：Node.js + Playwright CDP（http://localhost:9222）
- **指令**：`node /tmp/verify-impl018.js`
- **实际输出**：
  ```json
  {
    "first_from_cache": true,
    "second_from_cache": true,
    "forced_from_cache": false,
    "first_refreshed_at": "2026-03-22T13:07:18.035Z",
    "second_refreshed_at": "2026-03-22T13:07:18.035Z",
    "models_count": 2,
    "has_last_updated_label": true
  }
  ```
- **AC-010-04 Then 逐项确认**：
  - ✅ 5分钟内再次调用使用持久化缓存（first_from_cache: true，second_from_cache: true）
  - ✅ 缓存显示最后更新时间（has_last_updated_label: true，refreshed_at 字段存在）
  - ✅ forceRefresh=true 时强制重新 fetch（forced_from_cache: false）
  - ✅ 缓存数据完整（models_count: 2）
- **状态**：✅ PASS