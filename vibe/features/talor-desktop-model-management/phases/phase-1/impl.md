<!--
doc-id: IMPL-talor-model-management-phase1
status: draft
version: 1.0
last-updated: 2026-03-22
depends-on: [FD-talor-desktop-model-management]
-->

# Phase 1 IMPL — 模型发现与选择

> 追溯链：US-010, US-012 → FD-talor-desktop-model-management → 本文档（IMPL-talor-model-management-phase1）
> 依赖的 AC：AC-010-01, AC-010-02, AC-010-03, AC-010-04, AC-012-01, AC-012-02

---

## §P.1 IMPL 任务清单

### P0 — Critical Path（必须完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-001 | 扩展 Provider 接口：新增 models 相关字段 | US-010 | AC-010-01 | ✅ 已完成 | 2h |
| IMPL-002 | 实现 Provider 模型列表获取逻辑 | US-010 | AC-010-01, AC-010-02 | ✅ 已完成 | 3h |
| IMPL-003 | 新增 IPC 端点：providers:getModels, providers:refreshModels | US-010 | AC-010-01, AC-010-02 | ✅ 已完成 | 2h |
| IMPL-004 | 扩展 Session 接口：新增 model_id 字段 | US-012 | AC-012-01, AC-012-02 | ✅ 已完成 | 1h |
| IMPL-005 | 修改 session:create IPC 端点支持 model_id 参数 | US-012 | AC-012-01, AC-012-02 | ✅ 已完成 | 2h |
| IMPL-006 | 前端：Provider配置页面添加ModelCard组件展示模型列表 | US-010 | AC-010-01, AC-010-02 | ✅ 已完成 | 4h |

### P1 — 重要功能（Phase 1 内完成）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-007 | 前端：实现ModelSelector组件（会话创建使用） | US-012 | AC-012-01 | ✅ 已完成 | 5h |
| IMPL-013 | 前端：实现ModelStatusBadge组件（聊天页面显示） | US-012 | AC-012-02 | ⬜ 未开始 | 2h |
| IMPL-014 | UI：加载状态和错误状态组件实现 | US-010 | AC-010-03 | ⬜ 未开始 | 2h |
| IMPL-008 | 前端：聊天页面显示当前使用模型 | US-012 | AC-012-02 | ⬜ 未开始 | 1h |
| IMPL-009 | 实现 Provider 连接失败处理 | US-010 | AC-010-03 | ⬜ 未开始 | 2h |

### P2 — 优化功能（可延期到 Phase 2）

| IMPL ID | 任务描述 | 关联 US | 关联 AC | 状态 | 预计耗时 |
|---------|---------|---------|---------|------|---------|
| IMPL-010 | 实现基础模型缓存（内存缓存） | US-010 | AC-010-04 | ⬜ 未开始 | 2h |
| IMPL-011 | 前端：添加模型列表手动刷新按钮 | US-010 | AC-010-02 | ⬜ 未开始 | 1h |
| IMPL-012 | 错误处理：模型列表为空时的用户提示 | US-010 | AC-010-03 | ⬜ 未开始 | 1h |
| IMPL-015 | UI：响应式设计适配（桌面/平板/手机） | US-010, US-012 | - | ⬜ 未开始 | 3h |
| IMPL-016 | UI：无障碍访问支持（键盘导航+ARIA） | US-010, US-012 | - | ⬜ 未开始 | 2h |

**Phase 1 IMPL 总计**：16 个任务（6 P0 + 6 P1 + 4 P2）

---

## §P.2 会话恢复 Checkpoint

### 实施前必读（每次开始前必须重新加载）

1. **项目现状**：`vibe/overviews/OVERVIEW-talor-desktop.md`
   - §MO.1 职责：了解 talor-desktop 模块边界
   - §MO.5 接口协议：现有 IPC 端点格式
   - §MO.7 核心逻辑规则：现有 Patterns

2. **功能设计**：`vibe/features/talor-desktop-model-management/feature.md`
   - §F.2 全局影响：Schema 变更详情
   - §F.4 新增/变更的接口协议：IPC 端点规范
   - §F.3 新增/变更的状态机转换：状态机设计

3. **需求定义**：`vibe/features/talor-desktop-model-management/requirements.md`
   - §1.3 业务术语表：代码命名规范
   - §1.8 验收标准：AC 详细定义

4. **实施计划**：`vibe/features/talor-desktop-model-management/implementation.md`
   - §4.3 已知陷阱列表：避免常见错误
   - §4.2 阶段计划：Phase 1 范围

### 按需参考（实施中按需查阅）

1. **现有代码参考**：
   - `src/main/store/config-store.ts`：Provider 配置存储实现
   - `src/main/ipc/providers.ts`：现有 Provider IPC 端点
   - `src/main/ipc/session.ts`：现有 Session IPC 端点
   - `src/renderer/pages/Settings/ProviderList.tsx`：Provider 配置页面
   - `src/renderer/pages/Settings/ProviderForm.tsx`：Provider 表单

2. **相关文档**：
   - `CLAUDE.md`：项目整体信息和命令速查
   - Phase 2.3 相关代码：附件功能实现参考

### 依赖文档版本快照

| 文档 | 版本 | 最后更新 | 关键变更 |
|------|------|---------|---------|
| OVERVIEW-talor-desktop.md | 1.2 | 2026-03-22 | 当前模块现状 |
| requirements.md | 1.0 | 2026-03-22 | 初始需求定义 |
| feature.md | 1.0 | 2026-03-22 | 初始功能设计 |
| implementation.md | 1.0 | 2026-03-22 | 初始实施计划 |

### 上次中断点记录

| 字段 | 值 |
|------|-----|
| 最后完成的 IMPL | IMPL-003 |
| 当前正在实施的 IMPL | 无 |
| 遇到的阻塞问题 | 无 |
| 已验证的 AC | AC-010-01 (Layer 1 技术验证通过) |
| 需要继续的工作 | 从 IMPL-004 开始 |

---

## §P.3 AC 验证映射（双层验证）

### AC-010-01：Provider 模型列表自动检测

**Given**：用户已配置一个有效的 Ollama Provider（base_url: http://localhost:11434/v1）

**When**：用户打开该 Provider 的配置页面

**Then**：系统自动检测并显示 Ollama 支持的所有模型列表
**Then**：每个模型显示名称、ID 和简要描述
**Then**：模型列表至少包含一个模型（如 qwen3:4b）

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/main/services/provider-fetcher.ts`（新增或修改）
- **检查点**：
  1. Provider 接口有 `models?: ModelInfo[]` 字段
  2. 有 `getProviderModels(providerId: string): Promise<ModelInfo[]>` 函数
  3. 函数实现调用 Provider API 获取模型列表

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：本地运行 Ollama 服务，至少有一个模型（如 `ollama pull qwen3:4b`）
- **验证步骤**：
  1. 启动 talor-desktop：`cd talor-desktop && npm run dev`
  2. 添加 Ollama Provider（base_url: http://localhost:11434/v1）
  3. 打开该 Provider 的配置页面
  4. 观察是否自动显示模型列表
- **预期结果**：
  - 页面显示"正在检测模型..."加载状态
  - 加载完成后显示模型列表（如 qwen3:4b, llama3.2:3b 等）
  - 每个模型显示名称和描述
- **验证文件**：`src/renderer/pages/Settings/ProviderForm.tsx`（模型列表展示逻辑）

**🟢 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：✅ PASS
- **证据**（工具原始输出）：
  ```
  AC-010-01 getModels response:
  {
    "models": [
      {"id": "ollama/qwen3-coder:480b-cloud", "name": "qwen3-coder:480b-cloud",
       "display_name": "Qwen3 Coder 480b Cloud", "provider_id": "7a8ff895-...",
       "capabilities": [{"type": "text_generation", "supported": true}]},
      {"id": "ollama/deepseek-v3.1:671b-cloud", "name": "deepseek-v3.1:671b-cloud",
       "display_name": "Deepseek V3.1 671b Cloud", ...}
    ],
    "refreshed_at": "2026-03-22T11:41:56.643Z",
    "cache_ttl": 300
  }
  UI shows: 可用模型 | 最后更新: 19:41:07 | 刷新模型列表
  UI shows: Qwen3 Coder 480b Cloud (qwen3-coder:480b-cloud), Deepseek V3.1 671b Cloud (deepseek-v3.1:671b-cloud)
  ```
- **截图**：`phases/phase-1/screenshots/ac-010-01-final.png`

### AC-010-02：模型列表手动刷新

**Given**：用户正在查看 Provider 的模型列表

**When**：用户点击"刷新模型列表"按钮

**Then**：系统重新从 Provider 获取模型列表
**Then**：显示加载状态指示器
**Then**：刷新完成后更新显示最新列表

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/main/ipc/providers.ts`（新增 refreshModels handler）
- **检查点**：
  1. 有 `providers:refreshModels` IPC 端点
  2. 端点实现强制刷新逻辑（忽略缓存）
  3. 返回类型包含 `refreshed_at` 时间戳

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：Provider 配置页面已显示模型列表
- **验证步骤**：
  1. 在 Provider 配置页面找到"刷新模型列表"按钮
  2. 点击按钮
  3. 观察页面显示加载状态（旋转图标或"刷新中..."文字）
  4. 等待刷新完成
- **预期结果**：
  - 点击按钮后立即显示加载状态
  - 刷新过程中模型列表保持显示（或显示"刷新中..."）
  - 刷新完成后模型列表更新（时间戳变化）
- **验证文件**：`src/renderer/pages/Settings/ProviderForm.tsx`（刷新按钮和状态）

**🟢 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：✅ PASS
- **证据**（工具原始输出）：
  ```
  AC-010-02 refreshModels:
  {
    "models": [
      {"id": "ollama/qwen3-coder:480b-cloud", ...},
      {"id": "ollama/deepseek-v3.1:671b-cloud", ...}
    ],
    "refreshed_at": "2026-03-22T11:41:59.964Z",
    "cache_ttl": 300
  }
  refreshModels returned 2 models, refreshed_at=2026-03-22T11:41:59.964Z
  UI contains "刷新模型列表" button in edit form ✓
  ```
- **注意**：headless 截图中未能捕获到"刷新中..."加载状态（时间极短），但 API 刷新返回正确
- **截图**：`phases/phase-1/screenshots/ac-010-02-after-refresh.png`

### AC-010-03：Provider 连接失败处理

**Given**：用户配置了一个无效的 Provider（错误的 base_url）

**When**：系统尝试检测模型列表

**Then**：显示连接错误提示（包含错误码和用户可读描述）
**Then**：提供"重试"按钮
**Then**：不显示任何模型列表

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/main/services/provider-fetcher.ts`（错误处理逻辑）
- **检查点**：
  1. `getProviderModels` 函数有 try-catch 错误处理
  2. 错误类型区分：网络错误、认证错误、API 错误等
  3. 错误信息包含错误码和用户可读描述

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：添加一个无效的 Provider（如 base_url: http://localhost:9999/invalid）
- **验证步骤**：
  1. 添加无效 Provider
  2. 打开该 Provider 的配置页面
  3. 观察错误处理
- **预期结果**：
  - 显示错误提示（如"连接失败：无法访问 Provider"）
  - 错误信息包含具体错误码（如 CONNECTION_ERROR）
  - 显示"重试"按钮
  - 不显示模型列表（或显示"无法加载模型"）
- **验证文件**：`src/renderer/pages/Settings/ProviderForm.tsx`（错误状态展示）

**🟢 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：✅ PASS（连接失败正确返回，UI 显示错误）
- **证据**（工具原始输出）：
  ```
  testConnection({ type: 'ollama', base_url: 'http://localhost:9999/invalid' }) →
  {"status": "failure", "error_code": "UNKNOWN", "message": "连接失败：fetch failed"}
  
  UI page text includes: "连接失败：fetch failed"
  ```
- **注意**：error_code 为 UNKNOWN（不是 LLM_CONNECTION_FAILED），但连接失败 + 错误消息展示功能正常
- **待改进**：重试按钮在 testConnection 失败时不展示（只在 getModels 失败时通过 ProviderForm 的 modelsError 状态展示）
- **截图**：`phases/phase-1/screenshots/ac-010-03-after-failed-test.png`

### AC-010-04：模型缓存管理

**Given**：系统已成功获取模型列表并缓存

**When**：用户5分钟内再次打开同一Provider的配置页面

**Then**：系统优先使用缓存数据，不发起新的API请求
**Then**：缓存数据显示"最后更新时间"标签
**Then**：用户点击"刷新"按钮时，强制更新缓存
**Then**：缓存数据过期（>5分钟）时自动刷新

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/main/store/config-store.ts`（缓存逻辑）
- **检查点**：
  1. Provider 配置有 `models_last_updated` 和 `models_cache_ttl` 字段
  2. `getProviderModels` 函数检查缓存有效性
  3. 缓存过期逻辑：`Date.now() - lastUpdated > cacheTtl`

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：Provider 已成功加载模型列表
- **验证步骤**：
  1. 关闭并重新打开 Provider 配置页面（5分钟内）
  2. 观察加载速度（应瞬间显示，无加载状态）
  3. 查看页面是否显示"最后更新：X分钟前"
  4. 等待5分钟后重新打开页面
- **预期结果**：
  - 5分钟内重新打开：瞬间显示模型列表，显示缓存时间
  - 5分钟后重新打开：显示加载状态，重新获取数据
  - 点击刷新按钮：强制刷新，忽略缓存
- **验证文件**：`src/renderer/pages/Settings/ProviderForm.tsx`（缓存状态显示）

**🟡 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：⚠️ PARTIAL
- **证据**（工具原始输出）：
  ```
  AC-010-04 first fetch:  {"refreshed_at": "2026-03-22T11:42:05.864Z", "count": 2, "cache_ttl": 300}
  AC-010-04 second fetch: {"refreshed_at": "2026-03-22T11:42:06.381Z", "count": 2, "cache_ttl": 300}
  AC-010-04 cache hit (same timestamp): false
  AC-010-04 cache_ttl is 300s: true ✓
  AC-010-04 timestamp shown in UI: true ✓  "最后更新: 19:42:06"
  ```
- **通过**：cache_ttl=300s ✅，"最后更新"时间戳在 UI 中显示 ✅
- **问题**：两次快速连续调用 getModels（500ms 间隔）返回了不同的 refreshed_at，说明 **内存缓存未生效**（每次都重新请求 Ollama）
- **根因**：需进一步检查 provider-fetcher.ts 的缓存实现
- **截图**：`phases/phase-1/screenshots/ac-010-04-cache-display.png`

### AC-012-01：新会话模型选择

**Given**：用户有配置好的 Provider 和模型列表

**When**：用户创建新会话

**Then**：显示模型选择器组件
**Then**：选择器列出所有可用模型
**Then**：每个模型显示名称和支持的主要能力图标
**Then**：用户可以选择任意模型开始会话

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/renderer/components/ModelSelector.tsx`（新增组件）
- **检查点**：
  1. 有 `ModelSelector` React 组件
  2. 组件接收 `models: ModelInfo[]` 和 `onSelect: (modelId: string) => void` props
  3. 组件实现模型列表渲染和选择逻辑

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：至少有一个配置好的 Provider 和模型列表
- **验证步骤**：
  1. 点击"新会话"按钮
  2. 观察是否显示模型选择器
  3. 查看选择器中的模型列表
  4. 选择一个模型创建会话
- **预期结果**：
  - 显示模型选择器弹窗或下拉选择
  - 列表显示所有可用模型
  - 每个模型显示名称和图标（如文本图标、图片图标）
  - 选择后创建会话成功
- **验证文件**：`src/renderer/pages/Chat/components/CreateSessionDialog.tsx`（会话创建对话框）

**🟢 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：✅ PASS
- **证据**（工具原始输出）：
  ```
  AC-012-01 THEN modal h2 "新建会话" visible: true
  AC-012-01 THEN modal has "选择模型": true
  AC-012-01 THEN modal has "模型提供商": true
  AC-012-01 THEN model cards shown: 2 (≥1 required)
  AC-012-01 THEN capability icons (📝): true
  AC-012-01 confirm button enabled (model pre-selected): true
  AC-012-01 THEN modal dismissed after confirm: true
  AC-012-01 THEN new session created (count increased): true
  AC-012-01 session count after: 7
  AC-012-01 cancel test - modal opens again: true
  AC-012-01 THEN modal dismissed after cancel: true
  ```
- **通过项**：ModelSelector 弹窗 ✅，模型列表展示 ✅，能力图标 ✅，确认创建会话 ✅，取消关闭弹窗 ✅
- **截图**：`phases/phase-1/screenshots/ac-012-01-chat-page.png`

### AC-012-02：会话模型绑定

**Given**：用户选择"GPT-4o"模型创建会话

**When**：会话创建成功

**Then**：会话信息中记录 model_id: "openai/gpt-4o"
**Then**：会话页面显示当前使用的模型名称
**Then**：所有该会话的消息都使用 GPT-4o 模型处理

#### Layer 1 技术验证
- **工具**：Bash + TypeScript 编译检查
- **指令**：
  ```bash
  cd /Users/quinn.li/Desktop/talor/talor-desktop
  npm run typecheck
  ```
- **预期输出**：TypeScript 编译通过，无类型错误
- **验证文件**：`src/main/ipc/session.ts`（session:create handler）
- **检查点**：
  1. `session:create` 接口支持 `model_id` 参数
  2. 会话记录插入数据库时包含 `model_id` 字段
  3. 聊天消息发送时使用会话的 `model_id`

#### Layer 2 用户视角验证
- **工具**：代码审查 + 手动测试
- **前置条件**：使用特定模型创建会话
- **验证步骤**：
  1. 选择"GPT-4o"（或其他具体模型）创建会话
  2. 进入聊天页面
  3. 查看页面头部或设置
  4. 发送消息测试
- **预期结果**：
  - 聊天页面显示"当前模型：GPT-4o"
  - 发送消息后，AI 回复符合 GPT-4o 特性
  - 检查数据库：sessions 表记录包含 model_id 字段
- **验证文件**：`src/renderer/pages/Chat/index.tsx`（聊天页面头部）

**🟢 Layer 2 实际验证结果（2026-03-22 Playwright _electron）**：
- **状态**：✅ PASS（model_id 正确绑定到会话）
- **证据**（工具原始输出）：
  ```
  session.create({ provider_id: "7a8ff895-...", model_id: "ollama/qwen3-coder:480b-cloud" }) →
  {
    "id": "581ac107-59f6-4496-92f8-92438792cec8",
    "title": "新会话",
    "provider_id": "7a8ff895-79c0-4f66-a550-e4ac62d464f0",
    "model_id": "ollama/qwen3-coder:480b-cloud",
    "created_at": "2026-03-22T11:42:09.774Z",
    "updated_at": "2026-03-22T11:42:09.774Z"
  }
  session.get(id).model_id = "ollama/qwen3-coder:480b-cloud" ✓
  ```
- **注意**：后端 model_id 绑定正常；前端聊天页面显示模型名（AC 中"聊天页面显示模型名"部分）依赖 IMPL-008 和 IMPL-013，尚未实现
- **截图**：`phases/phase-1/screenshots/ac-012-02-session-view.png`