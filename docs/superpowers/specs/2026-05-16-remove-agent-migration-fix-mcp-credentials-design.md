# Spec · 移除 Agent 迁移能力 + 修复 MCP stdio 凭据机制

**日期**: 2026-05-16  
**分支**: `feature/remove-agent-migration`(基于 `master`)  
**作者**: Talor AI + Quinn  
**状态**: Draft → 待审

---

## §0 项目定位调整

Talor 定位为**专业 agent 平台**:用户在本地从对话历史(`__chat__` S1 session)沉淀 agent → 编辑 → 运行。

**不做**:agent 跨机器分享 / 打包 / 导入。Talor 不是 agent 分发工具。

**保留的 agent 全生命周期**:

```
S1 对话历史
   ↓ Crystallizer
draft (workbench session)
   ↓ AgentEditPage
agents:create-from-draft
   ↓ 物化到 <userData>/agents/<id>/
   ↓ skill auto-install + register
AgentsPage / AgentDetailPage
   ↓ createSession
ReactLoop 跑起来
```

整个链路**纯本地**,不再考虑产物外流。

---

## §1 目标 & Definition of Done

### §1.1 目标

1. **移除全部 agent 迁移能力**(import / export / pack 三套并存的代码,改成零迁移代码)
2. **修复 MCP stdio 凭据机制**(同步顺手做,跟迁移无关但是真 bug)
3. **不破坏**现有平台能力:Crystallizer / AgentEditPage / agent 运行 / skill auto-install / dep-checker

### §1.2 Definition of Done

- [ ] `src/main/agent-pack/` 整目录不存在
- [ ] `src/main/agent/importer.ts` / `exporter.ts` 不存在
- [ ] 全代码库 grep 不到 `exportAgent` / `importAgent` / `exportAgentPack` / `previewPack` / `commitPack`
- [ ] IPC channels `agents:export` / `agents:import` / `agents:export-pack` / `agents:import-pack:*` 不存在
- [ ] preload 暴露面 `talorAPI.agents.export` / `.import` 不存在
- [ ] renderer 不再有任何 import/export UI 触点
- [ ] `package.json` 不再依赖 `archiver` / `unzipper` / `@types/archiver` / `@types/unzipper`
- [ ] MCP stdio 不再把字面凭据值喂子进程,改走 `envFromAccount` 引用
- [ ] `transport.serverPackage` 字段从 schema 与运行时清除(死字段)
- [ ] Validator 阻止把疑似凭据值写进 `transport.env`(启发式扫描)
- [ ] AgentLoader 启动时静默清洗存量 `serverPackage`,对存量可疑凭据 log warn
- [ ] 所有单测 + typecheck 通过
- [ ] 手测一遍:create-from-draft → enable → createSession 跑通,无回退

---

## §2 Spec A · 移除迁移能力(主菜)

### §2.1 删除文件

| 文件                                   | 备注     |
| -------------------------------------- | -------- |
| `src/main/agent/importer.ts`           | 整删     |
| `src/main/agent/exporter.ts`           | 整删     |
| `src/main/agent/exporter.test.ts`      | 整删     |
| `src/main/agent-pack/manifest.ts`      | 整删     |
| `src/main/agent-pack/importer.ts`      | 整删     |
| `src/main/agent-pack/exporter.ts`      | 整删     |
| `src/main/agent-pack/fs-helpers.ts`    | 整删     |
| `src/main/agent-pack/importer.test.ts` | 整删     |
| `src/main/agent-pack/exporter.test.ts` | 整删     |
| `src/main/agent-pack/` 目录本身        | 删空目录 |

### §2.2 修改文件 — IPC 层

**`src/main/ipc/agents.ts`**

删除以下(行号是 baseline,实施时以代码搜索为准):

- import:`exportAgent` from `../agent/exporter`、`importAgent` from `../agent/importer`、`exportAgentPack` from `../agent-pack/exporter`、`previewPack`/`commitPack` from `../agent-pack/importer`、type `ImportConflict`
- handler:`agents:export`(单 agent zip)
- handler:`agents:import`(单 agent zip 解压)
- handler:`agents:export-pack`(pack 导出)
- handler:`agents:import-pack:preview`(pack 预览)
- handler:`agents:import-pack:commit`(pack 提交)
- 辅助:`pickPackOutputDir`(仅 export-pack 用)

删完后 grep `export\|import\|pack` 兜底确认无残留 import / handler。

### §2.3 修改文件 — Preload

**`src/preload/index.ts`**

- L253 `export: (id: string) => ipcRenderer.invoke('agents:export', id)`
- L254 `import: () => ipcRenderer.invoke('agents:import')`

整体删除(以及对应 TS 类型暴露面如果有定义,顺手清)。

### §2.4 修改文件 — Renderer

**`src/renderer/pages/Agents/index.tsx`**

- 删 `importTrigger?: number` props(L11)
- 删 `prevImportTrigger` ref + 对应 useEffect(L38-44)
- 删 `handleImport`(L75-87)
- 引用 `AgentsPageProps` 的地方一并清 prop(`src/renderer/pages/Chat/...` 之类的传入处,grep `importTrigger` 兜底)

**空 state 文案**(L138-140):

```diff
- <p className="text-xs">从对话中沉淀一个 Agent，或导入已有的 Agent 包</p>
+ <p className="text-xs">从对话中沉淀一个 Agent</p>
```

### §2.5 修改文件 — 测试

**`src/main/agent/ac-verification.test.ts`**

- 删 import:`exportAgent` / `importAgent`(当前在 L29-30 附近)
- 删用例:grep `exportAgent` / `importAgent` 找出全部使用点(当前已知 L235, L241, L255, L259),整段 it/describe 块连删
- 如果删后 file 整段空 describe 留下,清掉

> 行号为编辑前 baseline,实施时以代码搜索为准

### §2.6 修改文件 — package.json

```diff
- "archiver": "^7.0.1",
- "unzipper": "^0.12.3",
- "@types/archiver": "^7.0.0",
- "@types/unzipper": "^0.10.11",
```

跑 `npm install` 同步 `package-lock.json`。

### §2.7 修改文件 — 文档

**`CLAUDE.md`**

- 第 2 节代码地图删 `agent-pack` 提及(如果有,grep `agent-pack` 兜底)
- 第 8 节"项目现状"加一条:
  ```
  - feat(agent): 移除 agent 迁移能力 — Talor 定位调整为本地 agent 平台,
    不再支持 import/export.agent-pack/ 目录及相关 IPC 全部删除.
  ```
- 第 4.4 节"高风险工具前置黑名单"无关,不动

**`vibe/project/`** 系列:不动(那里描述的是平台能力,迁移本来就没写进去)。

---

## §3 Spec B · MCP stdio 凭据机制修复

### §3.1 Schema 变更(`src/shared/types/agent.ts`)

**删除**:

```diff
- export interface McpServerPackage {
-   type: 'npm' | 'pip'
-   package: string
- }
```

**修改 `McpTransportStdio`**:

```diff
  export interface McpTransportStdio {
    type: 'stdio'
    command: string
    args?: string[]
-   env?: Record<string, string>
+   /** 字面配置变量,非凭据。例: { LOG_LEVEL: 'debug', NODE_ENV: 'production' } */
+   env?: Record<string, string>
+   /**
+    * 凭据引用。key=子进程的环境变量名,value=Account store 里的 envVar 名。
+    * 主进程在启动 stdio 子进程前用 Account.resolveAccountVars 注入。
+    * LLM / 渲染端永远拿不到真值。
+    */
+   envFromAccount?: Record<string, string>
  }
```

**修改 `McpServerDependency`**:

```diff
  export interface McpServerDependency {
    name: string
    description?: string
-   serverPackage?: McpServerPackage
    transport: McpTransportConfig
    tools: string[]
    required: boolean
  }
```

### §3.2 Validator(`src/main/agent/validator.ts`)

**新增规则**(当前 validator 有 rule 1~9,新增编号继续):

1. **rule 10 · envFromAccount key/value 格式**:`mcpServers[i].transport.stdio.envFromAccount` 的 key 必须 `^[A-Z_][A-Z0-9_]*$`,value 同。违反 → error
2. **rule 11 · env 凭据嫌疑扫描**:`mcpServers[i].transport.stdio.env[k]` 的 value 命中 `/^(sk-|ghp_|gho_|ghs_|ghr_|pk_|api_|token_|Bearer\s|Basic\s)/i` → error,提示"疑似凭据,请改用 envFromAccount 引用"。  
   保守起见 value 长度 < 8 或匹配 `^(true|false|debug|info|warn|error|production|development|test|0|1)$/i` 直接跳过扫描

测试:每条 rule 各写"触发 + 不触发"两条用例(`standards.md §L-MUST-3` 要求)。

### §3.3 主进程注入(`src/main/mcp/transport/stdio.ts`)

```diff
  async connect(): Promise<void> {
    if (!this.serverConfig.command) {
      throw new MCPError('STDIO transport requires command', -32602)
    }

    const args = this.serverConfig.args || []
-   const env = { ...process.env, ...this.serverConfig.env }
+   const accountEnv = await this.resolveAccountEnv()
+   const env = {
+     ...process.env,
+     ...this.serverConfig.env,
+     ...accountEnv,           // Account 凭据覆盖字面值,确保 envFromAccount 优先
+   }
```

`resolveAccountEnv()` 新方法:

```ts
private async resolveAccountEnv(): Promise<Record<string, string>> {
  if (!this.serverConfig.envFromAccount) return {}
  const { resolveAccountVars } = await import('../../accounts/account-store')
  // resolveAccountVars 返回 { resolved: Record<string,string>, missing: string[] }
  const result = resolveAccountVars(this.serverConfig.envFromAccount)
  if (result.missing.length > 0) {
    log.warn('[StdioTransport]', this.serverConfig.name, 'missing Account envVars:', result.missing)
    // 不阻断启动 — 子进程自己决定缺值是否致命
  }
  return result.resolved
}
```

**类型透传链**(实现时按链路顺序加,避免 stdio.ts 拿不到 envFromAccount):

1. `McpTransportStdio.envFromAccount` 在 `src/shared/types/agent.ts` 已加(§3.1)
2. `MCPServerConfig`(`src/main/mcp/types.ts`)同步加 `envFromAccount?: Record<string,string>`
3. `src/main/mcp/client.ts:89` 与 :105 处将 `server.envFromAccount` 一并传入 `StdioTransport`
4. 若 client.ts 内部从 profile 的 `mcpServers[]` 转 `MCPServerConfig` 有 mapper,补 mapper 字段

### §3.4 AccountStore 加 resolver(`src/main/accounts/account-store.ts`)

```ts
/**
 * 解析 envFromAccount 引用为实际值。
 * @param refs 子进程变量名 → Account envVar 名
 * @returns resolved: 可注入子进程的 env;missing: 在 Account 找不到的 envVar 名
 */
export function resolveAccountVars(refs: Record<string, string>): {
  resolved: Record<string, string>
  missing: string[]
} {
  const resolved: Record<string, string> = {}
  const missing: string[] = []
  // ... 走 AccountStore 已有的 query 逻辑
  // 仅在主进程调用;实际值绝不返回到 IPC 边界
  return { resolved, missing }
}
```

### §3.5 IPC `agents:resolve`(配置检查)

如果当前 `dependency-checker.ts` 的 step 6(Config 检查)只看 `mcp.transport.http.auth.envVar`,要扩展到 `mcp.transport.stdio.envFromAccount` 的 values。变更点:

**`src/main/agent/dependency-checker.ts`** L218-227 附近:

```diff
  for (const mcp of mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      if (!accountValues.has(mcp.transport.auth.envVar) && !missingVars.includes(...)) {
        missingVars.push(mcp.transport.auth.envVar)
      }
    }
+   if (mcp.transport.type === 'stdio' && mcp.transport.envFromAccount) {
+     for (const accountVar of Object.values(mcp.transport.envFromAccount)) {
+       if (!accountValues.has(accountVar) && !missingVars.includes(accountVar)) {
+         missingVars.push(accountVar)
+       }
+     }
+   }
  }
```

同样 step 4(MCP 检查)L146-152:

```diff
  for (const mcp of mcpServers) {
    if (mcp.transport.type === 'http' && mcp.transport.auth) {
      const envVar = mcp.transport.auth.envVar
      if (!accountValues.has(envVar)) {
        mcpIssues.push(`${mcp.name}: 需要配置 ${envVar} → 前往账户管理`)
      }
    }
+   if (mcp.transport.type === 'stdio' && mcp.transport.envFromAccount) {
+     for (const [_subprocVar, accountVar] of Object.entries(mcp.transport.envFromAccount)) {
+       if (!accountValues.has(accountVar)) {
+         mcpIssues.push(`${mcp.name}: 需要配置 ${accountVar} → 前往账户管理`)
+       }
+     }
+   }
  }
```

### §3.6 AgentEditPage 编辑入口

**本次不重写 MCP 表单 UI**。用户通过 AgentEditPage 现有的编辑路径(JSON 编辑器或现有表单)填 `envFromAccount` 字段;validator 在保存时校验格式。

理由:UI 重写工作量与本 PR 范围不匹配;凭据正确性由 §3.2 validator + §3.5 dep-checker 双层保障。后续若要做 envFromAccount 的"Account 下拉选择器"UI,独立立项。

---

## §4 Schema 数据迁移(存量 agent 清洗)

### §4.1 触发时机

`AgentLoader.loadAll()` 加载每个 `agent.json` 时,过一遍 migration step。**不写回磁盘**(避免破坏用户原文件),仅运行时清洗 + log。

### §4.2 清洗逻辑(`src/main/agent/loader.ts` 或新文件 `agent/profile-migrate.ts`)

```ts
function migrateProfileOnLoad(profile: AgentProfile, dirPath: string): AgentProfile {
  let mutated = false
  const cleaned = JSON.parse(JSON.stringify(profile)) as AgentProfile

  for (const mcp of cleaned.mcpServers ?? []) {
    // 1. 删 serverPackage 死字段
    if ('serverPackage' in mcp) {
      delete (mcp as Record<string, unknown>).serverPackage
      mutated = true
    }

    // 2. 扫 stdio.env 凭据嫌疑(不删,只警告 — 删了 server 会起不来,损失更大)
    if (mcp.transport.type === 'stdio' && mcp.transport.env) {
      for (const [key, value] of Object.entries(mcp.transport.env)) {
        if (looksLikeCredential(value)) {
          log.warn(
            `[loader] Agent "${profile.id}" mcp "${mcp.name}" env.${key}` +
              ` appears to be a credential — recommend moving to envFromAccount.`,
          )
          // 标 dep-checker 让 AgentDetailPage 显示 warning(P1,可后续做)
        }
      }
    }
  }

  if (mutated) {
    log.info(`[loader] Agent "${profile.id}" sanitized at load (serverPackage removed)`)
  }
  return cleaned
}

function looksLikeCredential(value: string): boolean {
  if (value.length < 8) return false
  if (/^(true|false|debug|info|warn|error|production|development|test|[01])$/i.test(value))
    return false
  return /^(sk-|ghp_|gho_|ghs_|ghr_|pk_|api_|token_|Bearer\s|Basic\s)/i.test(value)
}
```

### §4.3 不在 Spec 范围(明确不做)

- 不自动重写 agent.json 改 `env` → `envFromAccount` — 用户值丢了无法恢复,要他自己确认
- 不做 schema_version 升级(继续用 `'2.0'`)— 字段删除/新增是兼容性增量,不构成 major bump

---

## §5 测试策略

### §5.1 新增单测

**`src/main/mcp/transport/stdio.test.ts`**(已有的话扩,没有的话新建)

1. `envFromAccount 解析后注入 spawn env`(mock AccountStore 返回 `{ GITHUB_TOKEN: 'real' }`,断言 spawn 第三参 env 含 `GITHUB_TOKEN: 'real'`)
2. `envFromAccount 缺失值时,log warn 但不阻断启动`
3. `envFromAccount 与 env 同 key 时,envFromAccount 优先`(确保字面值不覆盖凭据)

**`src/main/accounts/account-store.test.ts`** 扩

1. `resolveAccountVars 正常解析多个引用`
2. `resolveAccountVars 部分缺失返回 missing 列表`
3. `resolveAccountVars 空引用返回空对象`

**`src/main/agent/validator.test.ts`** 扩

1. `envFromAccount key 不符合 ^[A-Z_][A-Z0-9_]*$ → error`
2. `envFromAccount value 不符合 ^[A-Z_][A-Z0-9_]*$ → error`
3. `stdio.env value 命中凭据模式 → error`("ghp_abcdef12345...")
4. `stdio.env value 不命中(LOG_LEVEL=debug) → pass`
5. `transport=http 不触发 stdio rule`

**`src/main/agent/loader.test.ts`** 扩

1. `存量 agent.json 含 serverPackage → 加载后 profile 不含,log info 调用`
2. `存量 agent.json 含可疑 env value → log warn 调用,profile 保留原值`

### §5.2 删除测试

- `src/main/agent/exporter.test.ts` 整删
- `src/main/agent-pack/importer.test.ts` 整删
- `src/main/agent-pack/exporter.test.ts` 整删
- `src/main/agent/ac-verification.test.ts` 中 2 个 import/export 用例(L235-241, L255-259)删除

### §5.3 手测脚本

跑一遍以下流程确保平台核心未破:

1. 启动 `npm run dev`,正常打开 `__chat__` 对话
2. 跟 chat 跑一轮,点 Crystallize → 进 workbench
3. 跟 crystallizer 描述意图 → 生成 draft → 保存 → 出现在 AgentsPage
4. 点 agent → AgentDetailPage 显示完整信息 + dep-checker 状态 OK
5. 点击 Start Chat → 进对话,跑一轮工具调用(任意 builtin)
6. AgentsPage 空状态文案显示 "从对话中沉淀一个 Agent"(不含"或导入...")
7. Settings 内不再有任何"导入 / 导出"入口
8. DevTools console grep 不到 `agents:export` / `agents:import` 字样
9. 如果本地有用 `transport.stdio.envFromAccount` 的 MCP agent,验证启动成功

### §5.4 typecheck

`npm run typecheck` 三 tsconfig 全过。预期:删完文件后会有几处 dangling import,本 spec §2 已枚举,执行时一并清。

---

## §6 风险 & 边界

### §6.1 风险

| 风险                                                                                                                        | 缓解                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 用户本地存量 agent 的 `env: { TOKEN: 'real' }` 已用,本次 loader 仅警告不重写 → 用户继续可用,但凭据仍在 agent.json plaintext | log warn 让用户知情;AgentDetailPage 可加 banner 提示(P1 不做)。**首要不丢功能**,凭据迁移由用户主动改 |
| 删完 `agent-pack/` 后 import 一些子模块(如 `manifest` 类型)→ TS 报错                                                        | 已在 §2 枚举所有 callsite,执行时按 IDE 提示扫一轮即可                                                |
| 删 `agents:import` IPC 后,如果某 dev tool / 测试 / debug 脚本依赖 → 报 channel not registered                               | grep 全代码库已确认无 renderer 调用;dev tool 不在范围                                                |
| 文档(README / vibe/) 还提到 import/export                                                                                   | 本次只更 CLAUDE.md,vibe/ 内本来就没具体描述,无 follow-up                                             |
| envFromAccount 在 stdio 启动时 import account-store 引入循环依赖                                                            | 用 dynamic import (`await import(...)`);account-store 自身只依赖 db,不会循环                         |

### §6.2 边界

- **不修复 prompt.md 拆分**(Spec C,延后)
- **不引入 LLM-driven installer**(Spec D,延后)
- **不重新设计 cli[] 字段**(保留现状,本地 dep-checker auto-install 仍可工作)
- **不重写 AgentEditPage MCP 编辑表单成 UI 表单**(JSON 编辑或现有 UI 维持现状,本次只加 envFromAccount 字段的格式校验)

---

## §7 实施顺序

单 PR,顺序为:

**阶段 1 · Spec B 基础设施**(schema + 注入路径,不破现有)

1. `shared/types/agent.ts` 增 `envFromAccount`,删 `serverPackage` 类型
2. `account-store.ts` 加 `resolveAccountVars`(+ test)
3. `mcp/transport/stdio.ts` 接入(+ test)
4. `mcp/types.ts` 同步(若需要)
5. `dependency-checker.ts` step 4/6 扩 stdio envFromAccount
6. `validator.ts` 加 2 条 rule(+ test)
7. `loader.ts` 加 migrateProfileOnLoad(+ test)

**阶段 2 · Spec A 删除**

8. 删 `src/main/agent-pack/` 整目录
9. 删 `src/main/agent/importer.ts` / `exporter.ts` / `exporter.test.ts`
10. `ipc/agents.ts` 清干净 import + handlers
11. `preload/index.ts` 删 export/import 暴露面
12. `renderer/pages/Agents/index.tsx` 清 handleImport + importTrigger
13. 触点 grep 兜底(`AgentsPageProps` 调用者)

**阶段 3 · 清理 + 验证**

14. `ac-verification.test.ts` 删 import/export 用例
15. `package.json` 删 archiver/unzipper
16. `npm install` 同步 lock
17. `CLAUDE.md` 更新
18. `npm run typecheck`
19. `npm run test`
20. 手测脚本(§5.3)

---

## §8 Out of Scope

明确**不做**的事(确保 reviewer 不期待):

- agentPrompt 拆 prompt.md(Spec C,独立 PR)
- LLM-driven `__installer__`(Spec D,延后)
- `cli[]` schema 改动
- AgentEditPage MCP 编辑 UI 表单重写
- 存量 agent.json 的 env 凭据自动迁移(用户手动)
- 文档(vibe/project/)长篇大改
- 国际化 / Windows 兼容
