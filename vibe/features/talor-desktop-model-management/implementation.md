<!--
doc-id: IMPL-talor-model-management
status: draft
version: 1.0
last-updated: 2026-03-22
depends-on: [FD-talor-desktop-model-management]
-->

# IMPLEMENTATION — talor-desktop 模型管理功能实施计划

> 本文档是实施计划 + 进度仪表盘 + 运行时锚点文件。
> 需求见 `requirements.md`。设计见 `feature.md`。项目现状见 `vibe/overviews/OVERVIEW-talor-desktop.md`。

---

## §4.0 实施仪表盘

| 指标 | 当前值 | 目标值 | 状态 |
|------|--------|--------|------|
| **总体进度** | 95% | 100% | 🔄 进行中（Layer 2 人工验证中） |
| **IMPL 完成率** | 20/22 P0+P1 (91%) | 22/22 (100%) | ✅ Phase 1+2+3 P0+P1 编码已完成 |
| **AC 验证率** | Layer 1: 13/13 ✅ \| Layer 2: 10/13 ✅ + 3 🔲 | 全部通过 | 🔲 AC-012-03/04/05 Layer 2 待人工确认 |
| **Phase 进度** | Phase 1: ✅ \| Phase 2: ✅（Quinn — 2026-03-22 签收）\| Phase 3: 🔄 编码完成，待验收 | Phase 3: 100% | 🔄 进行中 |
| **阻塞项** | AC-012-03/04/05 Layer 2 需人工操作 App 验证 | - | 🔲 等待人工确认 |
| **DEFERRED 项** | IMPL-020~022（P2 优化）, IMPL-029~031（P2 优化）| - | 🔄 可选 |

### 需求实施状态表（US 维度）

| US ID | 用户故事 | 关联 IMPL | AC 通过率 | 状态 | 备注 |
|-------|---------|----------|----------|------|------|
| US-010 | 自动检测 Provider 支持的模型列表 | IMPL-001~003 | 4/4 (100%) | ✅ 完成 | AC-010-04 ✅（持久化缓存 IMPL-018 完成） |
| US-011 | 查看模型能力详情 | IMPL-013~022 | 4/4 (100%) | ✅ 完成 | Phase 2 P0+P1 全部 ✅（AC-011-01~04），P2 为可选优化 |
| US-012 | 在会话中选择特定模型 | IMPL-004~008, IMPL-023~028 | 5/5 Layer1 ✅ + 3 🔲 Layer2 | 🔄 编码完成，Layer 2 待人工确认 | AC-012-03/04/05 Layer 2 需人工验证 |

> ⚠️ AC 验证明细不在此展开 → 见各阶段 `phases/phase-N/impl.md §P.3`（双层验证指令 + 证据）

---

## §4.1 Phase 索引

| Phase | 名称 | impl.md 链接 | 状态 | IMPL 完成率 | AC 验证率 |
|-------|------|-------------|------|------------|----------|
| Phase 1 | 模型发现与选择 | [phases/phase-1/impl.md](phases/phase-1/impl.md) | ✅ 完成（已签收） | 7/6 P0+P1 (IMPL-007 ✅) | 5/6 ✅ + 1⚠️ |
| Phase 2 | 能力检测与缓存 | [phases/phase-2/impl.md](phases/phase-2/impl.md) | ✅ 完成（Quinn — 2026-03-22 已签收） | 7/10 P0+P1 ✅（P2 延期） | 5/5 ✅ (100%) |
| Phase 3 | 模型切换与高级功能 | [phases/phase-3/impl.md](phases/phase-3/impl.md) | 🔄 编码完成，Layer 2 待人工确认 | 6/6 P0+P1 ✅ | 3/3 Layer1 ✅ + 3 🔲 Layer2 |

> 说明：IMPL 任务详情、AC 验证映射、Checkpoint 见对应 `phases/phase-N/impl.md`

---

## §4.2 实施规划

### 复杂度快照（来自 Step 2 评估）

| 维度 | 评估 | 得分 |
|------|------|------|
| ① IMPL 任务数 | ~12 个任务（基于 6 接口变更 + 2 状态机） | 3 分 |
| ② 涉及模块 | talor-desktop 主模块 | 1 分 |
| ③ 状态机变更 | 新增 2 个状态机（Provider 模型 + 会话模型） | 2 分 |
| ④ 涟漪影响 | 影响 Provider 配置页面、会话创建、聊天页面等 | 2 分 |
| ⑤ 并发/幂等 | 有并发锁策略和幂等要求 | 1 分 |
| ⑥ 外部依赖 | 依赖 Provider API 可用性，有降级策略 | 1 分 |
| **总分** | **10 分** → 推荐 **3 个 Phase** | |

### Phase 分拆依据

- **Phase 1**（Critical Path）：用户能配置 Provider 并查看模型列表，创建会话时选择模型
- **Phase 2**（错误处理 + 边界 Case）：模型检测失败处理、能力检测、缓存管理
- **Phase 3**（次要功能 + 运营支撑）：模型切换、能力手动配置、高级功能

### 关键路径（Critical Path）

```
用户添加 Provider → 自动检测模型列表 → 查看模型详情 → 创建会话选择模型 → 使用选定模型对话
```

### 阶段计划

#### Phase 1：模型发现与选择
- **用户能力**：配置 Provider 后能看到可用模型列表，创建会话时可以选择特定模型
- **退出标准**：用户添加 Ollama Provider → 看到模型列表（如 qwen3:4b）→ 创建会话选择该模型 → 成功开始对话
- **包含 US**：US-010（核心）、US-012（核心）
- **不包含**：能力检测、错误处理、缓存、模型切换

#### Phase 2：能力检测与缓存
- **用户能力**：查看模型支持的能力（图片、工具调用等），模型列表有缓存减少加载时间
- **退出标准**：用户查看 GPT-4o 模型详情 → 看到支持"图片理解"和"工具调用" → 关闭页面再打开 → 模型列表快速显示（来自缓存）
- **包含 US**：US-011（核心）
- **包含**：错误处理、降级策略、缓存管理

#### Phase 3：模型切换与高级功能
- **用户能力**：在现有会话中切换模型，手动配置模型能力，处理模型不可用情况
- **退出标准**：用户在现有会话中切换模型 → 收到兼容性警告 → 确认后切换成功 → 开始新对话
- **包含 US**：US-012（高级功能）
- **包含**：模型切换、手动配置、兼容性检查

### 进入/退出条件

#### 进入 Phase 1 条件
- [x] requirements.md status ≥ review
- [x] feature.md status ≥ review  
- [x] OVERVIEW-talor-desktop.md 可读
- [x] talor-desktop 项目可编译（`npm run typecheck` 通过）

#### Phase 1 → Phase 2 条件
- [x] Phase 1 所有 P0 IMPL 完成（100%）
- [x] Phase 1 AC 验证通过（4✅/1⚠️/1❌，人类审核者已接受）
- [x] Phase 1 certificate.md 填写完成（status: approved）
- [x] 无阻塞项

#### Phase 2 → Phase 3 条件
- [x] Phase 2 所有 IMPL 完成（100%）
- [x] Phase 2 所有 AC 验证通过（100%）
- [x] Phase 2 certificate.md 填写完成（status: approved，Quinn — 2026-03-22 签收）
- [x] 无阻塞项

#### Phase 3 完成条件
- [ ] Phase 3 所有 IMPL 完成（100%）
- [ ] Phase 3 所有 AC 验证通过（100%）
- [ ] Phase 3 certificate.md 填写完成
- [ ] 所有 US 状态为 ✅ 完成

### Shippable Increment 表

| Phase | 可交付增量 | 用户价值 |
|-------|-----------|---------|
| Phase 1 | 1. Provider 模型列表自动检测<br>2. 模型列表手动刷新<br>3. 新会话模型选择器<br>4. 会话模型绑定 | 用户不再需要猜测可用模型，可以针对任务选择合适模型 |
| Phase 2 | 1. 模型能力自动检测<br>2. 能力检测失败处理<br>3. 模型缓存管理<br>4. 模型详情展示 | 用户了解模型能力特性，减少等待时间（缓存），处理检测失败 |
| Phase 3 | 1. 现有会话模型切换<br>2. 模型不可用处理<br>3. 模型能力手动配置<br>4. 模型与附件兼容性检查 | 用户灵活切换模型，处理异常情况，手动纠正错误检测 |

### 桩代码与占位符禁令

**禁止以下占位符模式**：
- ❌ `// TODO: implement` 在 Critical Path 函数中
- ❌ 返回空数组/空对象代替真实数据
- ❌ 硬编码测试数据通过验证
- ❌ 忽略错误处理（空 catch 块）

**要求**：
- ✅ 每个接口有完整的类型定义
- ✅ 错误处理覆盖所有已知失败场景
- ✅ 验证使用真实 Provider API 调用
- ✅ 缓存逻辑有明确的失效策略

---

## §4.3 已知陷阱列表（Gotchas）

| ⚠️ 陷阱描述 | 正确做法 | 关联文档 |
|------------|---------|---------|
| Provider API 可能不支持模型列表查询 | 降级方案：提示用户手动输入，提供常见模型预设 | requirements.md §1.7 降级策略 |
| 能力检测可能触发 API 速率限制 | 实现分批检测，添加延迟，缓存检测结果 | feature.md §F.5 重试机制 |
| 模型缓存导致信息过时 | TTL 缓存（5分钟）+ 强制刷新按钮 + 过期标记 | feature.md §F.2 新增 ADR-012 |
| 模型切换导致会话历史不兼容 | 切换时提示"开始新对话"，清空历史或创建新会话 | requirements.md US-012 边界 Case |
| 不同 Provider 的模型 ID 格式不一致 | 统一格式化：`provider_id/model_name`，存储原始 ID | feature.md §F.2 Schema 变更 |
| 能力检测结果可能随时间变化 | 记录检测时间戳，定期重新检测，用户可手动刷新 | feature.md ModelCapability.detected_at |
| 前端模型选择器性能问题（模型数量多） | 虚拟滚动、搜索过滤、分页加载 | 无特定文档，通用性能优化 |
| 页面布局破坏现有设计一致性 | 严格遵循现有布局模式，复用现有组件样式 | requirements.md §1.5.1 页面设计规范 |
| 模型卡片信息过载导致可读性差 | 分层展示信息，默认显示核心信息，详情可展开 | feature.md §F.8 ModelCard 组件设计 |
| 模型选择器交互复杂度过高 | 渐进式披露，默认简单选择，高级功能可展开 | feature.md §F.8 ModelSelector 交互设计 |
| 响应式设计适配不完整 | 定义明确断点，每个组件都有响应式规则 | feature.md §F.8 响应式设计规范 |
| 无障碍访问支持缺失 | 实现完整键盘导航、ARIA标签、屏幕阅读器支持 | feature.md §F.8 无障碍设计 |
| 颜色对比度不足影响可访问性 | 使用WCAG标准检查工具，确保对比度达标 | feature.md §F.8 颜色对比度要求 |
| 加载状态反馈不明确 | 区分短/长/超时加载，提供取消选项 | requirements.md §1.5.1 加载状态设计 |

---

## §4.4 发布清单

### 配置项变更
- [ ] Provider 配置 Schema 新增 `models`, `models_last_updated`, `models_cache_ttl` 字段
- [ ] 默认缓存 TTL 配置：300 秒（5分钟）
- [ ] 能力检测超时配置：10 秒

### 数据库变更
- [ ] sessions 表新增 `model_id` 字段（可为 NULL）
- [ ] 数据迁移：现有会话 `model_id` 设置为 NULL
- [ ] 新增索引：`sessions(model_id)` 用于查询

### 实验开关
- [ ] 功能开关：`features.model_management`（默认 true）
- [ ] 能力检测开关：`features.capability_detection`（默认 true）
- [ ] 缓存开关：`features.model_cache`（默认 true）

### 中间件/服务
- [ ] 无新增外部服务依赖
- [ ] 增强现有 Provider 连接测试服务

### 监控指标
- [ ] 模型检测成功率
- [ ] 能力检测平均耗时
- [ ] 缓存命中率
- [ ] 模型切换频率

### 回滚方案
1. **代码回滚**： revert 相关 commit，保持数据库兼容性（新增字段可为 NULL）
2. **数据回滚**：无需特殊处理，新增字段可保留
3. **配置回滚**：移除新增配置项，使用默认值

### 迭代归档协议
Phase 3 完成后执行：
1. [ ] 调用 `klook-vibe-overview`（archive mode）将 FEATURE delta 合并到 OVERVIEW
2. [ ] 更新 `.claude.md` §5/§6/§7 与更新后的 OVERVIEW 一致
3. [ ] `feature.md` status 改为 `archived`
4. [ ] 本清单中"更新 OVERVIEW"项勾选

---

## §4.5 范围外功能（Deferred Backlog）

详见 [`deferred.md`](deferred.md)。

---

## §4.6 统一变更日志

| 日期 | 版本 | 变更描述 | 变更人 |
|------|------|---------|--------|
| 2026-03-22 | 1.0 | 初始创建：L4 IMPLEMENTATION 文档 | AI Agent |
| 2026-03-22 | 1.0 | 创建 Phase 1-3 子文档结构 | AI Agent |
| 2026-03-22 | 1.1 | Phase 1 完成，§4.0 仪表盘更新，Phase 1→2 进入条件勾选 | AI Agent |
| 2026-03-22 | 1.2 | Bug fix: llm-provider.ts model_id 前缀剥离（Ollama 404 Not Found 修复），E2E 全流程验证通过 | AI Agent |
| 2026-03-22 | 1.3 | Phase 2 完成（Quinn 签收）：§4.0 仪表盘更新，Phase 2→3 进入条件全部勾选，Phase 2 session-start.md 补全 | AI Agent |

---

## §4.6b 复杂度校准（Phase 1 → Phase 2）

> **必须在 Phase 1 完成后执行（klook-vibe-code §3d 要求）**

| 维度 | 估算值 | 实际值 | 偏差 |
|------|--------|--------|------|
| Phase 1 IMPL 任务数（P0） | 6 个 | 6 个 | 0% |
| Phase 1 IMPL 任务数（含 P1+P2） | 12 个（估算） | 16 个（规划） | +33% |
| Phase 1 耗时 | 14h（估算） | 实测未记录 | N/A |
| Phase 1 AC 全通过率 | 100% | 66%（4/6，1⚠️1❌接受） | -34% |

**校准结论**：
- P0 任务估算准确（6/6）
- 总 IMPL 数 16 > 估算 12（+33%），超过 30% 偏差阈值
- 主要原因：P1/P2 任务（ModelSelector、ModelStatusBadge、缓存优化）在初期被低估
- **建议**：Phase 2 和 Phase 3 的 IMPL 数量可能也存在低估，建议在 Phase 2 开始前重新评估任务拆分粒度
- **Phase 2 调整**：当前估算 10 个任务（4P0+3P1+3P2），考虑 +30% 缓冲，实际可能 12-13 个任务