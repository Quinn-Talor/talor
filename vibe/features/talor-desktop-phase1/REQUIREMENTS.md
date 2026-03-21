<!--
doc-id: REQ-talor-phase1
status: approved
version: 1.1
last-updated: 2026-03-21
depends-on: []
generates: FEATURE-talor-phase1
-->

# Talor Phase 1 需求文档

> 纯用户视角。本文档描述**用户需要什么**，不描述系统如何实现。
> 所有术语命名以 §1.3 术语表为准——AI 在编写代码、注释、变量名时必须严格遵循。
> 功能设计见 `FEATURE-talor-phase1.md`。实施计划见 `IMPLEMENTATION.md`。

---

## Pre-generation Checklist（生成前必须完成）

- [x] 已与需求方确认业务背景和核心目标
- [x] 已列出所有业务术语并确认定义（特别是易混淆词）
- [x] 每个用户故事已附真实数据样例（非 schema）
- [x] 边界 Case 和异常场景已逐一列举

---

## 1.1 需求背景

Talor 是一款 AI 数字员工平台，当前依赖 Python FastAPI 后端 + Web 前端运行，用户必须分别启动两个服务才能使用。这带来了部署门槛高、环境依赖复杂的问题。

用户需要一款**开箱即用的桌面客户端**——双击图标即可运行，无需配置 Python 环境、无需手动启动服务。Phase 1 的核心目标是在 Electron + TypeScript 架构下，搭建完整的桌面应用框架，并实现对 LLM Provider 配置的管理能力（增删改查 + 连接测试），为后续 Agent 执行引擎和会话管理奠定基础。

当前痛点：用户在配置 LLM Provider 时需要直接编辑 JSON 配置文件，容易出错且缺乏反馈机制。桌面客户端需要提供可视化的配置管理界面，并支持实时验证连接状态。

---

## 1.2 目标

- [x] **目标 1**：用户双击 Talor 图标后 3 秒内看到主界面，无需任何额外操作
- [x] **目标 2**：用户可在设置页面完成 Provider 的新增、编辑、删除、设为默认操作，无需编辑配置文件
- [x] **目标 3**：用户点击"测试连接"后 5 秒内得到明确成功/失败反馈，失败时展示可读错误信息
- [x] **目标 4**：所有 Provider 配置在应用重启后完整保留，API Key 以加密形式存储

**本次不包含的目标**（明确排除，避免范围蔓延）：

- 不包含 Agent 执行引擎
- 不包含会话管理和对话功能
- 不包含数字员工定义加载
- 不包含 SSE 流式对话
- 不包含 Workspace 配置
- 不包含 default_model 配置（按会话级别设置，不在 Phase 1 范围）

---

## 1.3 业务术语表（Glossary）

> ⭐ 关键：AI 在命名变量、函数、注释、数据库字段时**必须以此表为准**，不得使用同义词。
> "代码命名"列是 AI 可直接使用的标识符（snake_case）。

| 术语 | 定义 | 代码命名 | 易混淆项 |
|------|------|---------|---------|
| Provider（提供商） | LLM 服务的提供方，支持 ollama / openai / anthropic / google 四种类型 | `provider` | 无 |
| Model（模型） | 具体的大语言模型实例，格式为 `provider_type/model_id` | `model` | 与 Provider 区分：Provider 是服务提供方，Model 是具体模型实例 |
| ConfigDir（配置目录） | 存放 Talor 所有配置文件的本地目录 | `config_dir` | 与 Workspace 区分：ConfigDir 仅存储配置文件，不存储数字员工定义 |
| Connection Test（连接测试） | 验证 Provider 配置（base_url + api_key）是否可用的操作 | `connection_test` | 与 Model List 区分：连接测试验证认证和可达性，Model List 获取可用模型列表 |
| API Key（API 密钥） | 用于认证 LLM 服务请求的密钥字符串 | `api_key` | 与 base_url 区分：api_key 是认证凭证，base_url 是服务地址 |
| ProviderForm（提供商表单） | 用户填写 Provider 信息的 UI 表单组件 | `provider_form` | 与 ProviderList 区分：Form 用于输入，List 用于展示 |
| ProviderType（提供商类型） | Provider 的类型枚举值：ollama / openai / anthropic / google | `provider_type` | 与 ProviderStatus 区分：Type 是种类，Status 是状态 |
| TestStatus（测试状态） | 连接测试的当前状态：pending / testing / success / failure | `test_status` | 与 ProviderEnabled 区分：TestStatus 是测试结果，Enabled 是配置开关 |
| Default Provider（默认提供商） | 用户选定的优先使用的 Provider，通过 Provider.is_default=true 标记，同一时刻仅一个 | `is_default` | 与 Enabled Provider 区分：is_default 是优先级标记，enabled 是功能开关；与 default_provider_id（全局字段）区分：is_default 内嵌于 Provider 实体，更直观 |
| safeStorage（安全存储） | Electron 内置的操作系统级加密存储 API | `safe_storage` | 与 electron-store 区分：safeStorage 加密敏感数据，electron-store 存储普通配置 |

---

## 1.4 用户故事

---

### US-001：客户端启动

**用户故事**：作为用户，当双击 Talor 应用图标时，我希望应用立即启动并显示主界面，以便无需任何额外操作即可开始使用。

**正常场景**：

| 输入 | 期望输出 |
|------|---------|
| 用户双击应用图标 | 应用窗口在 3 秒内打开，显示主界面（包含设置入口） |

**真实数据样例**：

```
输入：
- 操作系统：macOS 14.4
- 启动方式：Finder 中双击 Talor.app
- 前置状态：无任何 Talor 进程运行

期望输出：
- 窗口标题："Talor"
- 主界面包含：顶部导航栏（含"设置"入口）、内容区域
- 窗口尺寸：上次关闭时的尺寸（如无可用默认值 1200x800）
- 窗口位置：上次关闭时的位置（如无可用默认值居中）
```

**异常场景 & 边界 Case**：

| 条件 | 系统应 |
|------|--------|
| 当 macOS 系统提示"Talor 来自未识别开发者"时 | 弹出系统级提示引导用户进入"系统偏好设置 → 安全性与隐私"允许运行 |
| 当配置文件目录 `.talor` 不存在时 | 自动创建 `.talor/` 目录及 `config.json`（空配置） |
| 当 `config.json` 格式损坏时 | 备份损坏文件为 `config.json.bak`，重新创建空 `config.json`，展示警告提示 |
| 当应用启动时已有相同进程运行时 | 聚焦已有窗口，不启动新实例（macOS 标准行为） |

---

### US-002：新增 Provider

**用户故事**：作为用户，当我在设置页面填写 Provider 信息并点击保存时，我希望系统将配置持久化并展示在列表中，以便下次打开应用时配置仍然保留。

**正常场景**：

| 输入 | 期望输出 |
|------|---------|
| 用户在设置页面填写 Provider 信息并点击保存 | 列表顶部新增一行，展示 Provider 类型、名称、是否默认，保存成功提示 |
| 用户不填写 api_key（ollama 可选）并保存 | 正常保存，api_key 字段留空 |
| 用户选择 provider_type=ollama，填写 name="本地 Ollama"，base_url="http://localhost:11434" | 正常保存，models 字段自动获取（为空表示尚未测试） |

**真实数据样例**：

```
输入：
{
  "provider_type": "openai",
  "name": "我的 OpenAI",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-xxxxxxxxxxxxxxxxxxxxxxxx",
  "enabled": true
}

期望输出：
{
  "id": "prov_01hx3k7...",
  "type": "openai",
  "name": "我的 OpenAI",
  "base_url": "https://api.openai.com/v1",
  "models": [],
  "enabled": true
}
```

**异常场景 & 边界 Case**：

| 条件 | 系统应 |
|------|--------|
| 当 name 为空时 | 阻断保存，字段下方显示红色提示"名称不能为空" |
| 当 base_url 格式非法（如非 http/https 开头）时 | 阻断保存，字段下方显示"URL 格式无效，请以 http:// 或 https:// 开头" |
| 当 name 与已有 Provider 重复时 | 阻断保存，字段下方显示"该名称已存在，请使用其他名称" |
| 当 api_key 包含前后空格时 | 自动 trim 后保存，不显示错误 |
| 当 Provider 类型为 openai/anthropic/google 但 api_key 为空时 | 阻断保存，字段下方显示"API Key 为必填项" |
| 当 config.json 无法写入时（如权限问题） | 弹出错误对话框"配置文件保存失败：权限不足，请检查 ~/.talor 目录权限"，不静默失败 |

---

### US-003：编辑、删除与设置默认 Provider

**用户故事**：作为用户，当我想修改已有 Provider 的参数、删除不再使用的 Provider、或将某个 Provider 设为默认时，我希望系统提供直观的一键操作，以便高效管理我的 Provider 配置。

**正常场景**：

| 输入 | 期望输出 |
|------|---------|
| 用户点击已有 Provider 行的"编辑"按钮 | 表单展开并填充现有数据，标题变为"编辑 Provider" |
| 用户修改 name 后点击保存 | 列表中该行 name 更新，展示保存成功提示 |
| 用户点击已有 Provider 行的"删除"按钮 | 弹出二次确认对话框"确认删除 {name}？此操作不可撤销" |
| 用户在确认对话框中点击"删除" | Provider 从列表中移除，展示删除成功提示 |
| 用户点击已有 Provider 行的"设为默认"按钮 | 该 Provider 行显示"默认"标签，其他行默认标签移除 |

**真实数据样例**：

```
场景：已有 Provider 列表
输入：用户点击"设为默认"按钮（provider_id="prov_01hx3k7"）

期望输出：
[
  {
    "id": "prov_01hx3k7",
    "name": "我的 OpenAI",
    "is_default": true
  },
  {
    "id": "prov_02abcde",
    "name": "本地 Ollama",
    "is_default": false
  }
]
```

**异常场景 & 边界 Case**：

| 条件 | 系统应 |
|------|--------|
| 当用户尝试删除唯一的 Provider 时 | 允许删除，列表显示空状态提示"暂无 Provider，请点击上方按钮添加" |
| 当用户尝试将已默认的 Provider 再设为默认时 | 按钮状态不变，无操作 |
| 当用户在编辑表单中填写重复 name 时 | 阻断保存，显示"该名称已存在"（排除自身） |
| 当用户取消编辑时（点击"取消"或按 Esc） | 表单关闭，数据恢复为编辑前状态，不触发保存 |

---

### US-004：连接测试

**用户故事**：作为用户，当我填写或选择一个 Provider 后，我希望点击"测试连接"按钮在 5 秒内得到明确的成功或失败反馈，以便确认配置正确后再保存。

**正常场景**：

| 输入 | 期望输出 |
|------|---------|
| 用户填写完整 ollama 配置，点击"测试连接" | 按钮变为 loading 状态（不可点击），5 秒内显示绿色成功图标和"连接成功" |
| 用户填写 openai 配置（正确 api_key），点击"测试连接" | 同上，成功则展示可用模型数（如"连接成功，检测到 3 个模型"） |
| 用户填写错误 api_key，点击"测试连接" | 显示红色失败图标和错误信息（如"认证失败：Invalid API Key"） |
| 用户填写错误 base_url，点击"测试连接" | 显示红色失败图标和"连接失败：无法连接到服务器，请检查 URL" |

**真实数据样例**：

```
输入（ollama）：
{
  "provider_type": "ollama",
  "base_url": "http://localhost:11434",
  "api_key": ""  // ollama 无需 api_key
}

期望输出（成功）：
{
  "status": "success",
  "message": "连接成功",
  "models_count": 3,
  "latency_ms": 127
}

期望输出（失败）：
{
  "status": "failure",
  "error_code": "CONNECTION_REFUSED",
  "message": "连接失败：无法连接到 http://localhost:11434，请确认 Ollama 服务已启动"
}
```

**异常场景 & 边界 Case**：

| 条件 | 系统应 |
|------|--------|
| 当网络请求超过 5 秒无响应时 | 超时处理，显示"连接超时，请检查网络或 base_url" |
| 当 base_url 为空时 | 阻断测试，字段下方显示"请先填写 base_url" |
| 当 ollama 返回 401 未授权时 | 显示"认证失败：请检查 api_key 是否正确" |
| 当 openai api_key 余额不足时 | 显示"API Key 有效但配额不足，请检查账户余额" |
| 当测试过程中用户再次点击测试按钮时 | 忽略重复点击，保持当前测试状态 |
| 当 Provider 类型为 anthropic/google 但 api_key 无效时 | 显示对应 Provider 的友好错误信息，不暴露原始 API 错误 |

---

## 1.5 业务流程图

```mermaid
flowchart TD
    A([用户双击 Talor]) --> B{configDir 存在?}
    B -- 是 --> C[加载 config.json]
    B -- 否 --> D[自动创建 .talor/ 目录和 config.json]
    D --> C
    C --> E[渲染主界面]
    E --> F[用户点击"设置"])
    F --> G[渲染 Provider 列表页]

    G --> H([用户操作完成])
    H --> I[用户关闭应用]
    I --> J[保存 config.json]
    J --> K([退出])
```

```mermaid
flowchart TD
    A([用户点击"新增 Provider"]) --> B[展开 ProviderForm]
    B --> C[用户选择 provider_type]
    C --> D{provider_type = ollama?}
    D -- 是 --> E[base_url 预填充为 http://localhost:11434]
    D -- 否 --> F[base_url 和 api_key 均为空]
    E --> G[用户填写其余字段]
    F --> G
    G --> H[用户点击"保存"]
    H --> I{验证通过?}
    I -- 否 --> J[显示表单内错误提示]
    J --> G
    I -- 是 --> K[持久化到 config.json]
    K --> L[API Key 加密存储]
    L --> M[渲染更新后的列表]
    M --> N([保存成功提示])
```

```mermaid
flowchart TD
    A([用户点击"测试连接"]) --> B{base_url 已填写?}
    B -- 否 --> C[显示"请先填写 base_url"]
    B -- 是 --> D[按钮变为 loading 状态]
    D --> E[5 秒超时倒计时启动]
    E --> F[HTTP GET 请求测试端点]
    F --> G{响应状态?}
    G -- 2xx --> H[status=success, 显示模型数量]
    G -- 401/403 --> I[显示认证失败信息]
    G -- 其他错误 --> J[status=failure, 显示连接失败信息]
    H --> K([用户看到测试结果])
    I --> K
    J --> K
```

---

## 1.6 功能清单

> 列出本次需求包含的所有具体功能点，每条链接到对应用户故事。
> 优先级：P0=必须有/P1=应该有/P2=可以有。

| ID | 功能描述 | 所属用户故事 | 优先级 | 备注 |
|----|---------|------------|--------|------|
| F-001 | 应用冷启动在 3 秒内显示主界面 | US-001 | P0 | 包含窗口尺寸/位置记忆 |
| F-002 | configDir（.talor）不存在时自动创建 | US-001 | P0 | 包含空 config.json 初始化 |
| F-003 | config.json 损坏时自动备份并重建 | US-001 | P0 | 防止用户数据丢失 |
| F-004 | Provider 列表展示（类型、名称、默认标签、启用状态） | US-002 | P0 | 支持空状态展示 |
| F-005 | ProviderForm 新增 Provider | US-002 | P0 | 支持 ollama/openai/anthropic/google |
| F-006 | Provider 表单字段验证（name 非空、URL 格式、必填项） | US-002 | P0 | 实时阻断，非 submit 后验证 |
| F-007 | Provider name 重复性校验 | US-002 | P0 | 排除自身，用于编辑场景 |
| F-008 | Provider 编辑功能（表单预填充 + 保存更新） | US-003 | P0 | |
| F-009 | Provider 删除功能（二次确认对话框） | US-003 | P0 | |
| F-010 | 设为默认 Provider（单选） | US-003 | P0 | |
| F-011 | 连接测试功能（5 秒超时、状态反馈） | US-004 | P0 | |
| F-012 | 测试结果展示（成功/失败状态、错误信息、模型数量） | US-004 | P0 | |
| F-013 | API Key 加密存储（Electron safeStorage） | US-002 | P0 | |
| F-014 | Provider 配置持久化到 config.json | US-002 | P1 | |
| F-015 | 窗口尺寸和位置记忆 | US-001 | P1 | |
| F-016 | Provider enabled/disabled 切换 | US-003 | P1 | 软删除，可恢复 |
| F-017 | 应用启动时已有进程则聚焦不重启 | US-001 | P1 | macOS 标准行为 |
| F-018 | 自动获取 ollama 可用模型列表（测试成功后） | US-004 | P2 | 提升体验，非必须 |
| F-019 | ProviderForm 取消操作（Esc 键支持） | US-003 | P2 | |
| F-020 | 多语言支持框架搭建（Phase 1 仅英文） | US-001 | P2 | 预留 i18n 结构 |

---

## 1.7 优先级与取舍原则

### 优先级排序

**本需求的优先级顺序（从高到低）**：

1. **安全**：API Key 必须加密存储，禁止明文写入 config.json；配置写入失败必须阻断并提示
2. **正确性**：连接测试结果必须准确反映实际连通性；配置校验逻辑必须覆盖所有边界条件
3. **性能**：应用冷启动 < 3 秒；Provider 列表加载 < 500ms；连接测试超时 ≤ 5 秒
4. **体验**：表单验证实时反馈；错误信息可读友好；操作结果即时反馈

### 关键取舍声明

- **出错时**：阻断用户流程并显示明确错误提示，**不静默失败、不跳过、不展示原始堆栈**
- **数据一致性 vs 性能**：优先数据一致性——配置保存必须先写入磁盘成功后再更新 UI
- **表单 vs 即时反馈**：用户输入时实时校验，保存时再次校验——宁可多一次校验，不可漏掉验证
- **连接测试 vs 保存**：连接测试是**独立可选操作**，不阻断保存——用户可先保存后测试

### 降级策略

| 场景 | 降级行为 | 禁止行为 |
|------|---------|---------|
| 连接测试网络超时（5s） | 显示"连接超时，请检查网络或 base_url"，status=failure | 无限等待、显示 loading、抛出未处理异常 |
| config.json 写入失败 | 弹出错误对话框，列出具体原因，不更新 UI | 静默失败、UI 显示保存成功 |
| API Key 加密失败（操作系统不支持 safeStorage） | 弹出警告"加密存储不可用，API Key 将以明文存储在配置文件中"，用户确认后才保存 | 自动降级为明文存储 |
| Provider 测试端点返回非标准错误 | 统一格式化为用户可读信息，不暴露原始 API 错误 | 展示原始 API 响应 |
| 应用首次启动且 configDir 无配置文件 | 自动创建 `.talor/config.json`（空数组）并记录日志 | 抛出错误中断启动 |

---

## 1.8 验收标准

> ⭐ **本节是 AC 的唯一权威来源**。FEATURE 和 IMPLEMENTATION 文档只引用 AC ID，不重新定义。
> 每条验收标准必须是可独立验证的、具体的、链接到用户故事的断言。
> 格式：`[Given: 前置状态] → [When: 用户操作] → [Then: 可观察结果]`

### US-001 验收标准

- [ ] **AC-001-01**：Given macOS 系统正常，Talor 未运行 → When 用户在 Finder 中双击 Talor.app → Then 窗口在 3 秒内打开，显示主界面（包含顶部导航栏和设置入口）

- [ ] **AC-001-02**：Given macOS 系统正常 → When Talor 启动且 ~/.talor/ 不存在 → Then 自动创建 ~/.talor/ 目录和 ~/.talor/config.json（内容为 `{}`）

- [ ] **AC-001-03**：Given macOS 系统正常 → When Talor 启动且 ~/.talor/config.json 存在且格式合法 → Then 窗口尺寸和位置恢复为上次关闭时的状态（首次启动使用默认值 1200x800 居中）

- [ ] **AC-001-04**：Given ~/.talor/config.json 存在且格式损坏（非合法 JSON） → When Talor 启动 → Then 损坏文件备份为 config.json.bak，重新创建空 config.json，窗口顶部显示警告横幅"配置文件已损坏，已自动备份并重新创建"

- [ ] **AC-001-05**：Given Talor 已在运行 → When 用户再次双击应用图标 → Then 已有窗口被聚焦，不启动第二个实例

### US-002 验收标准

- [ ] **AC-002-01**：Given 用户在设置页面 → When 用户选择 provider_type=ollama → Then base_url 自动填充为 `http://localhost:11434`，api_key 字段显示为"可选"

- [ ] **AC-002-02**：Given 用户在 ProviderForm 中 → When name 字段留空点击保存 → Then 保存被阻断，name 字段下方显示红色"名称不能为空"

- [ ] **AC-002-03**：Given 用户在 ProviderForm 中 → When base_url 填写非 http/https 开头值（如 `ftp://`）点击保存 → Then 保存被阻断，base_url 字段下方显示"URL 格式无效，请以 http:// 或 https:// 开头"

- [ ] **AC-002-04**：Given 用户在 ProviderForm 中 → When provider_type=openai 且 api_key 为空点击保存 → Then 保存被阻断，api_key 字段下方显示"API Key 为必填项"

- [ ] **AC-002-05**：Given 用户在 ProviderForm 中 → When name 与已有 Provider 名称相同 → Then 保存被阻断，name 字段下方显示"该名称已存在，请使用其他名称"

- [ ] **AC-002-06**：Given 用户填写合法 Provider 信息 → When 点击保存 → Then config.json 中新增 Provider 条目（id 为 uuid），API Key 以加密形式存储，列表顶部出现新行，页面展示绿色"保存成功"提示

- [ ] **AC-002-07**：Given 用户填写合法 Provider 信息 → When 填写后刷新页面 → Then Provider 配置完整保留在列表中（包含 base_url、enabled 等，api_key 以密文形式不在 UI 显示）

### US-003 验收标准

- [ ] **AC-003-01**：Given Provider 列表包含至少一个 Provider → When 用户点击任意 Provider 行的"编辑"按钮 → Then 表单展开并填充该 Provider 的现有数据，标题变为"编辑 Provider"，其他行不可操作

- [ ] **AC-003-02**：Given 用户在编辑表单中修改 name → When 新 name 与列表中其他 Provider（不含自身）重复 → Then 保存被阻断，显示"该名称已存在"

- [ ] **AC-003-03**：Given Provider 列表包含至少一个 Provider → When 用户点击任意 Provider 行的"删除"按钮 → Then 弹出二次确认对话框，显示"确认删除 {Provider名称}？此操作不可撤销"

- [ ] **AC-003-04**：Given 二次确认对话框显示 → When 用户点击"取消" → Then 对话框关闭，无任何变化

- [ ] **AC-003-05**：Given 二次确认对话框显示 → When 用户点击"确认删除" → Then Provider 从列表和 config.json 中移除，列表重新渲染，展示绿色"删除成功"提示

- [ ] **AC-003-06**：Given Provider 列表包含多个 Provider → When 用户点击非默认 Provider 的"设为默认"按钮 → Then 该 Provider 行显示"默认"标签（is_default=true），其他所有行的"默认"标签被移除（is_default=false），config.json 更新

- [ ] **AC-003-07**：Given Provider 列表包含一个 Provider → When 用户点击"设为默认" → Then 该 Provider 行显示"默认"标签，重启应用后仍为默认

- [ ] **AC-003-08**：Given 用户在编辑/新增表单中 → When 按 Esc 键或点击"取消" → Then 表单关闭，数据恢复为操作前状态，不触发任何保存

### US-004 验收标准

- [ ] **AC-004-01**：Given 用户在 ProviderForm 中 base_url 已填写 → When 点击"测试连接" → Then 按钮变为 disabled + loading 状态，显示转圈图标，5 秒倒计时启动

- [ ] **AC-004-02**：Given ollama 服务运行在 localhost:11434 → When 测试 ollama Provider 连接 → Then 在 5 秒内显示绿色成功图标 + "连接成功"，latency 显示响应耗时（毫秒）

- [ ] **AC-004-03**：Given openai api_key 正确且有可用配额 → When 测试 openai Provider 连接 → Then 在 5 秒内显示绿色成功图标 + "连接成功，检测到 N 个模型"

- [ ] **AC-004-04**：Given openai api_key 错误 → When 测试 openai Provider 连接 → Then 显示红色失败图标 + "认证失败：Invalid API Key"，不暴露原始 API 响应

- [ ] **AC-004-05**：Given ollama 服务未运行 → When 测试 ollama Provider 连接 → Then 显示红色失败图标 + "连接失败：无法连接到 http://localhost:11434，请确认 Ollama 服务已启动"

- [ ] **AC-004-06**：Given 网络正常但 base_url 填写错误 → When 测试 Provider 连接 → Then 5 秒内显示红色失败图标 + "连接超时，请检查网络或 base_url"

- [ ] **AC-004-07**：Given base_url 字段为空 → When 点击"测试连接" → Then 不发起请求，base_url 字段下方显示"请先填写 base_url"

- [ ] **AC-004-08**：Given Provider 连接测试进行中 → When 用户再次点击"测试连接" → Then 无响应（忽略重复点击），保持当前 loading 状态

---

## 附录：关键技术参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 连接测试超时 | 5000ms | 从点击测试到展示结果的最长时间 |
| 冷启动目标 | < 3000ms | 从双击图标到主界面可见 |
| Provider 列表加载目标 | < 500ms | 从进入设置页到列表渲染完成 |
| API Key 存储方式 | Electron safeStorage | 操作系统级加密存储 |
| 配置文件路径 | `~/.talor/config.json` | 用户主目录下的 .talor 子目录 |
| 加密 Key 存储路径 | `~/.talor/api-keys.enc` | safeStorage 加密后的 Key 文件 |

---

## 附录：品牌标识（Logo）

### 设计理念

- **产品名**：Talor — AI 数字员工平台
- **关键词**：智能（Intelligence）、数字员工（Digital Agent）、专业可信赖（Professional）
- **选色方向**：蓝紫渐变 — 科技感 + 可信赖感，适用于深浅主题

### 方案一：Hex-T（推荐）

**文件**：`assets/logo-hex-t.svg`

**概念**：六边形（T 的容器）+ 字母 T + 底部三个节点（AI Agent 网络感）

**视觉**：几何六边形包裹字母 T，下方三点连结构成网络节点意象，蓝紫渐变填充

```
      ╱╲
    ╱    ╲
   │  ━━━  │
   │   ┃   │
    ╲  ┃  ╱
      ┃┃┃
      ● ● ●
```

---

### 方案二：T-Orbit

**文件**：`assets/logo-t-orbit.svg`

**概念**：字母 T + 三层轨道环 + 轨道节点

**视觉**：T 被椭圆轨道环绕，代表 AI 的智能环绕与 agent 的自主运行，动态感更强

```
      ⊙
    ╱ ╲
   │   T   │
    ╲ ╱
      ⊙────────
      ●
```

---

### 方案三：T-Node

**文件**：`assets/logo-t-node.svg`

**概念**：字母 T + 四角节点网络 + 背景网格点

**视觉**：最富技术感，T 的交叉点为枢纽，四角节点相连形成 Agent 网络拓扑，网格背景暗示数字世界

```
    ●────────●
    │        │
    │   ┃T   │
    │   ┃    │
    ●───●────●
    [背景: 点阵网格]
```

---

### 推荐意见

**推荐方案一（Hex-T）**：
- 六边形在 macOS/iOS icon 设计中广泛使用（苹果系产品感）
- T 字母辨识度最高，"Talor" 品牌名可内嵌于 T 中
- 蓝紫渐变在深浅模式下均表现良好
- 适合作为 App Icon（圆形裁剪后仍保留核心识别元素）

**后续需专业处理**：
- 导出为 1024×1024 App Icon（icns / ico）
- 导出 Wordmark 文字版本（Talor 字体设计）
- 设计全色版 / 单色白版 / 单色黑版三套

