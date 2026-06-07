# Spec · Schema 2.0 简化 — 移除迁移残留字段与通用化语义

**日期**: 2026-05-16
**分支**: 待定(可在 `feature/remove-agent-migration` 上叠加或另开 `feature/schema-simplification`)
**作者**: Talor AI + Quinn
**状态**: Draft → 待审

---

## §0 上下文

继 [2026-05-16 移除迁移能力](./2026-05-16-remove-agent-migration-fix-mcp-credentials-design.md)之后,Talor 定位明确为**专业本地 agent 平台**。Schema 2.0 里有几处设计是**为迁移与分享场景服务**的,在本地用户写自己 agent 的语境下没有意义,清掉可减少认知负担与代码维护面。

本次动三处:

| 项                                                                                                                                 | 类别        | 设计初衷                          | 本地语境下的实际作用                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------- | ------------------------------------------------ |
| `AgentProfile.minAppVersion` + dep-checker step 1                                                                                  | 字段 + 检查 | 迁移目标机 Talor 版本检查         | 永远满足(本机自产),纯死循环                      |
| Validator rule 9 + entity-extractor + Crystallizer redact                                                                          | 通用化保护  | 让分享出去的 agent 不锚定具体实体 | 用户自己写自己用,具体实体合理且有用              |
| 7 个 dead 子字段(`SkillItem.purpose/required`、`McpServerDependency.description/required/tools`、`CliDependency.version/required`) | 字段        | 迁移/分享辅助元数据               | 全代码库 0 消费者;字段为 true/false 行为完全一样 |

类 B(`AgentProfile.version` 字段去留)**本次不动** — 改动牵涉 Crystallizer / AgentEditPage / 数据迁移,见 §9 Out of Scope。

更深的架构重构(skills/MCPs/cli 从"agent 自带"改成"引用平台资源")独立立项,见 [Plan B spec](./2026-05-18-schema-reference-architecture-design.md)。

---

## §1 目标 & Definition of Done

### §1.1 目标

1. 删除 `AgentProfile.minAppVersion` 字段、validator rule 4 对其的 semver 校验、dep-checker step 1、`DependencyStepName` 枚举中的 `'minAppVersion'`
2. 删除 validator rule 9(entity pollution warning)及其调用 `validateNoSpecificEntities`
3. 删除 `src/main/agent/entity-extractor.ts` 整个模块及其测试
4. 修改 `serializeS1History`:不再调 `redactEntities`,直接吐原文给 Crystallizer
5. 删 7 个 dead 子字段(详见 §4)
6. 不破坏 Crystallizer / AgentEditPage / dep-checker / agent 运行链路
7. 存量 agent.json 中的废弃字段:loader 静默 strip(内存级,不写回磁盘)

### §1.2 Definition of Done

- [ ] `grep -r minAppVersion src/` 无匹配(除 docs 与本 spec 自身)
- [ ] `src/main/agent/entity-extractor.ts` 不存在
- [ ] `src/main/agent/entity-extractor.test.ts` 不存在
- [ ] `grep -r redactEntities src/` 无匹配
- [ ] `grep -r extractEntities src/` 无匹配
- [ ] Validator rule 4 / rule 9 / dep-checker step 1 相关测试用例已删
- [ ] `serializeS1History` 不再含脱敏调用;`serializeS1HistoryRaw` 已合并删除
- [ ] AgentLoader.sanitizeOnLoad 加载后 profile 不含:`minAppVersion`、`SkillItem.purpose/required`、`McpServerDependency.description/required/tools`、`CliDependency.version/required`
- [ ] `SkillItem` / `McpServerDependency` / `CliDependency` 7 个死字段从 schema 类型定义中删除
- [ ] 所有单测 + typecheck 通过
- [ ] 手测一遍:Crystallizer 跑通,生成的 draft 含具体业务实体而非占位符,且不含 7 个死字段

---

## §2 字段与代码改动 · minAppVersion

### §2.1 Schema(`src/shared/types/agent.ts`)

```diff
  export interface AgentProfile {
    schemaVersion: typeof SCHEMA_VERSION
    id: string
    name: string
    description: string
    version: string
-   minAppVersion?: string
    avatar?: string
    agentPrompt: string
    // ...
  }

  export type DependencyStepName =
-   | 'minAppVersion'
    | 'cli'
    | 'skill'
    | 'mcpServer'
    | 'tool'
    | 'subagent'
    | 'config'
    | 'references'
    | 'complete'
```

### §2.2 Validator(`src/main/agent/validator.ts`)

rule 4 当前同时校验 `version` 与 `minAppVersion` 的 semver。**保留 version 校验**,删后半段:

```diff
  // RULE 4: semver
  if (typeof o.version === 'string' && !semverValid(o.version)) {
    errors.push({ severity: 'error', rule: 4, path: 'version', message: 'must be valid semver' })
  }
- if (o.minAppVersion !== undefined && o.minAppVersion !== null) {
-   if (typeof o.minAppVersion !== 'string' || !semverValid(o.minAppVersion)) {
-     errors.push({
-       severity: 'error',
-       rule: 4,
-       path: 'minAppVersion',
-       message: 'must be valid semver',
-     })
-   }
- }
```

### §2.3 dep-checker(`src/main/agent/dependency-checker.ts`)

删 step 1 + 函数签名里 `opts?.appVersion` 不再有意义(单一消费者)。`opts.appVersion` 参数仍保留以避免破坏调用签名,但内部不再读。

```diff
- // Step 1: minAppVersion
- if (minAppVersion) {
-   if (!semverValid(minAppVersion) || !semverGte(appVersion, minAppVersion)) {
-     steps.push({
-       step: 'minAppVersion',
-       status: 'fail',
-       message: `需要 Talor >= ${minAppVersion}，当前版本 ${appVersion}`,
-     })
-   } else {
-     steps.push({ step: 'minAppVersion', status: 'pass' })
-   }
- } else {
-   steps.push({ step: 'minAppVersion', status: 'pass' })
- }
```

`semver` 包剩 `semverValid` 唯一用途(validator rule 4),保留 import。`semverGte` 在 dep-checker 此次删后可能无引用,grep 确认后清。

### §2.4 Loader sanitize(`src/main/agent/loader.ts`)

`sanitizeOnLoad` 现已 strip `serverPackage`,扩展 strip `minAppVersion`:

```diff
  function sanitizeOnLoad(raw: unknown, agentDirName: string): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
    const cloned = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>

+   let removedMinAppVersion = false
+   if ('minAppVersion' in cloned) {
+     delete cloned.minAppVersion
+     removedMinAppVersion = true
+   }

    const mcpServers = cloned.mcpServers
    // ... existing serverPackage logic
+
+   if (removedMinAppVersion) {
+     log.info(`[AgentLoader] ${agentDirName}: stripped dead minAppVersion field at load`)
+   }
    return cloned
  }
```

### §2.5 渲染端 / Crystallizer / Preview

`grep minAppVersion src/renderer` 当前无匹配 — 不需要改 UI。
`grep minAppVersion src/main/agent/{crystallizer,preview,templates}.ts` 确认是否模板里有,有则清。

---

## §3 删除 entity-extractor 模块

### §3.1 删除文件

| 文件                                      | 处置 |
| ----------------------------------------- | ---- |
| `src/main/agent/entity-extractor.ts`      | 整删 |
| `src/main/agent/entity-extractor.test.ts` | 整删 |

### §3.2 Validator(`src/main/agent/validator.ts`)

```diff
- import { extractEntities } from './entity-extractor'

  // ... rules 1-8, 10-11 unchanged ...

  if (errors.length > 0) return { valid: false, errors, warnings }

  const profile = o as unknown as AgentProfile

- // W1 (rule 9): 实体污染
- validateNoSpecificEntities(profile, warnings)

  return { valid: true, profile, warnings }
}

- // ─── W1 (rule 9): description / agentPrompt / references.description 不含具体实体 ──
-
- function validateNoSpecificEntities(profile: AgentProfile, warnings: ValidatorIssue[]): void {
-   // ... 整个函数删
- }
```

### §3.3 draft-extractor(`src/main/agent/draft-extractor.ts`)

`serializeS1History` 当前末尾走 `redactEntities` 给 Crystallizer 看脱敏文本。**新定位下应直接吐原文** — 用户写自己的 agent,锚定 "BIDU / 百度 / klook" 等具体实体合理。

```diff
- import { redactEntities } from './entity-extractor'

  export function serializeS1History(messages: ChatMessage[]): string {
    const parts: string[] = []
    for (const msg of messages) {
      if (msg.role === 'system') continue
      const textPart = extractTextFromContent(msg.content)
      parts.push(`**${msg.role}**: ${textPart.trim()}`)
    }
    let output = parts.join('\n\n---\n\n')
    if (output.length > SNAPSHOT_MAX_CHARS) {
      output = output.slice(0, SNAPSHOT_MAX_CHARS) + '\n[...truncated]'
    }
-   // D1: 脱敏。crystallizer 应基于"对话结构"而非"具体实体"产出 profile。
-   const { redacted } = redactEntities(output)
-   return redacted
+   return output
  }
```

### §3.4 合并 `serializeS1History` 与 `serializeS1HistoryRaw`

`serializeS1HistoryRaw` 一直是"不脱敏版本"。删 redact 后两者逻辑等同,合一个函数即可。

**做法**:删 `serializeS1HistoryRaw`,所有调用方改用 `serializeS1History`。  
**前置**:grep `serializeS1HistoryRaw` 看调用方,确保改完。

### §3.5 Crystallizer prompt 调整(可选)

`crystallizer.ts` 的系统 prompt 若含"避免提到具体公司/产品名"等通用化引导,应一并撤掉 — 与"用户写自己 agent"语境冲突。

grep `crystallizer.ts` 内是否有"avoid specific entities" / "通用化" / "脱敏" / "redact" 等表述,有则一并撤。

---

## §4 删 7 个 dead 子字段

审计结论:7 个字段在代码中**零消费者**,字段为 true/false 跑出来的行为完全一样,纯认知噪声。

### §4.1 审计明细

| 字段                                       | 代码消费者                                                                 | 删除影响   |
| ------------------------------------------ | -------------------------------------------------------------------------- | ---------- |
| `SkillItem.required: boolean`              | dep-checker step 2 只检查 SKILL.md 文件存在,不读 required                  | 行为零变化 |
| `SkillItem.purpose?: string`               | 仅注释提到,代码 0 引用                                                     | 行为零变化 |
| `McpServerDependency.description?: string` | 0 引用(注意:不是 MCP tool 的 description,是 dependency wrapper 的)         | 行为零变化 |
| `McpServerDependency.required: boolean`    | 0 引用                                                                     | 行为零变化 |
| `McpServerDependency.tools: string[]`      | 0 引用 — 运行时 `server.listTools()` 返回真实工具列表,声明的白名单无人执行 | 行为零变化 |
| `CliDependency.version?: string`           | 0 引用                                                                     | 行为零变化 |
| `CliDependency.required: boolean`          | 0 引用                                                                     | 行为零变化 |

唯一真用 `required` 的是 `SubagentRef.required`(dep-checker step 5b 真的判 `if (ref.required && !registered)`),**该字段保留**。

### §4.2 Schema 改动(`src/shared/types/agent.ts`)

```diff
  export interface SkillItem {
    name: string
-   required: boolean
-   purpose?: string
  }

  export interface McpServerDependency {
    name: string
-   description?: string
    transport: McpTransportConfig
-   tools: string[]
-   required: boolean
  }

  export interface CliDependency {
    command: string
-   version?: string
    checkCommand?: string
    install: CliInstallMethod
-   required: boolean
  }
```

`SubagentRef.required` 不动。

### §4.3 Validator 简化

当前 validator 若对这些字段有形态校验(`required: boolean` 类型检查、`tools: string[]` 数组校验等),一并删。grep `validator.ts` 内 `required` / `tools` / `purpose` / `description` 引用做精确清理。

### §4.4 Crystallizer 默认输出调整

`crystallizer.ts` system prompt 或模板代码若生成 `required: true` / `purpose: '...'` / `description: '...'` / `tools: [...]` 默认值,一并清。  
grep `crystallizer.ts` + 模板 fixture 找。

### §4.5 AgentEditPage UI

如果表单 / JSON 编辑器对这些字段有展示或编辑控件:

- JSON 编辑形态 → 用户自己 JSON 不再含这些字段就 OK,validator 不再报"unknown field"(JSON 校验目前已宽松,无需特别处理)
- 表单形态(若存在 required 复选框、purpose 输入框等)→ 删 UI

grep `AgentEditPage.tsx` 内 `required` / `purpose` / `tools` 等字段名兜底。

---

## §5 数据迁移

### §5.1 触发时机与策略

沿用现有 `AgentLoader.sanitizeOnLoad` 模式,**只在内存中清理,不写回磁盘**(用户原 agent.json 文件不动)。

### §5.2 清洗内容(扩展)

| 字段                                                           | 处置                                       |
| -------------------------------------------------------------- | ------------------------------------------ |
| `minAppVersion`(§2)                                            | strip,log info                             |
| `SkillItem.required` / `SkillItem.purpose`(§4)                 | strip,log info(批量统计 N 个 skill 清理了) |
| `McpServerDependency.description` / `.required` / `.tools`(§4) | strip,log info                             |
| `CliDependency.version` / `.required`(§4)                      | strip,log info                             |
| `mcpServers[].serverPackage`(上轮已实现)                       | 沿用                                       |
| `mcpServers[].transport.stdio.env[k]` 含可疑凭据值             | 沿用 lenient warn(不动)                    |

实现上 `sanitizeOnLoad` 扩展成集中清理点,逐字段过一遍。

### §5.3 不在迁移范围

- 不重写 agent.json 删 `version` 字段 — version 仍保留语义,见 §9
- 不修改 schemaVersion(仍是 `'2.0'`)— 删字段是非破坏性变更

---

## §6 测试改动

### §6.1 删除测试用例

| 文件                                        | 删除内容                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/main/agent/validator.test.ts`          | `it('rejects bad minAppVersion')`(rule 4)+ `it('warns on specific entities in description')`(rule 9 / W1) |
| `src/main/agent/dependency-checker.test.ts` | `it('minAppVersion fail')` + `it('minAppVersion pass')`                                                   |
| `src/main/agent/ac-verification.test.ts`    | `AC-B2-01: minAppVersion 不满足时报错` block                                                              |
| `src/main/agent/entity-extractor.test.ts`   | 整文件删                                                                                                  |

### §6.2 新增测试用例

| 文件                                             | 新增                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/agent/loader.test.ts`                  | sanitize 测试加项:`strips dead minAppVersion field`、`strips dead SkillItem.purpose/required`、`strips dead McpServerDependency.{description,required,tools}`、`strips dead CliDependency.{version,required}` — 写带这些字段的 agent.json,断言加载后 profile 不含 |
| `src/main/agent/draft-extractor.test.ts`(若存在) | 验证 `serializeS1History` 输出含原始实体名(如断言输出包含 "BIDU" 而不是 "<TICKER_X>")                                                                                                                                                                             |

### §6.3 手测脚本

1. `npm run dev` 启动
2. 跟 `__chat__` 跑一轮含具体实体的对话(例:"分析 BIDU 的销售数据")
3. Crystallize → workbench → Crystallizer 给的 draft 应**含具体实体**(BIDU、百度等),不再用 `<TICKER_X>` 占位
4. 保存 agent → 打开 agent.json 检查无:`minAppVersion`、`SkillItem.purpose/required`、`McpServerDependency.{description,required,tools}`、`CliDependency.{version,required}`
5. AgentDetailPage 显示 dep-checker 状态,**不应**出现 `minAppVersion` step
6. 任意含废弃字段的旧 agent(若你本机有)加载后,profile 不再含该字段

---

## §7 风险 & 边界

| 风险                                                              | 处理                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Crystallizer 失去通用化引导,产出的 agent 可能"高度个性化"难复用   | 接受 — 新定位的核心权衡:本地用户 agent **就是**为他自己写的                                          |
| `dep-checker.opts.appVersion` 参数仍存在但无人读,可能给读者错觉   | 保留签名兼容性,内部不读;或彻底删 param。倾向**保留**(签名稳定优先)                                   |
| `serializeS1HistoryRaw` 调用方未察觉合并                          | grep + typecheck 兜底,合并删除前清理调用方                                                           |
| 存量 `entity-extractor.test.ts` 引用第三方包(如 yaml)是否要清依赖 | grep 确认是否仅此模块用,若是顺带 cleanup                                                             |
| 用户在 AgentEditPage 表单看到的字段突然消失                       | 如果当前是 JSON 编辑形态:无影响。如果有表单 UI:平台自带 form 会按 schema 重新渲染,旧字段消失视觉一致 |

---

## §8 实施顺序

单 PR,顺序:

1. `shared/types/agent.ts` 删 `minAppVersion` + `DependencyStepName` 'minAppVersion' 枚举值 + 7 个 dead 子字段
2. `validator.ts` 删 rule 4 minAppVersion 半段 + rule 9 / `validateNoSpecificEntities` / `extractEntities` import + 死字段相关校验
3. `dependency-checker.ts` 删 step 1
4. `loader.ts` `sanitizeOnLoad` 扩 strip `minAppVersion` + 7 个 dead 子字段
5. `draft-extractor.ts` 删 redact 调用 + 合并 `serializeS1HistoryRaw`
6. 删 `entity-extractor.ts` + `entity-extractor.test.ts`
7. `crystallizer.ts` 调整默认输出(不再写 required:true / purpose / description / tools 默认值)
8. AgentEditPage 死字段 UI 清理(若有)
9. 删测试用例(§6.1)+ 加新测试(§6.2)
10. grep 兜底:`minAppVersion`、`redactEntities`、`extractEntities`、`serializeS1HistoryRaw`、`SkillItem.required`、`SkillItem.purpose`、`McpServerDependency.description`、`McpServerDependency.required`、`McpServerDependency.tools`、`CliDependency.required`、`CliDependency.version` 全代码库 0 匹配
11. `npm run typecheck`
12. `npm test`
13. 手测脚本(§6.3)

---

## §9 Out of Scope

明确**不做**(等需求自然浮现再独立立项):

### §9.1 `AgentProfile.version` 字段去留

`version` 在迁移场景用于冲突解决,本地无消费者,但牵涉:

- Crystallizer 默认在 draft 设 `version: '1.0.0'`
- AgentEditPage 可能显示 version 字段供用户改
- 用户心理上"agent 有版本号"是合理预期(与文档/Skill 的版本同语义)

权衡复杂,工作量与本次不匹配。**保留现状**。

### §9.2 `schemaVersion` 字段

未来 Talor 升级若改 schema(例:`agentPrompt` 拆 `prompt.md`)仍需要它做内部数据迁移检测。**保留**。

### §9.3 `SubagentRef.required` 字段

dep-checker step 5b 真消费 — `if (ref.required && !registered) → push missingSubagents`。**保留**。

### §9.4 Validator rule 10 / 11(envFromAccount + 凭据扫描)

跟迁移无关,是 MCP 凭据机制的一部分。**保留**。

### §9.5 引用化架构(skills/MCPs/cli 从"agent 自带"改成"引用平台资源")

独立立项,见 [2026-05-18 引用化架构 spec](./2026-05-18-schema-reference-architecture-design.md)。

### §9.6 Crystallizer 其他 prompt 优化

只做"撤通用化引导"那一处;其它 prompt 调整独立立项。
