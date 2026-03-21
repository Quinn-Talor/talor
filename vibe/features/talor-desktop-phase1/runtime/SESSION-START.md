# SESSION-START — 每次实施会话必读

> **AI 开发者**：在调用任何工具修改代码前，必须完成以下 5 个步骤。
> 跳过此清单 = 在没有地图的情况下开车。
> **本文件由文档生成时填写项目专属内容，每次会话开始时更新 Step 2-3。**

---

## Step 1：确认当前阶段

| 字段 | 内容 |
|------|------|
| 当前阶段 | Phase 1：桌面客户端框架搭建 + Provider 配置 CRUD |
| 本阶段 Demo 目标 | 用户双击图标 3 秒内看到主界面 → 可在设置页新增 Provider 并测试连接 |
| 本阶段完成标准 | 双击图标 → 主界面显示 → 进入设置 → 新增一个 ollama Provider → 测试连接成功 → 保存成功 → 重启后配置保留 |
| 本阶段剩余工作 | IMPL-001 ~ IMPL-010 全部 10 个任务 |

---

## Step 2：确认已完成的工作

| 字段 | 内容 |
|------|------|
| 上次完成到 | 无（Phase 1 尚未开始） |
| 当前状态 | 待启动 |
| 已产出文件 | 无 |
| 未解决问题 | 无 |

**规则**：如果有未解决问题，本会话必须先处理它们，再开始新功能。

---

## Step 3：本次会话范围声明

**本次会话要实现的具体功能（一句话）：**
> 创建 IMPL-001 项目脚手架：electron-vite 初始化 talor-desktop 项目，包含 main/preload/renderer 三层目录骨架、TypeScript 配置、Tailwind CSS 配置，确保 `npm run dev` 可启动 Electron 应用并显示主界面

**以下内容不在本次会话范围内**（发现需要时记入 IMPLEMENTATION.md §4.6，不要立刻实现）：
- Agent 执行引擎
- 会话管理和对话功能
- 数字员工定义加载
- SSE 流式对话

**规则**：实施过程中想到"顺便加 X"时，写入 §4.6 范围外功能列表，不要实现。

---

## Step 4：命名一致性确认

> 本次会话涉及的模块/类/函数，必须使用以下规范名称。不允许使用同义词。

| 规格中的名称（§1.3） | 代码中必须用的名称 | 禁止的同义词 |
|-------------------|-----------------|-----------|
| Provider（提供商） | `provider` | llm_provider、llmService、modelProvider |
| ProviderType（提供商类型） | `provider_type` | type、providerKind、providerType（仅类型脚本 type 别名允许）|
| Model（模型） | `model` | modelInstance、llmModel |
| Connection Test（连接测试） | `connection_test` / `testConnection` | ping、healthCheck、validateConnection |
| API Key（API 密钥） | `api_key` | secretKey、authKey、token |
| ConfigDir（配置目录） | `config_dir` | configDir、configPath、settingsDir |
| TestStatus（测试状态） | `test_status` | status、connectionStatus、healthStatus |
| Default Provider（默认提供商） | `is_default`（Provider 上的字段）| defaultProvider、isDefaultProvider |
| ProviderForm（提供商表单） | `ProviderForm`（React 组件）| ProviderInput、AddProviderDialog |
| safeStorage（安全存储） | `safe_storage`（服务文件名）/ `SafeStorage`（类名）| encryptedStore、secureStorage |
| TalorAPI | `TalorAPI`（preload 暴露的接口）| electronAPI、talorIPC |

---

## Step 5：质量基线确认

- [ ] 已读 IMPLEMENTATION.md §4.3 Gotchas，知道本次实施的陷阱点
- [ ] 已读 IMPLEMENTATION.md §4.2，知道当前阶段的 Critical Path 是什么
- [ ] 我知道本次修改后必须重新验证的 Demo 场景是什么
- [ ] 我知道 Critical Path 上哪些函数不能返回占位数据
- [ ] 我已确认上次会话的 Checkpoint 没有遗留未连接的孤岛模块
- [ ] 测试在本次修改前是通过的（不接受"测试一直就是 broken 的"）

---

完成以上 5 步后，方可开始实施。

**本会话结束时**：
1. 更新 `IMPLEMENTATION.md §4.0` 实施仪表盘（IMPL 完成率、AC 验证率）
2. 更新 `IMPLEMENTATION.md §4.1` 的"会话恢复 Checkpoint"
3. 更新 `IMPLEMENTATION.md §4.1` 的"已完成功能清单"
4. 如阶段完成：填写并提交 `phase-guard/phase-1.md` 证书
