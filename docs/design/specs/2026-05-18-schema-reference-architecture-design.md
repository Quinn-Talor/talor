# Spec · 引用化架构 — Agent 从"自带依赖"改成"引用平台资源"

**日期**: 2026-05-18
**分支**: 待定(预期独立 `feature/schema-reference-architecture`)
**作者**: Talor AI + Quinn
**状态**: Draft → 待审

---

## §0 上下文

Talor 现已确立为**专业本地 agent 平台**(见 [移除迁移 spec](./2026-05-16-remove-agent-migration-fix-mcp-credentials-design.md))。但 Schema 2.0 里 `skills` / `mcpServers` / `cli` 三类依赖的**承载形式**仍是"agent 自带":

- `skills`:作者声明依赖后,skill-installer 把 `~/.claude/skills/<name>/` 物理 cp 到 `<agentDir>/skills/<name>/`,每个 agent 一份独立副本
- `mcpServers`:`profile.mcpServers[]` 完整定义 transport,`buildAgentMcpRegistry` 现场起一个**新** MCP registry,跟平台 Settings 里配的并存
- `cli`:`profile.cli[]` 含 install method,dep-checker 按 method 自动跑 `npm i -g` / `brew install` / `curl | sh`

**这套设计的原始动机是"agent 自包含,可打包给别人用"**。本地平台语境下:

| 维度   | "自带"的代价                                                                                                                     | 应有的形态                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Skills | 同一 SKILL.md 在每个 agent 目录复制一份,N agents × M skills 文件膨胀,SKILL.md 升级时所有 agent 目录都得重 cp                     | 平台单一存储,agent 仅按名字引用 + 白名单过滤 |
| MCPs   | agent.json 与 Settings/DB 两套 MCP 定义并存,语义混乱;`agentOwnMcp` 与平台 mcpRegistry 用 `composeMcpSources` 合并,有重名规则不清 | 平台 Settings 单一来源,agent 仅按 name 引用  |
| CLIs   | auto-install 本来就脆(平台差异、权限、路径),失败后用户还是要手动                                                                 | 仅校验 `command -v`,装是用户责任             |

**本 spec 目标**:把这三类依赖从"自带"改成"引用",让 agent.profile 退化为"我用平台的这些资源"的纯声明清单,平台保有唯一真相。

---

## §1 目标 & Definition of Done

### §1.1 目标

1. **Skills 物理消失**:`<agentDir>/skills/` 目录在新建/物化 agent 时**不再创建**;运行时 `SkillRegistry` 从平台 `~/.claude/skills/` 加载并按 `profile.skills` 白名单过滤
2. **MCPs 统一在 Settings**:`profile.mcpServers` 退化为 `string[]`,引用 `mcp_servers` DB 表中的 name;`buildAgentMcpRegistry` 改为按 name lookup,不再现场定义
3. **CLI 仅校验存在**:`profile.cli` 退化为 `string[]`,dep-checker 仅 `command -v` 校验;**移除 auto-install 机器**(`npm i -g` / `brew install` / `curl | sh` 整段删)
4. **Crystallizer 引导改变**:不再 inline 定义新 MCP;识别到 agent 用了某 MCP → 在 draft 里产出 reference name + 提示用户"请确认 Settings 里已配置 X"
5. **AgentEditPage 改造**:skills / mcpServers / cli 字段编辑变成"从平台已有资源中勾选"(下拉/多选)而非"填表定义"
6. **数据迁移**:存量 agent.json
   - `skills: SkillItem[]` → `skills: string[]`(取 name 数组)
   - `mcpServers: McpServerDependency[]` → `mcpServers: string[]`(取 name 数组);**若 name 在 `mcp_servers` DB 表中不存在,把 transport 一次性写入 DB**(onboarding)
   - `cli: CliDependency[]` → `cli: string[]`(取 command 数组);install method 丢失(可接受 — 用户重装是一次性成本)
7. **`<agentDir>/skills/` 物理目录**:存量直接 `rm -rf`(skills 真相在平台)

### §1.2 Definition of Done

- [ ] `AgentProfile.skills?: string[]`(不再是 SkillItem[])
- [ ] `AgentProfile.mcpServers?: string[]`(不再是 McpServerDependency[])
- [ ] `AgentProfile.cli?: string[]`(不再是 CliDependency[])
- [ ] 类型 `SkillItem` / `McpServerDependency` / `CliDependency` / `CliInstallNpm` / `CliInstallBrew` / `CliInstallScript` / `CliInstallMethod` 整删
- [ ] `src/main/agent/skill-installer.ts` 改造:目标改成 `~/.claude/skills/<name>/`(若已有则跳过),不再 cp 到 `<agentDir>/skills/`
- [ ] `src/main/skills/registry.ts` `SkillRegistry.fromDir` 改造:平台 `~/.claude/skills/` 一次性加载,profile.skills 白名单过滤
- [ ] `src/main/agent/agent-manager.ts` `buildAgentMcpRegistry` 改造:按 name lookup `mcpServerRepo`,不再现场建 registry
- [ ] `src/main/agent/dependency-checker.ts` cli step 改造:仅 `execSync('command -v <cmd>')` 校验,不再触发 auto-install
- [ ] `src/main/agent/dependency-checker.ts` step 3 / step 5 调用 npm/brew/script 的 install 代码全删
- [ ] `src/main/skills/metadata-extractor.ts` `extractSkillCliBins` 与 dep-checker 的联动校验仍工作(从平台 skill 目录读 frontmatter)
- [ ] `src/main/agent/crystallizer.ts` system prompt 调整:产出 reference name 而非 inline 定义
- [ ] `src/renderer/pages/Agents/AgentEditPage.tsx` UI 改造:skills/mcp/cli 改为多选已配资源
- [ ] 存量 agent.json 加载后,profile.skills/mcpServers/cli 都是 `string[]`
- [ ] 存量 `<agentDir>/skills/` 物理目录:启动时一次性扫描并 `rm -rf`(写 `.skills-migrated` 标记防重跑)
- [ ] 存量 agent.json 里的 MCP transport 信息:`onboardMcpFromLegacyProfile()` 把 transport upsert 到 `mcp_servers` DB 表
- [ ] 所有单测 + typecheck 通过
- [ ] 手测:创建新 agent 时不再生成 `<agentDir>/skills/`;选 skill / mcp 用 dropdown;启动跑通

---

## §2 Schema 变更

### §2.1 `src/shared/types/agent.ts`

```diff
  export interface AgentProfile {
    // ... 前几行
-   tools?: BuiltinToolName[]
-   skills?: SkillItem[]
-   mcpServers?: McpServerDependency[]
-   cli?: CliDependency[]
+   tools?: BuiltinToolName[]
+   skills?: string[]              // 引用 ~/.claude/skills/<name> 平台 skill
+   mcpServers?: string[]          // 引用 mcp_servers DB 表中的 name
+   cli?: string[]                 // 系统 PATH 上的 command name,dep-checker 仅校验存在
    references?: ReferenceFile[]
    subagents?: AgentCollaboration
    preferences?: AgentPreferences
  }

  // ❌ 整删
- export interface SkillItem { name: string }
- export interface McpServerPackage { ... }
- export interface McpTransportStdio { ... }
- export interface McpTransportHttp { ... }
- export type McpTransportConfig = ...
- export interface McpServerDependency { ... }
- export interface CliInstallNpm { type: 'npm', package: string }
- export interface CliInstallBrew { type: 'brew', formula: string }
- export interface CliInstallScript { type: 'script', url: string }
- export type CliInstallMethod = CliInstallNpm | CliInstallBrew | CliInstallScript
- export interface CliDependency {
-   command: string
-   checkCommand?: string
-   install: CliInstallMethod
- }
```

**保留**:`SubagentRef` / `AgentCollaboration` / `AgentPreferences` / `ReferenceFile`(这些不在引用化范围)。

**注意**:MCP transport 类型(`McpTransportStdio` / `McpTransportHttp` / etc)在 agent schema 中不再需要,但 **`mcp_servers` DB 表的运行时类型 `MCPServerConfig`(`src/main/mcp/types.ts`)仍保留** — 平台 MCP 仍需要这些定义。

---

## §3 Skills 引用化

### §3.1 存储模型

| 角色                 | 现状                                           | 改后                       |
| -------------------- | ---------------------------------------------- | -------------------------- |
| 平台 skill 仓库      | `~/.claude/skills/<name>/SKILL.md`             | 不变                       |
| Agent skill 工作副本 | `<agentDir>/skills/<name>/SKILL.md`(cp 自平台) | **消失**                   |
| Agent 声明           | `profile.skills: [{name, required, purpose}]`  | `profile.skills: string[]` |

### §3.2 SkillRegistry(`src/main/skills/registry.ts`)

```diff
- // 当前:SkillRegistry.fromDir(`<agentDir>/skills`) 扫描 agent 私有目录
+ // 改后:SkillRegistry.fromPlatformDir(`~/.claude/skills`) 扫平台共享目录
+ //       agent 装配时再 filter(skill => agentProfile.skills.includes(skill.name))
```

新 API 草图:

```ts
class SkillRegistry {
  static fromPlatformDir(platformSkillsDir: string): SkillRegistry { ... }
  static empty(): SkillRegistry { ... }

  /** 按 agent 白名单过滤,返回受限副本 */
  filterByNames(allowedNames: string[]): SkillRegistry { ... }
}
```

agent-manager 装配时:

```ts
const platformSkills = SkillRegistry.fromPlatformDir('~/.claude/skills')
const agentSkills = platformSkills.filterByNames(profile.skills ?? [])
agentManager.registerBusinessAgent(id, { ..., skillRegistry: agentSkills })
```

### §3.3 skill-installer 改造

**职责变化**:不再 cp 到 agent 目录;若用户声明的 skill 在平台 `~/.claude/skills/` 不存在,**保持现状的兜底 cp** 但目标改成平台路径(等价于"代用户在平台 install 一次")。

```diff
  export async function installAgentSkills(profile, agentDir) {
    // 删除:create <agentDir>/skills/ 目录
    for (const skillName of profile.skills ?? []) {
-     const targetDir = join(agentDir, 'skills', skillName)
+     const targetDir = join(homedir(), '.claude', 'skills', skillName)
      if (existsSync(join(targetDir, 'SKILL.md'))) {
        result.skipped.push({ name: skillName, reason: 'already installed (platform)' })
        continue
      }
      // 找全局 skill roots(~/.skills、~/.agents/skills 兜底)→ cp 到 ~/.claude/skills/<name>
      const globalHit = findInGlobalSkillRoots(skillName)
      if (globalHit) cpSync(globalHit, targetDir, ...)
    }
  }
```

### §3.4 dep-checker step 2

```diff
- // 现状:检查 <agentDir>/skills/<name>/SKILL.md 是否存在
+ // 改后:检查 ~/.claude/skills/<name>/SKILL.md 是否存在
  for (const skillName of profile.skills ?? []) {
-   const skillPath = join(dirPath, 'skills', skillName, 'SKILL.md')
+   const skillPath = join(homedir(), '.claude', 'skills', skillName, 'SKILL.md')
    if (!existsSync(skillPath)) missingSkills.push(skillName)
  }
```

`extractSkillCliBins` 同样从平台路径读 frontmatter。

### §3.5 数据迁移

启动时一次性:

```ts
function migrateSkillsToplatform(agentsDir: string): void {
  const marker = join(agentsDir, '.skills-migrated')
  if (existsSync(marker)) return

  for (const agentDirName of readdirSync(agentsDir)) {
    const agentSkillsDir = join(agentsDir, agentDirName, 'skills')
    if (!existsSync(agentSkillsDir)) continue

    // 对每个 <agentDir>/skills/<name>/,若平台未装 → 复制过去
    for (const skillName of readdirSync(agentSkillsDir)) {
      const src = join(agentSkillsDir, skillName)
      const dst = join(homedir(), '.claude', 'skills', skillName)
      if (!existsSync(join(dst, 'SKILL.md')) && existsSync(join(src, 'SKILL.md'))) {
        cpSync(src, dst, { recursive: true, dereference: true })
        log.info(`[migrate] adopted skill ${skillName} from ${src} → ${dst}`)
      }
    }

    // 全删 <agentDir>/skills/
    rmSync(agentSkillsDir, { recursive: true, force: true })
  }

  writeFileSync(marker, new Date().toISOString())
}
```

`sanitizeOnLoad`(profile 层)同步:`SkillItem[]` → `string[]`,取 `.name`。

---

## §4 MCPs 引用化

### §4.1 存储模型

| 角色                 | 现状                                                  | 改后                                                           |
| -------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| 平台 MCP 配置        | `mcp_servers` DB 表(Settings UI 配)                   | 不变(仍是唯一真相)                                             |
| Agent MCP 自定义     | `profile.mcpServers[]` 完整 transport                 | **消失** — agent 仅引用 name                                   |
| 运行时 registry 合成 | `composeMcpSources(platformMcpRegistry, agentOwnMcp)` | 删,改成 platform registry 按 agent.profile.mcpServers 名字过滤 |

### §4.2 buildAgentMcpRegistry(`src/main/agent/agent-manager.ts`)

```diff
- function buildAgentMcpRegistry(mcpServers: McpServerDependency[]): McpRegistry | null {
-   if (mcpServers.length === 0) return null
-   const registry = new McpRegistry()
-   for (const dep of mcpServers) {
-     const transport = dep.transport
-     const config: MCPServerConfig = { id: dep.name, name: dep.name, ... }
-     registry.addPendingConfig(config)
-   }
-   return registry
- }

+ function filterPlatformMcpRegistry(
+   platformRegistry: McpRegistry,
+   allowedNames: string[],
+ ): McpRegistry {
+   // 平台 registry 已含所有已配 MCP, 按 agent 白名单返回受限视图
+   return platformRegistry.filterByNames(allowedNames)
+ }
```

`composeMcpSources` 不再需要(原本用于合并 platform + agent-own,现在只剩 platform)。

### §4.3 数据迁移

存量 agent.json 含 `mcpServers: McpServerDependency[]`,每条含 name + transport。迁移逻辑:

```ts
function onboardLegacyMcps(profile: AgentProfile): string[] {
  const legacyMcps = (profile as any).mcpServers as McpServerDependency[] | string[] | undefined
  if (!legacyMcps) return []

  // 已是 string[] → 直接返回
  if (legacyMcps.length > 0 && typeof legacyMcps[0] === 'string') {
    return legacyMcps as string[]
  }

  const names: string[] = []
  for (const dep of legacyMcps as McpServerDependency[]) {
    names.push(dep.name)
    const existing = mcpServerRepo.findByName(dep.name)
    if (!existing) {
      // 把 agent.json 内的 transport upsert 到 DB
      mcpServerRepo.create({
        id: uuidv4(),
        name: dep.name,
        type: dep.transport.type,
        command: dep.transport.type === 'stdio' ? dep.transport.command : undefined,
        args: dep.transport.type === 'stdio' ? dep.transport.args : undefined,
        env: dep.transport.type === 'stdio' ? dep.transport.env : undefined,
        envFromAccount: dep.transport.type === 'stdio' ? dep.transport.envFromAccount : undefined,
        url: dep.transport.type === 'http' ? dep.transport.url : undefined,
        auth: dep.transport.type === 'http' ? dep.transport.auth : undefined,
        enabled: false, // 用户在 Settings 启用前不连
      })
      log.info(`[migrate] onboarded MCP ${dep.name} from ${profile.id}/agent.json into DB`)
    }
  }
  return names
}
```

**重名冲突策略**:不同 agent 含同 name 但不同 transport — 第一个赢,后面 log warn(用户自己去 Settings 调整)。

### §4.4 Crystallizer 改造

system prompt 加段:

```
当对话中识别到 agent 用了某 MCP server (e.g. github / linear / playwright):
- 不要在 draft 里 inline 定义 transport
- 仅在 mcpServers 字段输出 server name 数组
- 在 draft 末尾加 todo 提示用户:"请到 Settings → MCP Servers 确认 X 已配置"
```

---

## §5 CLIs 引用化

### §5.1 存储模型

| 角色       | 现状                                               | 改后                                    |
| ---------- | -------------------------------------------------- | --------------------------------------- |
| Agent 声明 | `profile.cli[]: CliDependency[]` 含 install method | `profile.cli: string[]` 仅 command name |
| 安装机器   | dep-checker auto-install(npm/brew/script)          | **完全删除**                            |
| 校验       | `${command} --version`                             | `command -v <cmd>`(更轻)                |

### §5.2 dep-checker step 3

```diff
- // 当前 step 3: declare + skill bin 合集 → checkCmd → 失败时 try install
- const skillCliBins = extractSkillCliBins(skillsDir)
- const allCliCommands = [...new Set([...declaredCliCommands, ...skillCliBins])]
- for (const command of allCliCommands) {
-   try { execSync(checkCmd, ...) } catch {
-     if (cliDep?.install) { /* 跑 npm i -g 等 */ }
-     ...
-   }
- }

+ // 改后:仅校验存在
+ const platformSkillsDir = join(homedir(), '.claude', 'skills')
+ const skillCliBins = extractSkillCliBins(platformSkillsDir)
+ const declaredCli = profile.cli ?? []
+ const allCliCommands = [...new Set([...declaredCli, ...skillCliBins])]
+ const missing: string[] = []
+ for (const command of allCliCommands) {
+   try { execSync(`command -v ${command}`, { stdio: 'pipe' }) }
+   catch { missing.push(command) }
+ }
+ if (missing.length > 0) steps.push({ step: 'cli', status: 'missing', message: `缺少 CLI: ${missing.join(', ')}(请手动安装)`, details: missing })
+ else steps.push({ step: 'cli', status: 'pass' })
```

### §5.3 删除 install 相关代码

- `CliInstallNpm` / `CliInstallBrew` / `CliInstallScript` 类型
- dep-checker 内 `npm install -g` / `brew install` / `curl ... | sh` 三个分支
- `agents:install-deps` IPC 仍存在,但内部退化为"重跑 dep-checker"(不再 install)
- `skill-installer.ts` 不主动装 CLI(它本来也没装,只装 skill 包)

### §5.4 数据迁移

```ts
function migrateLegacyCli(profile: AgentProfile): string[] {
  const legacyCli = (profile as any).cli as CliDependency[] | string[] | undefined
  if (!legacyCli) return []
  if (legacyCli.length > 0 && typeof legacyCli[0] === 'string') return legacyCli as string[]
  return (legacyCli as CliDependency[]).map((c) => c.command)
}
```

**install method 信息丢失** — 接受。本地平台用户对自己装的 CLI 有知情;失去 auto-install 是设计取舍而非数据问题。

---

## §6 渲染端改动

### §6.1 AgentEditPage

| 字段       | 现状(假设)                                     | 改后                                                      |
| ---------- | ---------------------------------------------- | --------------------------------------------------------- |
| skills     | 表单 / JSON 列出 `[{name, required, purpose}]` | 多选下拉:列平台 `~/.claude/skills/` 下所有 skill,勾选生效 |
| mcpServers | 表单 / JSON 列出 transport 完整定义            | 多选下拉:列 `mcp_servers` DB 表中已配 MCP,勾选引用        |
| cli        | 表单 / JSON 列出 install method                | 文本输入 + tag list:`['gh', 'jq', 'docker']`              |

**先决条件 IPC**:

- `skills:list-platform`(新):返回 `~/.claude/skills/` 下所有有效 skill
- `mcp:list-configured`(若已存在沿用,否则新建):返回 `mcp_servers` DB 表已配 MCP

### §6.2 Settings → MCP Servers

不需要改 — 已经是 MCP 真相位置。但若 onboard 过程往里加了新条目(`enabled: false`),Settings 列表会**多出来这些待启用的条目**,用户看见即可启用。

### §6.3 AgentDetailPage

deps 状态展示不变(仍是 dep-checker 输出),只是 step 3 / step 4 内容更精简。

---

## §7 测试策略

### §7.1 新增单测

| 文件                                                    | 用例                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/main/skills/registry.test.ts`                      | `fromPlatformDir + filterByNames`、空白名单返回空 registry、不存在的 skill name silently 跳过                 |
| `src/main/agent/agent-manager.test.ts`                  | `filterPlatformMcpRegistry` 按名字过滤、空白名单返回空                                                        |
| `src/main/agent/dependency-checker.test.ts`             | cli step 仅 `command -v`、装失败/装成功路径不存在(因 install 删了)                                            |
| `src/main/agent/loader.test.ts`                         | sanitize 加 `SkillItem[]→string[]`、`McpServerDependency[]→string[] + DB onboard`、`CliDependency[]→string[]` |
| 新文件 `src/main/agent/migrate-platform-skills.test.ts` | 模拟 `<agentDir>/skills/` 含若干 skill,运行迁移后平台目录有、agent 目录无、marker 文件存在防重跑              |

### §7.2 删除测试

- dep-checker auto-install 相关用例全删(`it('auto-installs missing CLI via npm')` 等)
- skill-installer 测试中 "copies to agentDir" 改成 "copies to platform"

### §7.3 手测

1. 启动前在 `~/.talor/agents/sales/skills/foo-skill/SKILL.md` 放个 skill
2. `npm run dev` → 启动迁移 → `~/.claude/skills/foo-skill/SKILL.md` 出现,`~/.talor/agents/sales/skills/` 不存在,`.skills-migrated` 写入
3. 打开 agent 详情 → skill 仍能用
4. 旧 agent 含 mcpServers transport → 启动后 Settings → MCP Servers 列表多出条目(enabled=false)
5. 编辑某 agent → skills 字段是下拉,可勾选 / 取消
6. 创建新 agent(via Crystallizer)→ draft 里 mcpServers 是字符串数组而非对象;`<agentDir>/skills/` 没创建

---

## §8 风险 & 边界

| 风险                                                                        | 缓解                                                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 平台 `~/.claude/skills/` 不存在 / 用户首次跑                                | SkillRegistry.fromPlatformDir 容忍空目录;skill-installer 自建                 |
| MCP onboarding 时 transport 含字面凭据 → 进 DB 仍是 plaintext               | 沿用 validator rule 11 / loader lenient warn,提示用户改 envFromAccount        |
| 删了 auto-install,某些 agent 第一次跑直接卡 "missing CLI"                   | dep-checker 输出更明确;用户体验从"等待 N 秒后报错"变成"立即提示去装",一致更好 |
| Crystallizer 把同名但不同 transport 的 MCP 跨 agent 输出 → onboard 第一个赢 | log warn + 用户在 Settings 手动调                                             |
| `<agentDir>/skills/` 删除后用户找不到他放过的 patch / 临时修改              | migration 期间 cp 到平台前 log info 列出每个文件,事后可从 platform 找回       |
| AgentEditPage 多选下拉依赖 IPC,加载慢时 UI 不响应                           | 一次 fetch + 内存缓存,选项变化时 reload                                       |

---

## §9 实施顺序(建议拆 3 个里程碑独立 PR)

### M1 · Schema + 数据迁移(独立可发)

1. `shared/types/agent.ts` 改 3 字段为 `string[]`,删旧类型
2. `loader.ts` `sanitizeOnLoad` 扩 3 个字段映射
3. MCP onboard 工具函数(`onboardLegacyMcps`)
4. `skill-installer.ts` 目标改平台路径
5. `<agentDir>/skills/` 启动时迁移 + 删除
6. 单测全覆盖

### M2 · 运行时改造(依赖 M1)

7. `SkillRegistry.fromPlatformDir + filterByNames`
8. `buildAgentMcpRegistry` → `filterPlatformMcpRegistry`,删 `composeMcpSources`
9. `agent-manager.ts` 装配链改造
10. `dep-checker` cli step 仅校验存在 + 删 auto-install 代码
11. 集成测验证 agent 启动正常

### M3 · UI + Crystallizer(依赖 M1 + M2)

12. `skills:list-platform` / `mcp:list-configured` IPC
13. AgentEditPage skills/mcp/cli 字段改下拉
14. Crystallizer system prompt 改:输出 name 而非 inline 定义
15. 手测全链路

---

## §10 跟其它 spec 的关系

- 本 spec 依赖 [2026-05-16 schema 简化](./2026-05-16-schema-2-0-simplification-design.md):简化 spec 先把 7 个死字段清掉,本 spec 在更干净的 schema 上做架构改造
- 本 spec 落地后,可顺便考虑 [2026-05-11 schema 2.0 plan](../plans/2026-05-11-agent-schema-2-0.md) 中"未实施"项的清理
- M3 完成后,Crystallizer 不再需要任何 inline 资源定义能力 — 可触发 [Crystallizer 简化 spec(未来)]

---

## §11 Out of Scope

- `<agentDir>/references/` 不动 — references 是 agent 私有资料,引用化无意义
- `subagents` 不动 — 本来就是按 id 引用
- `AgentProfile.version` 字段 — 同简化 spec §9.1,留给未来
- LLM-driven installer — 不再需要(auto-install 整段删了);用户手动装 CLI / 配 MCP / Account
- Skills 跨平台同步(iCloud / Dropbox `~/.claude/skills/`)— 用户系统级方案,不在 Talor 范围
