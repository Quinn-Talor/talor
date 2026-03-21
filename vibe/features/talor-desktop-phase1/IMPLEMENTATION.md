<!--
doc-id: IMPL-talor-phase1
status: completed
version: 1.1
last-updated: 2026-03-21
depends-on: [FD-talor-phase1]
-->

# Talor Phase 1 实施文档

> AI 实施者执行参考。**每次会话开始前必须读 §4.0 实施仪表盘和 §4.1 实施锚点**，结束时更新。
> 产品需求见 `REQUIREMENTS.md`。功能设计见 `FEATURE-talor-phase1.md`。

---

## 4.0 实施仪表盘

### 总体进度

| 指标 | 当前值 | 说明 |
|------|--------|------|
| IMPL 完成率 | 10/10 (100%) | IMPL-001 ~ IMPL-010 全部完成 |
| AC 验证率 | 20/20 (100%) | AC-001-01 ~ AC-004-08 全部手动验证通过 |
| Phase 进度 | Phase 1/1 | 客户端框架 + Provider 配置 CRUD |
| 阻塞项 | 0 | — |
| DEFERRED 项 | 0 pending | 见 DEFERRED 文件 |

### AC 验证明细

| AC ID | 状态 | 验证方式 | 验证日期 | 关联 IMPL |
|-------|------|---------|---------|----------|
| AC-001-01 | ✅ 已验证 | 手动：双击应用图标，计时 3 秒内显示主界面 | 2026-03-21 | IMPL-001, IMPL-002 |
| AC-001-02 | ✅ 已验证 | 手动：启动前删除 ~/.talor/，观察自动创建 | 2026-03-21 | IMPL-003 |
| AC-001-03 | ✅ 已验证 | 手动：拖动窗口后关闭再打开，尺寸位置恢复 | 2026-03-21 | IMPL-002 |
| AC-001-04 | ✅ 已验证 | 手动：损坏 config.json 后启动，观察警告横幅 | 2026-03-21 | IMPL-003 |
| AC-001-05 | ✅ 已验证 | 手动：启动后再次双击应用图标，观察窗口聚焦 | 2026-03-21 | IMPL-002 |
| AC-002-01 | ✅ 已验证 | 手动：选择 ollama，验证 base_url 预填充 | 2026-03-21 | IMPL-008 |
| AC-002-02 | ✅ 已验证 | 手动：name 留空保存，验证阻断 | 2026-03-21 | IMPL-008 |
| AC-002-03 | ✅ 已验证 | 手动：填写 `ftp://` 保存，验证 URL 格式错误提示 | 2026-03-21 | IMPL-008 |
| AC-002-04 | ✅ 已验证 | 手动：openai 不填 api_key 保存，验证阻断 | 2026-03-21 | IMPL-008 |
| AC-002-05 | ✅ 已验证 | 手动：填写重复 name，验证阻断 | 2026-03-21 | IMPL-008 |
| AC-002-06 | ✅ 已验证 | 手动：填写合法信息保存，验证列表更新 + 提示 | 2026-03-21 | IMPL-007, IMPL-008 |
| AC-002-07 | ✅ 已验证 | 手动：重启应用，验证配置保留 | 2026-03-21 | IMPL-003 |
| AC-003-01 | ✅ 已验证 | 手动：点击编辑，验证表单预填充 | 2026-03-21 | IMPL-008 |
| AC-003-02 | ✅ 已验证 | 手动：编辑时填重复 name，验证阻断 | 2026-03-21 | IMPL-008 |
| AC-003-03 | ✅ 已验证 | 手动：点击删除，验证二次确认对话框 | 2026-03-21 | IMPL-009 |
| AC-003-04 | ✅ 已验证 | 手动：对话框点取消，验证无变化 | 2026-03-21 | IMPL-009 |
| AC-003-05 | ✅ 已验证 | 手动：对话框点确认，验证从列表和配置文件移除 | 2026-03-21 | IMPL-009 |
| AC-003-06 | ✅ 已验证 | 手动：点击设为默认，验证标签切换 | 2026-03-21 | IMPL-005, IMPL-007 |
| AC-003-07 | ✅ 已验证 | 手动：仅有一个 Provider 时设默认，重启验证 | 2026-03-21 | IMPL-003 |
| AC-003-08 | ✅ 已验证 | 手动：编辑时按 Esc，验证表单关闭不保存 | 2026-03-21 | IMPL-008 |
| AC-004-01 | ✅ 已验证 | 手动：填写 base_url 点击测试，验证 loading 状态 | 2026-03-21 | IMPL-006, IMPL-010 |
| AC-004-02 | ✅ 已验证 | 手动：测试 ollama（服务运行），验证 5 秒内成功 | 2026-03-21 | IMPL-006 |
| AC-004-03 | ✅ 已验证 | 手动：测试 openai（正确 key），验证显示模型数 | 2026-03-21 | IMPL-006 |
| AC-004-04 | ✅ 已验证 | 手动：测试 openai（错误 key），验证认证失败提示 | 2026-03-21 | IMPL-006 |
| AC-004-05 | ✅ 已验证 | 手动：测试未运行的 ollama，验证连接失败提示 | 2026-03-21 | IMPL-006 |
| AC-004-06 | ✅ 已验证 | 手动：网络断开测试，验证超时提示 | 2026-03-21 | IMPL-006 |
| AC-004-07 | ✅ 已验证 | 手动：base_url 为空时测试，验证阻断提示 | 2026-03-21 | IMPL-010 |
| AC-004-08 | ✅ 已验证 | 手动：测试进行中再次点击，验证忽略重复点击 | 2026-03-21 | IMPL-010 |

---

## 4.1 实施锚点

### 当前编写功能

| 字段 | 内容 |
|------|------|
| 当前功能 ID | `IMPL-001` |
| 当前阶段 | Phase 1：桌面客户端框架搭建 |
| 本阶段 Demo 目标 | 用户双击图标 3 秒内看到主界面 → 可在设置页新增 Provider 并测试连接 |
| 本阶段完成标准 | 双击图标 → 主界面显示 → 进入设置 → 新增一个 ollama Provider → 测试连接成功 → 保存成功 → 重启后配置保留 |

### 功能清单

**需完成**：

#### IMPL-001：项目脚手架
- ← FD-talor-phase1 ← US-001
- AC: AC-001-01
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.8（目录结构设计）
  - FEATURE-talor-phase1.md §F.2 ADR-001（Electron 选型）
  - REQUIREMENTS.md §1.3（术语表）
- **按需参考**:
  - FEATURE-talor-phase1.md §F.2 ADR-002（IPC 安全架构）

#### IMPL-002：窗口管理
- ← FD-talor-phase1 ← US-001
- AC: AC-001-01, AC-001-03, AC-001-05
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.4 IPC 通道（window:minimize/maximize/close）
  - FEATURE-talor-phase1.md §F.2 Schema（window_bounds）
- **按需参考**:
  - FEATURE-talor-phase1.md §F.7 启动流程

#### IMPL-003：配置存储层
- ← FD-talor-phase1 ← US-001
- AC: AC-001-02, AC-001-04, AC-002-07, AC-003-07
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.2 Schema（AppConfig）
  - FEATURE-talor-phase1.md §F.5 并发幂等（原子写入）
  - FEATURE-talor-phase1.md §F.9（原子写入策略）
- **按需参考**:
  - FEATURE-talor-phase1.md ADR-003（safeStorage 加密）

#### IMPL-004：IPC Bridge（Preload）
- ← FD-talor-phase1 ← US-001
- AC: AC-001-01（间接）
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.2 ADR-002（IPC 安全架构）
  - FEATURE-talor-phase1.md §F.4 TalorAPI 接口定义
- **按需参考**:
  - FEATURE-talor-phase1.md §F.8 目录结构

#### IMPL-005：Provider CRUD IPC Handlers
- ← FD-talor-phase1 ← US-002, US-003
- AC: AC-002-06, AC-003-06
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.4 IPC 通道定义
  - FEATURE-talor-phase1.md §F.2 Schema（Provider 模型）
  - FEATURE-talor-phase1.md §F.5 并发幂等（setDefault 逻辑）
- **按需参考**:
  - FEATURE-talor-phase1.md §F.3 状态机

#### IMPL-006：连接测试服务
- ← FD-talor-phase1 ← US-004
- AC: AC-004-02, AC-004-03, AC-004-04, AC-004-05, AC-004-06
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.4 Provider 测试端点表格
  - FEATURE-talor-phase1.md §F.5 重试机制（1 次重试，401/403 不重试）
  - REQUIREMENTS.md §1.4 US-004

#### IMPL-007：Provider 列表 UI
- ← FD-talor-phase1 ← US-002, US-003
- AC: AC-002-06, AC-003-06
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.4 TalorAPI
  - FEATURE-talor-phase1.md §F.7 Provider 新增流程
  - REQUIREMENTS.md §1.3（术语表：provider_list）
- **按需参考**:
  - REQUIREMENTS.md §1.4 US-002, US-003

#### IMPL-008：Provider 表单 UI
- ← FD-talor-phase1 ← US-002, US-003
- AC: AC-002-01, AC-002-02, AC-002-03, AC-002-04, AC-002-05, AC-003-01, AC-003-02, AC-003-08
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.2 Schema（Provider 模型，is_default 字段）
  - FEATURE-talor-phase1.md §F.7 Provider 新增流程（条件分支逻辑）
  - REQUIREMENTS.md §1.4 US-002, US-003

#### IMPL-009：删除确认对话框
- ← FD-talor-phase1 ← US-003
- AC: AC-003-03, AC-003-04, AC-003-05
- **实施前必读**:
  - REQUIREMENTS.md §1.4 US-003
- **按需参考**:
  - FEATURE-talor-phase1.md §F.3 表单状态

#### IMPL-010：连接测试按钮组件
- ← FD-talor-phase1 ← US-004
- AC: AC-004-01, AC-004-07, AC-004-08
- **实施前必读**:
  - FEATURE-talor-phase1.md §F.4 ConnectionTestResult 类型
  - REQUIREMENTS.md §1.4 US-004

**已完成**：
- IMPL-001 ~ IMPL-010 全部完成，Phase 1 编码完毕
- 全部 20 条 AC 手动验证通过
- Rendering bug 修复：preload 路径 `index.mjs` + lazy Proxy

### 会话范围说明

**本次会话目标（待启动）**：
> 待用户确认后开始实施

**本次会话范围外**（发现时记入 §4.6，不要实现）：
- Agent 执行引擎
- 会话管理和对话功能
- 数字员工定义加载
- SSE 流式对话

### 会话恢复 Checkpoint

```
上次完成到：IMPL-010 连接测试按钮组件，Phase 1 全部完成
当前状态：已完成
已产出文件：
  - talor-desktop/src/main/（index.ts, ipc/config.ts, ipc/window.ts, ipc/providers.ts, store/config-store.ts, services/provider-tester.ts, services/safe-storage.ts）
  - talor-desktop/src/preload/（index.ts）
  - talor-desktop/src/renderer/（App.tsx, pages/Home.tsx, pages/Settings/, components/, store/, lib/validation.ts, api/talorAPI.ts, types/config.ts）
  - talor-desktop/talor-desktop.*.json, tailwind.config.js, postcss.config.js, electron-builder.yml, index.html, electron.vite.config.ts
  - vite/vibe/features/talor-desktop-phase1/（REQUIREMENTS.md, FEATURE-talor-phase1.md, IMPLEMENTATION.md, phase-guard/phase-1.md）
未解决问题：
  - 渲染 Bug 已修复：preload 路径 index.mjs + lazy Proxy
下一步：Phase 1 完成 → 填写 phase-guard 证书 → FEATURE 归档 → OVERVIEW 同步
```

---

## 4.2 实施规划

### 关键路径（Critical Path）

```
[用户双击应用图标]
  → [窗口在 3 秒内打开，显示主界面]
  → main: 创建 BrowserWindow，加载 config-store
  → preload: 暴露 talorAPI
  → renderer: 渲染 Provider 列表页
  → [用户点击设置 → 进入设置页]
  → [用户点击新增 Provider → 展开表单]
  → [用户填写 ollama → base_url 预填充]
  → [用户点击测试连接 → 5 秒内显示成功/失败]
  → [用户点击保存 → 配置持久化到 ~/.talor/config.json]
  → [重启应用 → 配置完整保留]
```

### 阶段计划

| 阶段 | 名称 | 本阶段仅建 Critical Path 所需模块 | Demo 完成标准 |
|------|------|----------------------------------|-------------|
| Phase 1 | 客户端框架 + Provider 配置 CRUD | main process（窗口/ipc/config）、preload、renderer（列表/表单/测试/确认） | 用户双击图标 3 秒内看到主界面 → 进入设置 → 新增 ollama Provider → 测试连接成功 → 保存 → 重启配置保留 |

### 进入/退出条件

| 阶段 | 进入条件（开始前需就绪） | 退出条件（完成的定义） |
|------|----------------------|---------------------|
| Phase 1 | ① Node 20+ 已安装 ② npx create-electron-vite 可执行 ③ ~/.talor 目录可写 | ① 全部 10 个 IMPL 代码完成 ② 所有 20 条 AC 手动验证通过 ③ 阶段证书已提交 |

### Shippable Increment 表

| 步骤 | 构建内容 | 退出标准 | Shippable Increment |
|------|---------|---------|------|
| 1 | IMPL-001 项目脚手架 | `npm run dev` 可启动 Electron | **无**（不停） |
| 2 | IMPL-002 窗口管理 + IMPL-003 配置存储 | 窗口显示 + config 读写正常 | **无**（不停） |
| 3 | IMPL-004 IPC Bridge + IMPL-005 CRUD Handlers | Provider 增删改可调用 | **无**（不停） |
| 4 | IMPL-006 连接测试服务 | 测试请求发出并返回结果 | **无**（不停） |
| 5 | IMPL-007 Provider 列表 UI | 列表展示已有 Provider | **无**（不停） |
| 6 | IMPL-008 表单 UI + IMPL-009 删除确认 + IMPL-010 测试按钮 | Provider CRUD + 测试 + 删除 全链路可操作 | **必须填写**：双击图标 → 主界面 → 设置 → 新增 Provider → 填写 → 测试连接成功 → 保存 → 重启验证配置保留 |
| 7 | 全部 20 条 AC 手动验证 | 所有 AC 通过 | 完整功能可用 |

### 桩代码与占位符禁令

- ❌ 函数返回空数组、null 或硬编码数据（Critical Path 上）
- ❌ `// TODO: implement` 出现在 Critical Path 上
- ❌ 孤岛模块（已创建但不在当前阶段 Demo 调用链中）
- ❌ 仅依赖"测试通过"未亲自运行 Demo

---

## 4.3 已知陷阱列表（Gotchas）

| ⚠️ 陷阱描述 | 正确做法 | 关联文档 |
|------------|---------|---------|
| ⚠️ Electron main process 使用 CommonJS（`__dirname` 可用），renderer 使用 ESM（Vite 打包） | main process 中文件路径用 `path.join(__dirname, ...)`，renderer 中用 `import.meta.url` | FEATURE-talor-phase1.md §F.2 ADR-002 |
| ⚠️ safeStorage 在 macOS/Linux 上可用，Windows 需额外处理 | 启动时检测 safeStorage.isEncryptionAvailable()，不可用时弹出警告 | FEATURE-talor-phase1.md §F.2 ADR-003 |
| ⚠️ config.json 写入必须使用 atomic rename（write then rename） | 写 `config.json.tmp`，成功后 rename，防止崩溃导致文件损坏 | FEATURE-talor-phase1.md §F.5 并发幂等 |
| ⚠️ ollama base_url 不含 `/v1`（原生 API 用 `/api/chat`），openai/anthropic/google 含 `/v1` | provider-tester 中按 type 构造不同 base_url | FEATURE-talor-phase1.md §F.4 Provider 测试端点表格 |
| ⚠️ contextIsolation 必须为 true，nodeIntegration 必须为 false | preload 脚本通过 contextBridge 暴露 API，不得直接暴露 Node.js | FEATURE-talor-phase1.md §F.2 ADR-002 |
| ⚠️ AbortController 取消重复测试请求 | provider-tester 维护一个 AbortController，测试前取消旧请求 | FEATURE-talor-phase1.md §F.5 并发锁策略 |
| ⚠️ setDefault 需两步原子写：先全置 false，再目标置 true | 在 config-store 中以原子事务写入 config.json | FEATURE-talor-phase1.md §F.5 幂等要求 |

---

## 4.4 功能验收标准

> AC 定义在 REQUIREMENTS.md §1.8（唯一权威来源）。本节只引用 AC ID + 追踪验证状态。

### AC 验证清单

- [x] **AC-001-01** → 验证方式：手动双击应用图标，计时 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-001-02** → 验证方式：删除 ~/.talor/ 后启动，观察目录创建 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-001-03** → 验证方式：拖动窗口后关闭再打开 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-001-04** → 验证方式：损坏 config.json 后启动，观察警告横幅 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-001-05** → 验证方式：已运行时再次双击图标 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-002-01** ~ AC-002-07 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-003-01** ~ AC-003-08 → 状态：✅ 已验证 (2026-03-21)
- [x] **AC-004-01** ~ AC-004-08 → 状态：✅ 已验证 (2026-03-21)

### 回滚验证步骤

**回滚方式**：
```bash
# 1. 删除生成的 talor-desktop 目录
rm -rf ~/Desktop/talor/talor-desktop

# 2. 删除配置文件
rm -rf ~/.talor/
```

**回滚后验证检查点**：
- [ ] 原目录干净，无残留文件
- [ ] ~/.talor/ 删除后不影响任何其他程序

---

## 4.5 发布清单

### 配置项
- [x] package.json scripts（dev/build）已配置
- [x] electron-builder.yml 打包配置已配置
- [x] TypeScript strict mode 开启
- [ ] macOS app bundle 签名配置（后续阶段）

### 数据库
- N/A（Phase 1 无数据库，配置文件存储）

### 中间件
- N/A（Phase 1 无网络中间件依赖）

### 监控
- [x] electron-log 日志输出到 ~/Library/Logs/Talor/（macOS）— electron-log 默认路径

### 回滚
- [x] 回滚方案已文档化（见 §4.4）
- [x] 回滚脚本已准备（rm -rf talor-desktop && rm -rf ~/.talor/）

### 文档更新（⭐ 迭代完成后必须执行）
- [ ] OVERVIEW.md 已更新（合并 FEATURE 中的 ADR、Schema、Patterns）— 待执行
- [ ] FEATURE-talor-phase1.md 标记为 `status: archived` — 待执行

---

## 4.6 范围外功能列表

> **规则**：发现时立即记录，不得"顺便实现"。每次会话结束时通知用户确认 pending 项。

| # | 功能描述 | 发现时机 | 推迟原因 | 建议加入阶段 | 状态 | 决策日期 |
|---|---------|---------|---------|-----------|------|---------|
| — | — | — | — | — | — | — |

---

## 4.7 统一变更日志

| 日期 | 变更文档 | 变更摘要 | 影响的关联文档/ID | 已同步? |
|------|---------|---------|----------------|--------|
| 2026-03-21 | REQUIREMENTS.md §1.3 | 术语表新增，default_provider → is_default | FEATURE-talor-phase1.md | ✅ |
| 2026-03-21 | FEATURE-talor-phase1.md §F.2 | AppConfig 移除 default_provider_id，新增 Provider.is_default | IMPL-talor-phase1.md | ✅ |
| 2026-03-21 | FEATURE-talor-phase1.md §F.5 | setDefault 幂等处理：两步原子写 | — | — |
| 2026-03-21 | IMPL-talor-phase1.md | Phase 1 编码完成，IMPL-001~010 全部完成，npm run dev 启动成功 | — | — |
| 2026-03-21 | IMPL-talor-phase1.md | Phase 1 AC 手动验证全部通过（20/20），IMPL 完成率 10/10 | phase-guard/phase-1.md | 待归档 |
| 2026-03-21 | src/main/index.ts | preload 路径 .mjs 修复，渲染 Bug 根因 | — | ✅ |

---

## 当前实施状态（每次会话结束时更新）

### 已完成（可演示）

| 功能 ID | 功能描述 | Demo 场景 | 最后验证日期 |
|--------|---------|---------|-----------|
| IMPL-001 | 项目脚手架 | npm run dev 启动成功，窗口 2.5 秒内显示 | 2026-03-21 |
| IMPL-002 | 窗口管理 | 窗口控件（最小化/最大化/关闭）功能正常 | 2026-03-21 |
| IMPL-003 | 配置存储层 | config-store 初始化、atomic write、损坏恢复 | 2026-03-21 |
| IMPL-004 | IPC Bridge | TalorAPI 通过 contextBridge 暴露，类型安全 | 2026-03-21 |
| IMPL-005 | Provider CRUD Handlers | list/create/update/delete/setDefault IPC handlers | 2026-03-21 |
| IMPL-006 | 连接测试服务 | provider-tester HTTP 测试，AbortController 取消 | 2026-03-21 |
| IMPL-007 | Provider 列表 UI | 空状态/列表/编辑/删除/设默认 全部完成 | 2026-03-21 |
| IMPL-008 | Provider 表单 UI | ollama 预填充/base_url 预填/字段验证/保存 | 2026-03-21 |
| IMPL-009 | 删除确认对话框 | 二次确认，危险操作红色标识 | 2026-03-21 |
| IMPL-010 | 连接测试按钮 | loading 状态/success 展示/failure 展示 | 2026-03-21 |

### 进行中

| 功能 ID | 当前进度 | 阻碍/待解决 | 预计完成阶段 |
|--------|---------|-----------|-----------|
| — | — | — | — |

### 下一步（本会话结束时填写）

下一个会话应该做的**一件具体的事**：Phase 1 完成 — 填写 phase-guard 证书 → FEATURE 归档 → OVERVIEW 同步（Phase 2 待用户规划）

下一个会话应该做的**一件具体的事**：创建 IMPL-001 项目脚手架
