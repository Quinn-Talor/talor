# SESSION-START — Phase 2 实施会话必读

> **AI 开发者**：在调用任何工具修改代码前，必须完成以下 6 个步骤。
> 本文件专属于 **Phase 2（能力检测与缓存）**。全局信息见 `../../implementation.md`。
> **本文件由文档生成时填写项目专属内容，每次会话开始时更新 Step 2-3。**

---

## Step 1：确认本阶段目标

> 直接读以下文件，不在此抄写。

- [x] 已读 `impl.md §P.0`，确认本阶段状态和阻塞项
- [x] 已读 `../../implementation.md §4.2`，确认本阶段 Demo 目标和退出标准
- [x] 已读 `impl.md §P.1`，确认本阶段剩余 IMPL 列表和 P0/P1/P2 优先级

**本阶段退出标准（来自 implementation.md §4.2 Phase 2）**：
> 用户查看 GPT-4o / Ollama 模型详情 → 看到支持的能力 badge（text_generation, function_calling 等）→ 关闭页面再打开 → 模型列表快速显示（来自持久化缓存）

---

## Step 2：确认已完成的工作

> 直接读 `impl.md §P.2`，不在此抄写。

- [x] 已读 `impl.md §P.2`，确认上次完成到哪、当前状态、已产出文件
- [x] 若有未解决问题，已列入本次会话优先处理项

**Phase 2 完成状态（会话恢复参考）**：
- P0（IMPL-013~016）：✅ 全部完成
- P1（IMPL-017~019）：✅ 全部完成（AC-011-01/02/03/04 + AC-010-04 双层验证通过）
- P2（IMPL-020~022）：⬜ 延期至 Phase 3 P2，已记录 deferred.md

---

## Step 3：本次会话范围声明（每次会话开始时填写）

**本次会话要实现的具体功能（一句话）：**
> Phase 2 已全部完成（P0+P1），本节仅供历史参考。新会话请直接进入 Phase 3 session-start.md。

**以下内容不在 Phase 2 会话范围内**（已延期到 deferred.md）：
- IMPL-020：前端能力手动配置表单 UI（延期至 Phase 3 P2）
- IMPL-021：缓存过期自动刷新逻辑（延期至 Phase 3 P2）
- IMPL-022：能力检测结果可视化增强（延期至 Phase 3 P2）

---

## Step 4：命名一致性确认（从 ../../requirements.md §1.3 术语表读取，不凭记忆）

> 本次会话涉及的模块/类/函数，必须使用以下规范名称。不允许使用同义词。

| 规格中的名称（§1.3） | 代码中必须用的名称 | 禁止的同义词 |
|-------------------|-----------------|-----------|
| 模型能力（Model Capability） | `modelCapability` / `ModelCapability` | `modelFeature`, `modelTrait` |
| 能力检测（Capability Detection） | `capabilityDetection` / `detectCapabilities` | `capabilityTesting`, `checkCapabilities` |
| 模型缓存（Model Cache） | `modelCache` | `modelStorage`, `modelBuffer` |
| 降级方案（Fallback Strategy） | `fallbackStrategy` / `getCapabilitiesWithFallback` | `errorHandling`, `defaultCapabilities` |
| 能力标志（Capability Flag） | `capabilityFlag` | `capabilityEnum`, `capabilitySwitch` |
| 模型刷新（Model Refresh） | `modelRefresh` / `forceRefresh` | `modelUpdate`, `refreshModels` |
| 会话模型（Session Model） | `sessionModel` | `conversationModel`, `chatModel` |

---

## Step 5：质量基线确认（每次会话开始时 checkbox）

- [x] 已读 `../../implementation.md §4.3` Gotchas，知道本次实施的陷阱点
- [x] 已读 `../../implementation.md §4.2`，知道当前阶段的 Critical Path 是什么
- [x] 已读 `impl.md §P.1`，知道本阶段 P0/P1/P2 优先级排序
- [x] 我知道本次修改后必须重新验证的 Demo 场景是什么
- [x] 我已确认上次会话的 Checkpoint 没有遗留未连接的孤岛模块
- [x] 测试在本次修改前是通过的（Tests 34/34 passed，typecheck exit 0）

---

## Step 6：验证执行环境确认（AC 双层验证前置条件）

- [x] 已确认项目根目录、测试命令、服务启动命令等信息正确
- [x] 已确认 Layer 2 验证工具可用（Node.js + Playwright CDP）
- [x] MCP Chrome 不适用；使用 CDP remote debugging protocol

---

## 验证执行环境（AC 双层验证必读，不凭记忆）

| 字段 | 内容 |
|------|------|
| 项目根目录 | `/Users/quinn.li/Desktop/talor/talor-desktop` |
| Layer 1 测试命令 | `cd /Users/quinn.li/Desktop/talor/talor-desktop && npm run typecheck && npm test` |
| 测试包路径规则 | `src/main/services/*.test.ts`, `src/renderer/lib/*.test.ts` |
| Layer 2 验证工具 | Node.js + Playwright CDP (`http://localhost:9222`) |
| 服务启动命令 | `cd /Users/quinn.li/Desktop/talor/talor-desktop && npm run dev` |
| 验证前置条件 | App 已启动（npm run dev），Ollama 本地运行（http://localhost:11434），CDP port 9222 开启 |

### MCP Chrome 环境准备

不适用。Phase 2 Layer 2 验证使用 Node.js + Playwright CDP 直接访问 `http://localhost:9222`，通过 `window.talorAPI.providers.*` IPC 调用执行验证，不使用 MCP Chrome。

**CDP 验证前检查清单**（每次 Layer 2 验证前执行）：

```
步骤 1：确认 App 已启动
  → 执行：curl -s http://localhost:9222/json | head -5
  → 预期：返回 JSON（包含 Electron renderer 的 Target 信息）
  → 若失败：执行 cd /Users/quinn.li/Desktop/talor/talor-desktop && npm run dev，硬停等待启动

步骤 2：确认 Ollama 运行（仅当验证需要真实模型时）
  → 执行：curl -s http://localhost:11434/api/tags | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Ollama OK: {len(d[\"models\"])} models')"
  → 预期：输出 "Ollama OK: N models"（N ≥ 1）
  → 若失败：注意当前 CDP 调用可能返回空模型列表

步骤 3：确认 talorAPI 可用
  → 在 CDP 脚本中检查：window.talorAPI && window.talorAPI.providers
  → 预期：返回 truthy（不为 undefined/null）

步骤 4：开始执行 AC 验证
  → 按 impl.md §P.3 Layer 2 验证脚本逐步执行
```

---

完成以上 6 步后，方可开始实施。

**本会话结束时**：
1. 更新 `impl.md §P.0` 本阶段仪表盘（IMPL 完成率、AC 验证率）
2. 更新 `impl.md §P.2` 会话恢复 Checkpoint
3. 更新 `../../implementation.md §4.0` 全局仪表盘（同步 Phase 进度）
4. 如阶段完成：运行 `klook-vibe-verify`，再填写 `certificate.md`
