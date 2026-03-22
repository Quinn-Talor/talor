# Phase 1 会话启动检查清单

> 每次开始 Phase 1 编码会话前，必须完成此 6 步检查。
> 检查通过后方可开始实施 IMPL 任务。

---

## Step 1：环境就绪检查

### 1.1 项目路径确认
- [ ] **工作目录**：`/Users/quinn.li/Desktop/talor`
- [ ] **目标模块**：`talor-desktop/`（Electron 桌面客户端）
- [ ] **验证命令**：
  ```bash
  pwd  # 应输出 /Users/quinn.li/Desktop/talor
  ls talor-desktop/package.json  # 文件应存在
  ```

### 1.2 开发环境就绪
- [ ] **Node.js 版本**：≥ 20.x
  ```bash
  node --version
  ```
- [ ] **npm 可用**：
  ```bash
  npm --version
  ```
- [ ] **TypeScript 编译检查**：
  ```bash
  cd talor-desktop && npm run typecheck
  ```
  > 预期：编译通过，无类型错误（允许现有警告）

### 1.3 运行时依赖
- [ ] **Ollama 服务**（可选，用于测试）：
  ```bash
  curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "models" && echo "Ollama running" || echo "Ollama not running (optional)"
  ```
- [ ] **数据库文件**：
  ```bash
  ls ~/.talor/chat.db 2>/dev/null || echo "DB will be created on first run"
  ```

---

## Step 2：文档版本同步

### 2.1 依赖文档状态检查
| 文档 | 预期状态 | 实际状态 | 检查 |
|------|---------|---------|------|
| OVERVIEW-talor-desktop.md | active | [填写] | [ ] |
| requirements.md | review | [填写] | [ ] |
| feature.md | review | [填写] | [ ] |
| implementation.md | draft | [填写] | [ ] |

**检查命令**：
```bash
grep -n "status:" vibe/overviews/OVERVIEW-talor-desktop.md
grep -n "status:" vibe/features/talor-desktop-model-management/requirements.md
grep -n "status:" vibe/features/talor-desktop-model-management/feature.md
grep -n "status:" vibe/features/talor-desktop-model-management/implementation.md
```

### 2.2 关键变更确认
- [ ] **Schema 变更**：feature.md §F.2 中的接口变更已理解
- [ ] **状态机变更**：feature.md §F.3 中的状态机设计已理解
- [ ] **AC 范围**：requirements.md §1.8 中 Phase 1 相关 AC 已阅读
- [ ] **IMPL 任务**：impl.md §P.1 中 Phase 1 任务列表已理解

---

## Step 3：实施边界确认

### 3.1 Phase 1 范围（必须实现）
- [ ] Provider 模型列表自动检测（US-010 核心）
- [ ] 新会话模型选择（US-012 核心）
- [ ] 基础错误处理（连接失败）

### 3.2 Phase 1 排除范围（不得实现）
- [ ] 模型能力检测（Phase 2）
- [ ] 高级缓存管理（Phase 2）
- [ ] 现有会话模型切换（Phase 3）
- [ ] 能力手动配置（Phase 3）

### 3.3 技术约束
- [ ] **不修改 Python 后端**：全部在 Electron 前端实现
- [ ] **保持向后兼容**：新增字段可选，现有数据可迁移
- [ ] **遵循现有 Patterns**：参考 OVERVIEW-talor-desktop.md §MO.7

---

## Step 4：命名一致性检查

### 4.1 术语表引用
> 必须使用 requirements.md §1.3 中的代码命名

| 术语 | 代码命名 | 使用场景 |
|------|---------|---------|
| 模型列表 | `modelList` / `ModelList` | 变量、类型定义 |
| 模型信息 | `modelInfo` / `ModelInfo` | 接口、函数参数 |
| 模型选择器 | `modelSelector` | 组件名称 |
| 会话模型 | `sessionModel` | 会话属性 |

### 4.2 禁止使用的命名
- ❌ `modelCatalog`（应使用 `modelList`）
- ❌ `modelConfig`（应使用 `modelInfo`）
- ❌ `conversationModel`（应使用 `sessionModel`）

### 4.3 文件命名约定
- 新增组件：`ModelSelector.tsx`
- 新增服务：`provider-fetcher.ts`（已存在，扩展）
- 新增类型：`src/main/types/models.ts`

---

## Step 5：验证环境准备

### 5.1 Layer 1 验证工具
- [ ] **TypeScript 编译**：`npm run typecheck`
- [ ] **测试运行**：`npm test`（如果存在）
- [ ] **代码检查**：ESLint 配置确认

### 5.2 Layer 2 验证准备
- [ ] **测试 Provider**：Ollama 本地服务或有效 API Provider
- [ ] **测试数据**：至少一个可用模型（如 qwen3:4b）
- [ ] **验证步骤**：记录在 impl.md §P.3 中

### 5.3 MCP Chrome 环境准备（本阶段不适用）
- [ ] **不适用**：Phase 1 不涉及浏览器自动化测试

---

## Step 6：会话目标设定

### 6.1 本次会话目标 IMPL
- [ ] **主要目标**：IMPL-001 至 IMPL-003（Provider 模型接口）
- [ ] **次要目标**：IMPL-004 至 IMPL-006（Session 接口扩展）
- [ ] **验收目标**：AC-010-01, AC-010-02, AC-012-01

### 6.2 退出条件
- [ ] **代码完成**：目标 IMPL 代码编写完成
- [ ] **编译通过**：`npm run typecheck` 无错误
- [ ] **AC 验证**：至少完成 Layer 1 技术验证
- [ ] **文档更新**：IMPL 状态更新，遇到的问题记录

### 6.3 风险与应对
| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| Provider API 不兼容 | 中 | 高 | 降级方案：使用预设模型列表 |
| 类型定义冲突 | 低 | 中 | 参考现有 Patterns，保持兼容 |
| 前端组件性能 | 低 | 低 | 虚拟滚动，分页加载 |

---

## 检查完成确认

**检查人**：AI Agent  
**检查时间**：YYYY-MM-DD HH:MM  
**检查结果**：✅ 通过 / ❌ 不通过  

**备注**：
- [ ] 所有 Step 1-5 检查项已完成
- [ ] 文档版本已同步
- [ ] 实施边界清晰
- [ ] 验证环境就绪

**下一步**：开始实施 IMPL-001