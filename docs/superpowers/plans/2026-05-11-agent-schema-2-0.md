# Agent Schema 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Talor's 6-section nested Agent Profile schema (v1.0) with a flat 15-field schema (v2.0) where `agentPrompt` carries all LLM-facing behavior as free markdown and only `description / tools / skills / mcpServers / cli / references / subagents / preferences` remain structured.

**Architecture:** Clean break, **no backward-compat at all**. v1.0 agent.json files are rejected by the validator with rule 1 ("must be 2.0"). No migration module, no in-memory upgrade. Users with existing v1.0 agents must edit manually or recreate. Five phases, each committed independently.

**Tech Stack:** TypeScript (electron-vite, three tsconfigs: main/preload/renderer), vitest, handlebars-style mustache (custom render.ts), Ajv (will be removed alongside contract-guard).

**Spec source of truth:** Final design in conversation 2026-05-11. Key field decisions:

- 15 top-level fields, 6 required (`schemaVersion / id / name / description / version / agentPrompt`)
- No `mission` / `method` / `delivery` / `execution` sub-objects
- `description` is multi-line and absorbs former `scope.in` / `scope.out`
- `references[]` (renamed from `knowledge[]`) is file-only index, no auto-inject
- `deliverables` entirely removed; `contract-guard.ts` deleted

---

## Pre-flight

- [ ] **Confirm clean working tree**

```bash
git status
```

Expected: `working tree clean`. If not, stash or commit before proceeding.

- [ ] **Snapshot current test baseline**

```bash
npm test 2>&1 | tail -30
```

Record the pass/fail count. Any pre-existing failures will be tolerated; new failures introduced by this plan must be fixed.

- [ ] **Run typecheck baseline**

```bash
npm run typecheck
```

Expected: clean (or list of pre-existing errors). Anything from `src/main/agent/*` / `src/shared/types/agent.ts` / `src/main/prompt/*` / `src/main/loop/*` is fair game to change.

---

## File Structure

### Created

- `src/main/prompt/templates/agent-system-prompt.v2.md` — new compact template.
- `docs/superpowers/plans/2026-05-11-agent-schema-2-0.md` — this plan.

### Modified

- `src/shared/types/agent.ts` — full rewrite (511 → ~110 lines)
- `src/main/agent/validator.ts` — full rewrite (1183 → ~220 lines)
- `src/main/prompt/runtime-context.ts` — adapt to v2.0 fields (drop mission/method/delivery context shape)
- `src/main/prompt/plugins/AgentPromptPlugin.ts` — minor: `identity.name` → `name`, `identity.description` → `description`
- `src/main/prompt/template-loader.ts` — load `agent-system-prompt.v2.md`
- `src/main/agent/loader.ts` — field path fixes (`profile.identity.X` → `profile.X`); v1.0 files now fail validator rule 1 and are skipped with warn
- `src/main/agent/importer.ts` — field path fixes + improved error formatter (`ValidatorIssue[]` is not string-joinable)
- `src/main/agent/templates.ts` — rewrite all built-in templates to v2.0
- `src/main/agent/agent.ts` — drop `resolvedAcceptance` field/builder (no acceptance in v2.0)
- `src/main/agent/agent-manager.ts` — strip the large embedded prompt text describing 1.0 schema; new shorter v2.0 description; field paths
- `src/main/agent/dependency-checker.ts` — rename `knowledge` step to `references`; field path
- `src/main/agent/delegate-agent.ts` — listing uses `description` + first paragraph of `agentPrompt`; drop deliverables/outcomes formatting
- `src/main/agent/dry-runner.ts` — drop `verify` / `extractDeliverable` calls; report becomes "rendered + dependency-check only"
- `src/main/agent/exporter.ts` — no schema change needed; verify `-r` recurses into `references/` (it does)
- `src/shared/types/agent.test.ts` — rewrite for v2.0 type smoke tests
- `src/main/agent/validator.test.ts` — rewrite for the 6 hard rules + 1 warn
- `src/main/prompt/runtime-context.test.ts` — rewrite
- `src/main/prompt/plugins/AgentPromptPlugin.test.ts` — rewrite
- `src/main/agent/loader.test.ts` — v2.0 fixtures + v1.0 rejection negative test
- `src/main/agent/delegate-agent.test.ts` — update listing assertions
- `src/main/agent/dependency-checker.test.ts` — rename test cases
- `src/main/agent/dry-runner.test.ts` — drop acceptance assertions
- `src/main/agent/agent.test.ts` — drop resolvedAcceptance assertions
- `src/main/agent/agent-manager.test.ts` — adjust crystallizer prompt assertions
- `src/main/agent/skill-installer.test.ts` — only if it constructs profiles
- `src/main/agent/draft-extractor.test.ts` — only if it constructs profiles
- `src/main/agent/crystallizer-heuristics.test.ts` — only if profile-shaped
- `src/main/agent/preview.test.ts` — adjust
- `src/main/prompt/naturalize.test.ts` — naturalize is only used by 1.0 acceptance rendering; either delete `naturalize.ts` or keep as no-op
- `vibe/project/patterns.md` — append "领域知识加载策略" section
- `CLAUDE.md` — update §2 code map blurb and §3 必读文档 references

### Deleted

- `src/main/loop/contract-guard.ts`
- `src/main/loop/contract-guard.test.ts`
- `src/main/prompt/templates/agent-system-prompt.v1.md` (replaced by v2.md)
- `src/main/prompt/naturalize.ts` if no remaining caller (likely yes)
- `src/main/prompt/naturalize.test.ts` (paired)

---

## Phase 1: Types + Validator (no migration)

> Single commit. Goal: new types compile; validator passes a v2.0 fixture; existing v1.0 agent.json files on disk get rejected at load (logged as warn, agent skipped). Runtime is NOT yet wired (Phase 2 does plugin + template).

### Task 1.1: Rewrite `src/shared/types/agent.ts`

**Files:**

- Modify: `src/shared/types/agent.ts` (full rewrite)

- [ ] **Step 1: Replace file contents**

```ts
// src/shared/types/agent.ts — 共享类型：Agent Schema 2.0
//
// 设计原则:
//   - 顶层 15 字段扁平结构,无 mission/method/delivery/execution 包装
//   - 6 必填: schemaVersion, id, name, description, version, agentPrompt
//   - 行为面统一在 agentPrompt (自由 markdown)
//   - 仅保留代码真正读、真正用的字段;契约/验证回到 prompt 通路
//   - 与 Claude Agent SDK 形态对齐

export const SCHEMA_VERSION = '2.0' as const

// ═══ AgentProfile 顶层 ═══════════════════════════════════════
export interface AgentProfile {
  schemaVersion: typeof SCHEMA_VERSION

  // ── Manifest ──
  id: string
  name: string
  /**
   * 多行叙述。三段紧凑成文：
   *   1. 一句话身份（UI 列表 / delegate listing 截断显示）
   *   2. 会做什么（2-5 条短句）
   *   3. 不会做什么（2-5 条短句；命中应礼貌拒绝）
   */
  description: string
  version: string
  minAppVersion?: string
  avatar?: string

  // ── 行为定义（自由 markdown） ──
  /**
   * 完整 agent 操作手册。承载输入引导、工作流、原则、输出格式、风格。
   * 渲染时整段塞进 system prompt。
   */
  agentPrompt: string

  // ── 依赖 manifest ──
  tools?: BuiltinToolName[]
  skills?: SkillItem[]
  mcpServers?: McpServerDependency[]
  cli?: CliDependency[]
  /** Agent 专属参考资料(按需 read 加载,不自动注入) */
  references?: ReferenceFile[]
  subagents?: AgentCollaboration

  // ── 运行时偏好 ──
  preferences?: AgentPreferences
}

// ═══ 子结构 ═══════════════════════════════════════════════════

export type BuiltinToolName = 'read' | 'write' | 'edit' | 'bash' | 'glob' | 'grep' | 'ls'

export const BUILTIN_TOOL_NAMES: readonly BuiltinToolName[] = [
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'ls',
] as const

/**
 * 参考资料文件索引。LLM 看到清单后用 `read` 工具按需加载,不预读。
 * 建议放在 <agent_dir>/references/ 下。
 */
export interface ReferenceFile {
  /** snake_case;agentPrompt 中可用 @<id> 引用 */
  id: string
  /** 相对 agent 根目录的路径;禁止 ../ 越界 */
  path: string
  description: string
}

export interface SkillItem {
  name: string
  required: boolean
  purpose?: string
}

export interface McpServerPackage {
  type: 'npm' | 'pip'
  package: string
}
export interface McpTransportStdio {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}
export interface McpTransportHttp {
  type: 'http'
  url: string
  auth?: { type: 'bearer' | 'apiKey'; envVar: string }
}
export type McpTransportConfig = McpTransportStdio | McpTransportHttp

export interface McpServerDependency {
  name: string
  description?: string
  serverPackage?: McpServerPackage
  transport: McpTransportConfig
  tools: string[]
  required: boolean
}

export interface CliInstallNpm {
  type: 'npm'
  package: string
}
export interface CliInstallBrew {
  type: 'brew'
  formula: string
}
export interface CliInstallScript {
  type: 'script'
  url: string
}
export type CliInstallMethod = CliInstallNpm | CliInstallBrew | CliInstallScript

export interface CliDependency {
  command: string
  version?: string
  checkCommand?: string
  install: CliInstallMethod
  required: boolean
}

export interface AgentCollaboration {
  ids?: SubagentRef[]
  /** true 时可委托所有已注册业务 agent;与 ids 同时声明 ids 优先 */
  allowAny?: boolean
}
export interface SubagentRef {
  id: string
  required: boolean
  purpose?: string
}

export interface AgentPreferences {
  modelId?: string
  providerId?: string
}

// ═══ 运行时辅助类型 (基本沿用) ════════════════════════════════
export type AgentStatus = 'disabled' | 'ready' | 'dependency_missing' | 'running'

export interface AgentEntry {
  profile: AgentProfile
  dirPath: string
  status: AgentStatus
  lastUsedAt?: string
}

export interface ValidatorIssue {
  severity: 'error' | 'warn'
  /** 规则编号(1..9)。0 = 输入级错误 */
  rule: number
  /** JSON path */
  path: string
  message: string
}

export interface ValidateProfileSuccess {
  valid: true
  profile: AgentProfile
  warnings: ValidatorIssue[]
}
export interface ValidateProfileFailure {
  valid: false
  errors: ValidatorIssue[]
  warnings: ValidatorIssue[]
}
export type ValidateProfileResult = ValidateProfileSuccess | ValidateProfileFailure

// ═══ 账户管理 (保留,与 schema 无关) ════════════════════════════
export interface AccountKey {
  name: string
  value: string
  secret: boolean
}
export interface Account {
  service: string
  keys: AccountKey[]
}
export interface AccountsData {
  accounts: Account[]
}
export interface ResolveResult {
  resolved: Record<string, string>
  missing: string[]
}

// ═══ 依赖检查类型 ═══════════════════════════════════════════
export type DependencyStepName =
  | 'minAppVersion'
  | 'cli'
  | 'skill'
  | 'mcpServer'
  | 'tool'
  | 'subagent'
  | 'config'
  | 'references' // renamed from 'knowledge'
  | 'complete'

export interface DependencyStepResult {
  step: DependencyStepName
  status: 'pass' | 'missing' | 'fail'
  message?: string
  details?: string[]
}

export interface DependencyCheckResult {
  passed: boolean
  steps: DependencyStepResult[]
}

// ═══ Skill 安装 (保留) ═══════════════════════════════════════
export interface SkillInstallProgress {
  skill: string
  status: 'installing' | 'installed' | 'failed'
  installHint?: string
}

export interface SkillInstallResult {
  installed: string[]
  failed: Array<{ name: string; hint: string }>
}
```

- [ ] **Step 2: Note deletions**

Verify these types are NOT in the new file (search to confirm):

```
AgentIdentity, AgentMission, AgentMethod, AgentDelivery, AgentExecution,
AgentScope, Outcome, MissionInput, KnowledgeRef, ToolDependency,
Deliverable, ExtractRule, AcceptanceCriterion, RetryPolicy, AgentRef,
AgentLimits, WorkflowSpec, WorkflowStep, WorkflowStepUse, Severity
```

These are deliberately gone. Anything that imports them must be updated in later tasks.

- [ ] **Step 3: Verify file compiles in isolation**

```bash
npx tsc --noEmit --skipLibCheck src/shared/types/agent.ts
```

Expected: clean. (May warn about unused exports — that's OK.)

### Task 1.3: Rewrite validator

**Files:**

- Modify: `src/main/agent/validator.ts` (full rewrite, 1183 → ~220 lines)
- Modify: `src/main/agent/validator.test.ts` (full rewrite)

- [ ] **Step 1: Write failing tests**

```ts
// src/main/agent/validator.test.ts
import { describe, it, expect } from 'vitest'
import { validateProfile } from './validator'
import type { AgentProfile } from '@shared/types/agent'

function minimal(over: Partial<AgentProfile> = {}): AgentProfile {
  return {
    schemaVersion: '2.0',
    id: 'test',
    name: 'Test',
    description: 'A test agent.',
    version: '1.0.0',
    agentPrompt: '## Workflow\n1. Do.\n\n## Principles\n- Be good.\n\n## Output\nFree-form.',
    ...over,
  }
}

describe('validateProfile (v2.0)', () => {
  it('accepts minimal valid profile', () => {
    const r = validateProfile(minimal())
    expect(r.valid).toBe(true)
  })

  // RULE 1
  it('rejects non-object input', () => {
    expect(validateProfile(null).valid).toBe(false)
    expect(validateProfile('string').valid).toBe(false)
    expect(validateProfile([]).valid).toBe(false)
  })

  it('rejects wrong schemaVersion', () => {
    const r = validateProfile({ ...minimal(), schemaVersion: '1.0' as never })
    expect(r.valid).toBe(false)
    if (!r.valid)
      expect(r.errors.some((e) => e.rule === 1 && e.path === 'schemaVersion')).toBe(true)
  })

  // RULE 2 必填非空
  it('rejects empty required fields', () => {
    for (const f of ['id', 'name', 'description', 'version', 'agentPrompt'] as const) {
      const r = validateProfile(minimal({ [f]: '' } as Partial<AgentProfile>))
      expect(r.valid).toBe(false)
    }
  })

  // RULE 3 id format
  it('rejects bad id format', () => {
    const r = validateProfile(minimal({ id: 'Bad Id!' }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 3)).toBe(true)
  })
  it('accepts platform agent id pattern __chat__', () => {
    const r = validateProfile(minimal({ id: '__chat__' }))
    expect(r.valid).toBe(true)
  })

  // RULE 4 semver
  it('rejects bad version', () => {
    expect(validateProfile(minimal({ version: 'foo' })).valid).toBe(false)
  })
  it('rejects bad minAppVersion', () => {
    expect(validateProfile(minimal({ minAppVersion: 'foo' })).valid).toBe(false)
  })

  // RULE 5 tools whitelist
  it('rejects non-builtin tool', () => {
    const r = validateProfile(minimal({ tools: ['read', 'NOPE' as never] }))
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 5)).toBe(true)
  })

  // RULE 6 references
  it('rejects bad reference id', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'Bad Id', path: 'r/a.md', description: 'x' }],
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })
  it('rejects path with ..', () => {
    const r = validateProfile(
      minimal({
        references: [{ id: 'a', path: '../escape.md', description: 'x' }],
      }),
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 6)).toBe(true)
  })
  it('rejects duplicate reference id', () => {
    const r = validateProfile(
      minimal({
        references: [
          { id: 'a', path: 'r/1.md', description: 'x' },
          { id: 'a', path: 'r/2.md', description: 'y' },
        ],
      }),
    )
    expect(r.valid).toBe(false)
  })

  // RULE 7 subagents
  it('flags unknown subagent id when context provided', () => {
    const r = validateProfile(
      minimal({
        subagents: { ids: [{ id: 'unknown', required: true }] },
      }),
      { knownAgentIds: new Set(['known']) },
    )
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 7)).toBe(true)
  })

  // RULE 8 model
  it('flags unknown model id when context provided', () => {
    const r = validateProfile(minimal({ preferences: { modelId: 'imaginary' } }), {
      knownModelIds: new Set(['sonnet']),
    })
    expect(r.valid).toBe(false)
    if (!r.valid) expect(r.errors.some((e) => e.rule === 8)).toBe(true)
  })

  // W1 entity pollution (warn only)
  it('warns on specific entities in description', () => {
    const r = validateProfile(minimal({ description: 'Reviews code for 百度 and BIDU stocks.' }))
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => w.rule === 9)).toBe(true) // W1 → numbered 9
  })
})
```

Run:

```bash
npx vitest run src/main/agent/validator.test.ts
```

Expected: ALL FAIL (validator still has 1.0 rules).

- [ ] **Step 2: Replace validator.ts content**

```ts
// src/main/agent/validator.ts — 业务层: AgentProfile Schema 2.0 校验
//
// 9 条规则: 8 hard + 1 warn。详见 docs/superpowers/plans/2026-05-11-agent-schema-2-0.md §III.
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*、repos/*

import { existsSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { valid as semverValid } from 'semver'
import type {
  AgentProfile,
  ValidateProfileResult,
  ValidatorIssue,
  ReferenceFile,
} from '@shared/types/agent'
import { BUILTIN_TOOL_NAMES } from '@shared/types/agent'
import { extractEntities } from './entity-extractor'

export interface ValidatorContext {
  /** 已注册工具名集合,不传时跳过 rule 5 严格匹配 */
  knownToolNames?: Set<string>
  /** 已注册模型 id 集合,不传时跳过 rule 8 */
  knownModelIds?: Set<string>
  /** 已注册 agent id 集合,不传时跳过 rule 7 */
  knownAgentIds?: Set<string>
  /** agent 根目录,用于 references[].path 存在性检查 */
  agentRoot?: string
}

const ID_RE = /^[a-z0-9_-]+$/
const PLATFORM_ID_RE = /^__[a-z0-9_-]+__$/

export function validateProfile(json: unknown, ctx: ValidatorContext = {}): ValidateProfileResult {
  const errors: ValidatorIssue[] = []
  const warnings: ValidatorIssue[] = []

  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return {
      valid: false,
      errors: [
        { severity: 'error', rule: 0, path: '', message: 'input must be a non-null object' },
      ],
      warnings: [],
    }
  }
  const o = json as Record<string, unknown>

  // RULE 1: schemaVersion
  if (o.schemaVersion !== '2.0') {
    errors.push({
      severity: 'error',
      rule: 1,
      path: 'schemaVersion',
      message: `must be "2.0", got ${JSON.stringify(o.schemaVersion)}`,
    })
    return { valid: false, errors, warnings }
  }

  // RULE 2: 必填字段类型 + 非空
  for (const f of ['id', 'name', 'description', 'version', 'agentPrompt'] as const) {
    const v = o[f]
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push({
        severity: 'error',
        rule: 2,
        path: f,
        message: 'must be a non-empty string',
      })
    }
  }

  // 后续规则依赖结构完整;有 rule 2 错误就停
  if (errors.length > 0) return { valid: false, errors, warnings }

  // RULE 3: id 格式
  if (typeof o.id === 'string' && !ID_RE.test(o.id) && !PLATFORM_ID_RE.test(o.id)) {
    errors.push({
      severity: 'error',
      rule: 3,
      path: 'id',
      message: 'must match /^[a-z0-9_-]+$/ or platform pattern /^__[a-z0-9_-]+__$/',
    })
  }

  // RULE 4: semver
  if (typeof o.version === 'string' && !semverValid(o.version)) {
    errors.push({ severity: 'error', rule: 4, path: 'version', message: 'must be valid semver' })
  }
  if (o.minAppVersion !== undefined && o.minAppVersion !== null) {
    if (typeof o.minAppVersion !== 'string' || !semverValid(o.minAppVersion)) {
      errors.push({
        severity: 'error',
        rule: 4,
        path: 'minAppVersion',
        message: 'must be valid semver',
      })
    }
  }

  // RULE 5: tools 白名单
  if (o.tools !== undefined) {
    if (!Array.isArray(o.tools)) {
      errors.push({ severity: 'error', rule: 5, path: 'tools', message: 'must be array' })
    } else {
      o.tools.forEach((t, i) => {
        if (typeof t !== 'string' || !(BUILTIN_TOOL_NAMES as readonly string[]).includes(t)) {
          errors.push({
            severity: 'error',
            rule: 5,
            path: `tools[${i}]`,
            message: `must be one of: ${BUILTIN_TOOL_NAMES.join(', ')}`,
          })
        }
      })
    }
  }

  // RULE 6: references
  if (o.references !== undefined) {
    if (!Array.isArray(o.references)) {
      errors.push({ severity: 'error', rule: 6, path: 'references', message: 'must be array' })
    } else {
      const seen = new Set<string>()
      o.references.forEach((r, i) => {
        if (!r || typeof r !== 'object') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}]`,
            message: 'must be object',
          })
          return
        }
        const ref = r as Record<string, unknown>
        if (typeof ref.id !== 'string' || !ID_RE.test(ref.id)) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].id`,
            message: 'must match /^[a-z0-9_-]+$/',
          })
        } else if (seen.has(ref.id)) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].id`,
            message: `duplicate reference id "${ref.id}"`,
          })
        } else {
          seen.add(ref.id)
        }
        if (typeof ref.path !== 'string' || ref.path.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].path`,
            message: 'must be non-empty string',
          })
        } else if (
          ref.path.includes('\\') ||
          isAbsolute(ref.path) ||
          normalize(ref.path).startsWith('..')
        ) {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].path`,
            message:
              'must be a relative path within agent dir (no .., absolute paths, or backslashes)',
          })
        } else if (ctx.agentRoot) {
          const full = resolve(ctx.agentRoot, ref.path)
          if (!existsSync(full)) {
            errors.push({
              severity: 'error',
              rule: 6,
              path: `references[${i}].path`,
              message: `file does not exist: ${ref.path}`,
            })
          }
        }
        if (typeof ref.description !== 'string' || ref.description.trim() === '') {
          errors.push({
            severity: 'error',
            rule: 6,
            path: `references[${i}].description`,
            message: 'must be non-empty string',
          })
        }
      })
    }
  }

  // RULE 7: subagents.ids[].id 引用已注册 agent
  if (o.subagents !== undefined && o.subagents !== null) {
    if (typeof o.subagents !== 'object' || Array.isArray(o.subagents)) {
      errors.push({ severity: 'error', rule: 7, path: 'subagents', message: 'must be object' })
    } else {
      const sa = o.subagents as Record<string, unknown>
      if (sa.ids !== undefined) {
        if (!Array.isArray(sa.ids)) {
          errors.push({
            severity: 'error',
            rule: 7,
            path: 'subagents.ids',
            message: 'must be array',
          })
        } else {
          sa.ids.forEach((s, i) => {
            if (!s || typeof s !== 'object') {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}]`,
                message: 'must be object',
              })
              return
            }
            const sub = s as Record<string, unknown>
            if (typeof sub.id !== 'string' || !ID_RE.test(sub.id)) {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}].id`,
                message: 'must match /^[a-z0-9_-]+$/',
              })
            } else if (ctx.knownAgentIds && !ctx.knownAgentIds.has(sub.id)) {
              errors.push({
                severity: 'error',
                rule: 7,
                path: `subagents.ids[${i}].id`,
                message: `agent "${sub.id}" not found in registry`,
              })
            }
          })
        }
      }
    }
  }

  // RULE 8: preferences.modelId 已注册
  if (o.preferences !== undefined && o.preferences !== null) {
    if (typeof o.preferences !== 'object' || Array.isArray(o.preferences)) {
      errors.push({ severity: 'error', rule: 8, path: 'preferences', message: 'must be object' })
    } else {
      const p = o.preferences as Record<string, unknown>
      if (typeof p.modelId === 'string' && ctx.knownModelIds && !ctx.knownModelIds.has(p.modelId)) {
        errors.push({
          severity: 'error',
          rule: 8,
          path: 'preferences.modelId',
          message: `unknown model "${p.modelId}"`,
        })
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors, warnings }

  const profile = o as unknown as AgentProfile

  // W1 (rule 9): 实体污染
  validateNoSpecificEntities(profile, warnings)

  return { valid: true, profile, warnings }
}

// ─── W1 (rule 9): description / agentPrompt / references.description 不含具体实体 ──

function validateNoSpecificEntities(profile: AgentProfile, warnings: ValidatorIssue[]): void {
  const checks: Array<{ path: string; text: string }> = [
    { path: 'description', text: profile.description },
    { path: 'agentPrompt', text: profile.agentPrompt },
  ]
  ;(profile.references ?? []).forEach((r: ReferenceFile, i) => {
    checks.push({ path: `references[${i}].description`, text: r.description })
  })

  for (const { path, text } of checks) {
    if (!text) continue
    const entities = extractEntities(text)
    const flagged = entities.filter((e) => {
      if (e.category === 'ticker' || e.category === 'stock-code' || e.category === 'path')
        return true
      if (e.category === 'cn-name' && e.text.length >= 4) return true
      return false
    })
    if (flagged.length === 0) continue
    const sample = flagged
      .slice(0, 3)
      .map((e) => e.text)
      .join(', ')
    warnings.push({
      severity: 'warn',
      rule: 9,
      path,
      message:
        `contains specific entities [${sample}${flagged.length > 3 ? ', ...' : ''}] — ` +
        `prompt-rendered fields should use generic language. ` +
        `Specific entities bias all delegations regardless of user intent.`,
    })
  }
}
```

- [ ] **Step 3: Run validator tests**

```bash
npx vitest run src/main/agent/validator.test.ts
```

Expected: ALL PASS.

### Task 1.4: Loader field path fixes

**Files:**

- Modify: `src/main/agent/loader.ts`
- Modify: `src/main/agent/loader.test.ts`

- [ ] **Step 1: Fix field paths in loader.ts**

In the `for (const name of dirs)` block, change the entry insertion:

```ts
// OLD:
this.entries.set(result.profile.identity.id, {
  profile: result.profile,
  dirPath,
  status: 'disabled',
})
log.info('[AgentLoader] Loaded agent:', result.profile.identity.id, result.profile.identity.name)

// NEW:
this.entries.set(result.profile.id, {
  profile: result.profile,
  dirPath,
  status: 'disabled',
})
log.info('[AgentLoader] Loaded agent:', result.profile.id, result.profile.name)
```

Fix `getByName`:

```ts
// OLD: if (entry.profile.identity.name === name) return entry
// NEW: if (entry.profile.name === name) return entry
```

No other changes — `validateProfile` already rejects v1.0 with rule 1 ("must be 2.0"), which falls through to the existing `log.warn(...) ; continue` branch. Pre-existing v1.0 agents on disk will be logged as invalid and skipped.

- [ ] **Step 2: Update loader tests**

Open `src/main/agent/loader.test.ts`. For every fixture that constructs a `profile`-shaped object literal:

- Replace nested `identity: { id, name, description, version }` with top-level `id, name, description, version`
- Replace `mission`/`method`/`delivery`/`execution` blocks with `agentPrompt: '## Workflow\n1. Test.\n\n## Output\nText.'`
- Set `schemaVersion: '2.0'`

Add a negative test for v1.0 rejection:

```ts
it('rejects v1.0 agent.json with rule 1 warn', () => {
  const v1Profile = {
    schemaVersion: '1.0',
    identity: { id: 'legacy', name: 'Legacy', description: 'old.', version: '1.0.0' },
  }
  const dir = join(testAgentsDir, 'legacy')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agent.json'), JSON.stringify(v1Profile))

  const loader = new AgentLoader(testAgentsDir)
  loader.loadAll()
  expect(loader.getById('legacy')).toBeUndefined()
})
```

(Adapt fs setup to existing test patterns in the file.)

- [ ] **Step 3: Run loader tests**

```bash
npx vitest run src/main/agent/loader.test.ts
```

Expected: PASS.

### Task 1.5: Importer field path fixes

**Files:**

- Modify: `src/main/agent/importer.ts`

- [ ] **Step 1: Fix log line and error formatter**

```ts
// OLD:
log.info(
  '[importer] Imported agent:',
  result.profile.identity.id,
  'to',
  targetDir,
  overwritten ? '(overwritten)' : '',
)

// NEW:
log.info(
  '[importer] Imported agent:',
  result.profile.id,
  'to',
  targetDir,
  overwritten ? '(overwritten)' : '',
)
```

Fix the error formatter — `result.errors` is `ValidatorIssue[]`, not strings:

```ts
// OLD: throw new Error(`Invalid agent.json: ${result.errors.join(', ')}`)
// NEW:
const errMsg = result.errors.map((e) => `[rule ${e.rule}] ${e.path}: ${e.message}`).join('; ')
throw new Error(`Invalid agent.json: ${errMsg}`)
```

No migration call — v1.0 zips fail validation with rule 1 and the error message tells the user to upgrade.

- [ ] **Step 2: Pass `agentRoot` to validator at import time**

```ts
// OLD: const result = validateProfile(json)
// NEW:
const result = validateProfile(json, { agentRoot: extractedDir })
```

`extractedDir` is already in scope (the unzipped agent directory). This makes reference path existence checks run at import time, so a zip with broken `references[]` paths fails at import rather than silently passing and failing later at load time.

### Task 1.6: Commit Phase 1

- [ ] **Step 1: Run all unit tests in scope**

```bash
npx vitest run src/main/agent/validator.test.ts src/shared/types/agent.test.ts src/main/agent/loader.test.ts 2>&1 | tail -20
```

Expected: all PASS for the three scope files.

Note: `src/shared/types/agent.test.ts` may need rewriting too. If it imports types that no longer exist, replace its body with:

```ts
import { describe, it, expect } from 'vitest'
import type { AgentProfile } from './agent'
import { SCHEMA_VERSION, BUILTIN_TOOL_NAMES } from './agent'

describe('AgentProfile (v2.0) type smoke', () => {
  it('exports SCHEMA_VERSION = "2.0"', () => {
    expect(SCHEMA_VERSION).toBe('2.0')
  })
  it('BUILTIN_TOOL_NAMES has 7 entries', () => {
    expect(BUILTIN_TOOL_NAMES).toHaveLength(7)
  })
  it('AgentProfile literal compiles', () => {
    const p: AgentProfile = {
      schemaVersion: '2.0',
      id: 'a',
      name: 'A',
      description: 'x',
      version: '1.0.0',
      agentPrompt: '## Output\nText.',
    }
    expect(p.id).toBe('a')
  })
})
```

- [ ] **Step 2: Verify project still typechecks** (best-effort — many consumers still reference 1.0 fields and will fail; we accept those failures and fix them in Phase 2-4. Whitelist of expected-failing files:)

```bash
npm run typecheck 2>&1 | head -50
```

Note the failures. Anything outside this list = surprise, fix before commit:

- `src/main/agent/agent.ts` (uses resolvedAcceptance)
- `src/main/agent/agent-manager.ts` (1.0 paths)
- `src/main/agent/delegate-agent.ts` (1.0 paths)
- `src/main/agent/dependency-checker.ts` (1.0 paths)
- `src/main/agent/dry-runner.ts` (contract-guard)
- `src/main/agent/templates.ts` (1.0 templates)
- `src/main/agent/draft-extractor.ts` (1.0 paths)
- `src/main/agent/crystallizer-heuristics.ts` (1.0 paths)
- `src/main/agent/skill-installer.ts` (1.0 paths)
- `src/main/agent/preview.ts` (1.0 paths)
- `src/main/prompt/runtime-context.ts` (1.0 paths)
- `src/main/prompt/plugins/AgentPromptPlugin.ts` (1.0 paths)
- `src/main/loop/contract-guard.ts` (gets deleted)
- Various `*.test.ts` paired with the above

- [ ] **Step 3: Commit**

```bash
git add src/shared/types/agent.ts src/main/agent/validator.ts src/main/agent/validator.test.ts src/main/agent/loader.ts src/main/agent/loader.test.ts src/main/agent/importer.ts src/shared/types/agent.test.ts
git commit -m "$(cat <<'EOF'
feat(agent): Schema 2.0 — types + validator + field path fixes

Replace 1.0's 6-section nested profile with 15-field flat schema:
identity / mission / method / delivery / execution / preferences →
top-level id/name/description/version/agentPrompt/tools/skills/
mcpServers/cli/references/subagents/preferences.

No backward-compat: v1.0 agent.json files now fail validator rule 1
("must be 2.0") and are skipped by loader/importer with a warn.

- Types: 511 → ~190 lines. AgentScope/Outcome/MissionInput/Deliverable/
  AcceptanceCriterion/WorkflowSpec/AgentLimits/RetryPolicy etc removed.
  KnowledgeRef union → ReferenceFile (file-only index).
- Validator: 19 → 9 rules (1183 → ~220 lines). Drops workflow DAG,
  outcomes/acceptance cross-refs, scope shape, retryPolicy escalateTo.
- Loader/importer: field paths fixed (profile.identity.X → profile.X);
  importer error formatter now stringifies ValidatorIssue[] correctly.

Consumers in agent/* prompt/* loop/* still reference 1.0 fields and
fail typecheck — fixed in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Prompt rendering (runtime-context + plugin + template)

> Goal: agent system prompt renders from v2.0 fields. After this commit, `runtime-context.ts` produces a `TemplateContext` shaped to v2.0; the new `agent-system-prompt.v2.md` template consumes it; `AgentPromptPlugin` wires them together.

### Task 2.1: Replace prompt template

**Files:**

- Create: `src/main/prompt/templates/agent-system-prompt.v2.md`
- Delete: `src/main/prompt/templates/agent-system-prompt.v1.md` (after Task 2.3 verifies it's no longer loaded)

- [ ] **Step 1: Write the new template**

```handlebars
{{!-- ═══ PERSISTENT (every ReAct iteration) ═══ --}}

# Identity
You are **{{name}}**.

{{description}}

{{#each criticalRoleConstraints}}
**{{this}}**
{{/each}}

{{agentPrompt}}

{{#if hasReferences}}
# Reference Index

The following reference files are available. **Load them with the `read` tool
when relevant to the current task. Do not load preemptively** — only when their
content would inform your next action.

{{#each references}}
- **`@{{id}}`** at `{{path}}` — {{description}}
{{/each}}
{{/if}}

{{#if hasSkillListing}}
{{skillListing}}
{{/if}}

{{!-- ═══ TAIL ═══ --}}

# Self-Check Before Responding

Silently verify:

1. **Required inputs**: If agentPrompt has a "Required Inputs" section, are all REQUIRED inputs collected from the user? If not, ask before producing the final answer.
2. **Workflow position**: Looking at agentPrompt's Workflow, which step am I on? Which step comes next?
3. **References**: Would `@<id>` from the Reference Index inform my next answer? If yes and I haven't read it, read now.
4. **Output**: Does my output match the format specified in agentPrompt's "Output" section?

If any check fails, recover before responding.
```

### Task 2.2: Rewrite runtime-context

**Files:**

- Modify: `src/main/prompt/runtime-context.ts` (heavy rewrite)
- Modify: `src/main/prompt/runtime-context.test.ts`

- [ ] **Step 1: Replace runtime-context.ts**

```ts
// src/main/prompt/runtime-context.ts — 业务层: 模板渲染上下文 (Schema 2.0)
//
// 把 Agent 实体属性 → TemplateContext (供 render.ts 消费)。
// 大幅简化: 不再有 mission/method/delivery 段渲染,只剩 identity (扁平) + agentPrompt 自由文本 +
// references 索引 + skills listing。
//
// 允许依赖: agent/*、shared/*
// 禁止依赖: ipc/*

import type { Agent } from '../agent/agent'
import type { AgentProfile, ReferenceFile } from '@shared/types/agent'

export interface RuntimeIterationState {
  /** ReAct iteration 计数 (0-based) — 当前 v2.0 模板不用,保留供后续扩展 */
  iterationNumber: number
  /** 累计 token 用量 — 当前 v2.0 模板不用,保留供后续扩展 */
  tokensUsed: number
}

export interface TemplateContext {
  // ── 顶层标识 (模板直接读) ──
  name: string
  description: string
  agentPrompt: string

  // ── References 段 ──
  hasReferences: boolean
  references: ReferenceFile[]

  // ── Critical role constraints (platform agent 内置) ──
  criticalRoleConstraints: string[]

  // ── Skills listing (从 SkillRegistry 渲染好的字符串,空则段省略) ──
  hasSkillListing: boolean
  skillListing: string
}

export function buildRuntimeContext(agent: Agent, _state: RuntimeIterationState): TemplateContext {
  const p = agent.profile
  const references = p.references ?? []

  return {
    name: p.name,
    description: p.description,
    agentPrompt: p.agentPrompt,

    hasReferences: references.length > 0,
    references,

    criticalRoleConstraints: buildCriticalRoleConstraints(p.id),

    skillListing: renderSkillListing(agent.skillRegistry),
    hasSkillListing: !agent.skillRegistry.isEmpty() && agent.skillRegistry.listAll().length > 0,
  }
}

function buildCriticalRoleConstraints(agentId: string): string[] {
  if (agentId === '__chat__') {
    return [
      'You may delegate sub-tasks via delegate_agent when specialized agents fit better than direct work.',
    ]
  }
  return []
}

const MAX_SKILL_DESCRIPTION_CHARS = 1536

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function renderSkillListing(skillRegistry: {
  isEmpty: () => boolean
  listAll: () => Array<{ metadata: { name: string; description: string; when_to_use?: string } }>
}): string {
  if (skillRegistry.isEmpty()) return ''
  const skills = skillRegistry.listAll()
  if (skills.length === 0) return ''

  const listing = skills
    .map((s) => {
      const desc = truncate(s.metadata.description, MAX_SKILL_DESCRIPTION_CHARS)
      const whenLine = s.metadata.when_to_use
        ? `\n  When to use: ${truncate(s.metadata.when_to_use, MAX_SKILL_DESCRIPTION_CHARS)}`
        : ''
      return `- ${s.metadata.name}\n  ${desc}${whenLine}`
    })
    .join('\n\n')

  return `## Available Skills\n\nEach entry is an encapsulated capability. Use via \`skill\` tool. The "When to use" line lists trigger phrases — match the user's input against these to pick a skill.\n\n${listing}`
}

// Re-export for back-compat (Profile is no longer the prompt shape itself)
export type { AgentProfile }
```

- [ ] **Step 2: Rewrite runtime-context.test.ts**

Replace fixtures to use v2.0 shape. Keep tests that assert:

- `name` / `description` / `agentPrompt` pass through verbatim
- `hasReferences` toggles correctly
- `criticalRoleConstraints` only set for `__chat__`
- `hasSkillListing` reflects skill registry state

Drop tests for `hasMissionOutcomes`, `hasInputs`, `hasScope`, `acceptanceMust`, `requiredDeliverableIds`, `workflowKindLabel` — these context fields no longer exist.

### Task 2.3: Adapt AgentPromptPlugin + template-loader

**Files:**

- Modify: `src/main/prompt/plugins/AgentPromptPlugin.ts`
- Modify: `src/main/prompt/template-loader.ts`

- [ ] **Step 1: Update AgentPromptPlugin fallback**

In `AgentPromptPlugin.ts`, replace the fallback line:

```ts
// OLD:
const fallback = `You are "${ctx.agent.profile.identity.name}". ${ctx.agent.profile.identity.description}`
// NEW:
const fallback = `You are "${ctx.agent.profile.name}". ${ctx.agent.profile.description}`
```

Remove unused helpers (`joinNaturalize`, `naturalize`, `schemaToBullets`) — they were for 1.0 acceptance rendering. New helpers shape:

```ts
const helpers = {
  joinBackticks: (arr: unknown, sep: unknown = ' · ') => {
    if (!Array.isArray(arr)) return ''
    const s = typeof sep === 'string' ? sep : ' · '
    return arr.map((x) => '`' + String(x) + '`').join(s)
  },
}
```

Drop the `naturalize` and `schemaToBullets` imports.

- [ ] **Step 2: Update template-loader**

In `template-loader.ts`, change the template filename:

```ts
// OLD: 'agent-system-prompt.v1.md'
// NEW: 'agent-system-prompt.v2.md'
```

(Find the exact line via Read.)

- [ ] **Step 3: Update AgentPromptPlugin.test.ts**

Replace 1.0 profile fixtures with v2.0. Tests should assert:

- Falsy `ctx.agent` returns empty result
- Valid v2.0 profile renders `# Identity` containing `name` + `description`
- `agentPrompt` content appears verbatim in output
- `references` render as `# Reference Index` section when present, absent otherwise
- `criticalRoleConstraints` (`__chat__` only) appear after Identity

- [ ] **Step 4: Run prompt tests**

```bash
npx vitest run src/main/prompt/
```

Expected: PASS.

### Task 2.4: Delete naturalize if orphaned

- [ ] **Step 1: Check callers**

```bash
grep -rn "from.*naturalize\|import.*naturalize" src/main src/shared --include="*.ts" | grep -v naturalize.ts
```

If 0 results: delete `src/main/prompt/naturalize.ts` and `src/main/prompt/naturalize.test.ts`.
If results exist (e.g., dry-runner still imports): leave for Phase 3.

### Task 2.5: Commit Phase 2

- [ ] **Step 1: Run prompt tests**

```bash
npx vitest run src/main/prompt/
```

- [ ] **Step 2: Commit**

```bash
git add src/main/prompt/ -A
git commit -m "$(cat <<'EOF'
feat(prompt): Schema 2.0 — rewrite template + runtime-context

- agent-system-prompt.v2.md (230 → ~55 lines): only renders
  # Identity / agentPrompt / # Reference Index / skill listing /
  # Self-Check. Drops Mission/Boundary/Workflow/Acceptance/Quality
  Pledges/Deliverables sections (all subsumed by agentPrompt).
- runtime-context.ts: TemplateContext fields collapse to
  name/description/agentPrompt + references + criticalRoleConstraints
  + skillListing. EnrichedKnowledge/Method/WorkflowStep gone.
- AgentPromptPlugin: drop naturalize/schemaToBullets helpers
  (only acceptance/schema renders used them).
- template-loader: switch filename to v2.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Drop deliverables contract + adjust dry-runner / agent.ts

> Goal: delete `contract-guard.ts`; simplify `dry-runner.ts` to "render + dependency-check only"; remove `resolvedAcceptance` from `Agent` class.

### Task 3.1: Delete contract-guard

**Files:**

- Delete: `src/main/loop/contract-guard.ts`
- Delete: `src/main/loop/contract-guard.test.ts`

- [ ] **Step 1: Find remaining callers**

```bash
grep -rn "contract-guard\|verify.*resolvedAcceptance\|extractDeliverable" src/main --include="*.ts" 2>/dev/null
```

- [ ] **Step 2: Delete files**

```bash
rm src/main/loop/contract-guard.ts src/main/loop/contract-guard.test.ts
```

### Task 3.2: Strip `Agent.resolvedAcceptance`

**Files:**

- Modify: `src/main/agent/agent.ts`

- [ ] **Step 1: Read current shape**

```bash
grep -n "resolvedAcceptance\|buildResolvedAcceptance" src/main/agent/agent.ts
```

- [ ] **Step 2: Remove the field + builder**

In `agent.ts`:

- Delete the `resolvedAcceptance` property and its assignment in the constructor.
- Delete or stub the `buildResolvedAcceptance(...)` helper.
- Remove imports of `AcceptanceCriterion`.

Any test that asserts `agent.resolvedAcceptance` should be deleted or rewritten to no-op.

### Task 3.3: Rewrite dry-runner

**Files:**

- Modify: `src/main/agent/dry-runner.ts` (heavy rewrite)
- Modify: `src/main/agent/dry-runner.test.ts`

- [ ] **Step 1: Replace dry-runner.ts**

```ts
// src/main/agent/dry-runner.ts — 业务层: Agent 沙箱试跑 (Schema 2.0 simplified)
//
// 不再做 acceptance / extractDeliverable / schema 校验 (deliverables 已删)。
// 当前能力: 校验 profile + 渲染 first-iteration prompt + 报告资源估算。
// 未来想做"输出符合 agentPrompt ## Output 段"的语义评估时,接 LLM-judge,
// 不再走 schema 路径。
//
// 允许依赖: agent/*、prompt/*、shared/*
// 禁止依赖: ipc/*、loop/*

import type { AgentProfile } from '@shared/types/agent'
import { validateProfile } from './validator'
import { Agent } from './agent'
import { BuiltinToolRegistry } from './builtin-registry'
import { SkillRegistry } from '../skills/registry'
import { render } from '../prompt/render'
import { buildRuntimeContext, type TemplateContext } from '../prompt/runtime-context'
import { loadAgentSystemPromptTemplate } from '../prompt/template-loader'

export interface DryRunIteration {
  iteration: number
  promptSent: string
  llmResponseStub: string
  toolCallsStub: Array<{ tool: string; input: unknown }>
  tokensUsedEstimate: number
}

export interface DryRunResult {
  iterations: DryRunIteration[]
  finalText: string
  resourceUsage: {
    iterations: number
    promptTokensEstimate: number
  }
  validatorIssues: import('@shared/types/agent').ValidatorIssue[]
  stub: true
  notes: string[]
}

export interface DryRunArgs {
  profile: unknown
  userMessage: string
  finalTextOverride?: string
  toolEventsOverride?: Array<{
    toolName: string
    input?: { path?: string } & Record<string, unknown>
  }>
}

const helpers = {
  joinBackticks: (arr: unknown, sep: unknown = ' · ') => {
    if (!Array.isArray(arr)) return ''
    const s = typeof sep === 'string' ? sep : ' · '
    return arr.map((x) => '`' + String(x) + '`').join(s)
  },
}

export async function dryRunAgent(args: DryRunArgs): Promise<DryRunResult> {
  const validation = validateProfile(args.profile)
  if (!validation.valid) {
    return {
      iterations: [],
      finalText: '',
      resourceUsage: { iterations: 0, promptTokensEstimate: 0 },
      validatorIssues: [...validation.errors, ...validation.warnings],
      stub: true,
      notes: ['profile validation failed; dry-run aborted'],
    }
  }

  const profile: AgentProfile = validation.profile

  const emptyBuiltin = new BuiltinToolRegistry([])
  const agent = new Agent({
    profile,
    source: null,
    builtinRegistry: emptyBuiltin,
    mcpRegistry: null,
    skillRegistry: SkillRegistry.fromDir(null),
    delegationRuntime: undefined,
  })

  const template = loadAgentSystemPromptTemplate()
  const tplCtx: TemplateContext = buildRuntimeContext(agent, { iterationNumber: 0, tokensUsed: 0 })
  const persistentPrompt = render(template, tplCtx as unknown as Record<string, unknown>, helpers)

  const finalText = args.finalTextOverride ?? `[dry-run stub] User asked: ${args.userMessage}`
  const toolEvents = args.toolEventsOverride ?? []

  const iter: DryRunIteration = {
    iteration: 0,
    promptSent: persistentPrompt,
    llmResponseStub: finalText,
    toolCallsStub: toolEvents.map((e) => ({ tool: e.toolName, input: e.input })),
    tokensUsedEstimate: Math.ceil(persistentPrompt.length / 3),
  }

  return {
    iterations: [iter],
    finalText,
    resourceUsage: {
      iterations: 1,
      promptTokensEstimate: iter.tokensUsedEstimate,
    },
    validatorIssues: validation.warnings,
    stub: true,
    notes: [
      'Schema 2.0 dry-run: profile validated + first-iteration prompt rendered.',
      'No acceptance / deliverable validation in v2.0; output checking relies on prompt + LLM.',
    ],
  }
}
```

- [ ] **Step 2: Update dry-runner.test.ts**

Drop all assertions about `acceptance`, `extractedDeliverables`, `sandboxApplied`. Keep:

- "invalid profile returns failure + validatorIssues"
- "valid profile produces rendered prompt containing agentPrompt"

Rewrite fixtures to v2.0 shape.

### Task 3.4: Commit Phase 3

```bash
npm test -- src/main/loop src/main/agent/dry-runner.test.ts src/main/agent/agent.test.ts 2>&1 | tail -20
```

Expected: PASS.

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(loop,agent): Schema 2.0 — drop deliverables contract path

- Delete src/main/loop/contract-guard.ts + tests (374 lines). v2.0
  has no deliverables/AcceptanceCriterion, so verify/extractDeliverable
  have no input shape to operate on.
- Strip Agent.resolvedAcceptance + buildResolvedAcceptance helper.
  Acceptance never wired into react-loop in v1.0 either — it was
  always advisory.
- Rewrite dry-runner.ts to "validate + render + report" only.
  Future semantic output check should go through LLM-judge, not schema.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Adjust consumers (delegate-agent / agent-manager / dependency-checker)

### Task 4.1: delegate-agent listing

**Files:**

- Modify: `src/main/agent/delegate-agent.ts` (lines around 386-428)
- Modify: `src/main/agent/delegate-agent.test.ts`

- [ ] **Step 1: Read current listing builder**

```bash
sed -n '380,440p' src/main/agent/delegate-agent.ts
```

- [ ] **Step 2: Replace with v2.0 builder**

Rewrite the function that builds the subagent listing entry. New shape:

```ts
function formatSubagentListing(profile: AgentProfile): string {
  const lines: string[] = []
  lines.push(`### ${profile.name} (id: ${profile.id})`)
  lines.push(profile.description)

  // First H2 section of agentPrompt — usually "## When invoked" or "## Workflow"
  // Gives delegating LLM enough to decide whether to invoke this subagent.
  const firstSection = extractFirstSection(profile.agentPrompt)
  if (firstSection) {
    lines.push('')
    lines.push(firstSection)
  }

  return lines.join('\n')
}

function extractFirstSection(agentPrompt: string): string {
  const lines = agentPrompt.split('\n')
  const start = lines.findIndex((l) => /^## /.test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  return lines
    .slice(start, end < 0 ? undefined : end)
    .join('\n')
    .trim()
}
```

Remove the deliverables formatter block and all references to `delivery.deliverables`, `mission`, `method`. Adapt the callsite (around line 425) to use the new builder.

- [ ] **Step 3: Update tests**

Drop assertions about deliverable formatting. Add assertion that listing contains `name`, `description`, and first H2 section of `agentPrompt`.

### Task 4.2: agent-manager (crystallizer prompt strip)

**Files:**

- Modify: `src/main/agent/agent-manager.ts`

- [ ] **Step 1: Identify the embedded prompt text**

```bash
grep -n "delivery.deliverables\|mission.outcomes\|method.workflow\|delivery.acceptance" src/main/agent/agent-manager.ts | head -20
```

- [ ] **Step 2: Replace the schema description block**

In agent-manager.ts there is a multi-paragraph prompt text describing 1.0 schema fields (lines around 260-700 per earlier grep). Replace it with a much shorter v2.0 description:

```ts
const SCHEMA_DESCRIPTION = `
Talor Agent Schema 2.0 — top-level fields (flat):

  schemaVersion: "2.0"  (literal)
  id:           snake_case, /^[a-z0-9_-]+$/
  name:         display name
  description:  multi-line: identity + 会做 + 不会做
  version:      semver
  agentPrompt:  free-form markdown (operating manual). Sections:
                  ## When invoked (optional)
                  ## Required Inputs (optional)
                  ## Workflow (required, 3-7 numbered steps)
                  ## Principles (required, bullet list)
                  ## Output (required, format + structure)
                  ## Output style (optional)
                  ## Examples (optional)

Dependency manifest (all optional):
  tools:        BuiltinToolName[] whitelist (read/write/edit/bash/glob/grep/ls)
  skills:       SkillItem[]
  mcpServers:   McpServerDependency[]
  cli:          CliDependency[]
  references:   ReferenceFile[]  (per-agent file index, loaded on demand via read)
  subagents:    { ids?, allowAny? }  (delegate_agent scope)
  preferences:  { modelId?, providerId? }
`.trim()
```

Delete the field-by-field descriptions for old `mission.*` / `method.*` / `delivery.*` / `execution.*` paths.

Update callsites that reference `profile.identity.id`, `profile.identity.name`, `profile.identity.description` → `profile.id`, `profile.name`, `profile.description`.

- [ ] **Step 3: Run agent-manager tests**

```bash
npx vitest run src/main/agent/agent-manager.test.ts
```

### Task 4.3: dependency-checker (knowledge → references)

**Files:**

- Modify: `src/main/agent/dependency-checker.ts` (lines 10, 51, 242-259)
- Modify: `src/main/agent/dependency-checker.test.ts`

- [ ] **Step 1: Rename the step**

Replace all occurrences of `'knowledge'` (as a `DependencyStepName` value) with `'references'`.

Replace:

```ts
// OLD:
const knowledge = profile.method.knowledge ?? []
for (const k of knowledge) { ... type === 'file' ... existsSync(k.path) ... }

// NEW:
const refs = profile.references ?? []
for (const r of refs) {
  const full = resolve(agentRoot, r.path)
  if (!existsSync(full)) { ... }
}
```

Update step `message` text from "knowledge file missing" to "reference file missing".

- [ ] **Step 2: Update tests**

Rename test cases to use `'references'` step name; update fixtures to use `references: [{id, path, description}]`.

### Task 4.4: Other consumers (draft-extractor / crystallizer-heuristics / skill-installer / preview / templates)

- [ ] **Step 1: Quickly scan for `profile.identity\|profile.mission\|profile.method\|profile.delivery\|profile.execution`**

```bash
grep -rn "profile\.\(identity\|mission\|method\|delivery\|execution\)" src/main --include="*.ts"
```

For each hit:

- `profile.identity.id/name/description/version` → `profile.id/name/description/version`
- `profile.mission.objective` → derive from `profile.agentPrompt` or hardcode placeholder
- `profile.method.tools/skills/mcpServers/cli/knowledge` → `profile.tools/skills/mcpServers/cli/references`
- `profile.method.collaboration` → `profile.subagents`
- `profile.delivery.deliverables` → no replacement; remove the logic
- `profile.execution.limits/retryPolicy` → replace with literal defaults (`maxSteps: 50, maxTokens: 200_000`) or remove

- [ ] **Step 2: Rewrite templates.ts**

Replace each `AgentProfile` literal in `templates.ts` with v2.0 shape. Example for code_reviewer:

```ts
const CODE_REVIEWER: AgentProfile = {
  schemaVersion: '2.0',
  id: 'code_reviewer',
  name: 'Code Reviewer',
  description: `Reviews pull requests against team coding standards and produces structured findings.

会做：分析 diff 并按 blocker/major/minor/nit 分级、引用规则编号佐证每条 blocker、跨文件查找用法和先例、对照项目 standards.md 检查违规。

不会做：修改任何源代码、执行待评审的代码、评审非代码文件、评审超过 2000 行的超大 diff（要求拆分）。`,
  version: '1.0.0',
  agentPrompt: `
## Required Inputs
- **pr_url_or_diff** (text, REQUIRED): Pull request URL or raw diff to review.

## Workflow
1. Load the diff (bash + read).
2. When relevant, read \`@standards\` and \`@patterns\` to confirm rule references.
3. Walk the diff hunk-by-hunk and classify findings.
4. Emit the final review report as JSON.

## Principles
- Every blocker MUST cite a section from \`@standards\` (e.g., §F-MUST-3).
- For each finding, include file:line and one-line rationale.
- If the diff exceeds 2000 lines, stop and ask the user to split it.
- Do not execute the code under review.

## Output
Produce a JSON document:
\`\`\`json
{
  "summary": "<1-2 sentence overall assessment>",
  "findings": [
    { "severity": "blocker|major|minor|nit", "file": "<path>", "line": <n>, "rule": "<ref>", "message": "<one-line>" }
  ]
}
\`\`\`

## Output style
Concise, evidence-based. English. JSON only — no prose wrapper.
`.trim(),
  tools: ['read', 'grep', 'glob', 'bash'],
}
```

Repeat for every other template literal in the file.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck 2>&1 | head -30
```

Expected: clean (or only pre-existing pre-Phase-1 errors).

### Task 4.5: Commit Phase 4

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(agent): Schema 2.0 — adapt consumers + rename knowledge→references

- delegate-agent listing: use description + first H2 section of
  agentPrompt; drop deliverable/outcome formatting (1023 → smaller).
- agent-manager: replace ~400 lines of embedded 1.0 schema docs in
  the crystallizer prompt with compact v2.0 description.
- dependency-checker: rename step 'knowledge' → 'references',
  read profile.references[] instead of profile.method.knowledge[].
- templates.ts: rewrite all built-in templates to v2.0.
- draft-extractor / crystallizer-heuristics / skill-installer / preview:
  update field paths (profile.identity.X → profile.X, profile.method.Y
  → profile.Y).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: Test sweep + docs

### Task 5.1: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
npm test 2>&1 | tail -40
```

Expected: only pre-existing failures (not introduced by this plan).

- [ ] **Step 2: For each newly-failing test, fix or delete**

For each failing test:

- If it uses 1.0 fixtures: update to v2.0 fixtures.
- If it asserts removed behavior (acceptance, deliverables): delete the assertion or test case.
- If it's `runtime-context.test.ts` / `dry-runner.test.ts` / `loader.test.ts` / `delegate-agent.test.ts` / etc.: addressed in prior phases; only chase residuals.

### Task 5.2: Update CLAUDE.md + patterns.md

**Files:**

- Modify: `CLAUDE.md`
- Modify: `vibe/project/patterns.md`

- [ ] **Step 1: CLAUDE.md updates**

In §2 (code map):

- Replace any mention of 1.0 mission/method/delivery vocabulary
- Update one-liner: "Schema 2.0 (扁平 15 字段,行为定义统一在 agentPrompt)"

In §3 (必读文档):

- Add link to this plan if useful
- Remove references to deleted modules (contract-guard)

In §4 (踩坑) §4.5:

- Soften "工具错误必须用 ToolErrorEnvelope" if it referenced contract-guard
- §4.2 (assistant tool_use 配对) is independent — keep

In §8 (项目现状):

- Add: "Schema 2.0 — flat 15-field profile; deliverables/acceptance gone (advisory→prompt-only)"

- [ ] **Step 2: patterns.md new section**

Append at end:

```markdown
## P12 — 领域知识加载策略

按知识规模与共享需求选通道:

| 规模                          | 范围          | 推荐通道                                                       |
| ----------------------------- | ------------- | -------------------------------------------------------------- |
| 小 (< 50 行)                  | 单 agent 专属 | 直接写在 agentPrompt 的 `## Domain Knowledge` 段               |
| 中 (50-500 行)                | 单 agent 专属 | 放 `<agent_dir>/references/*.md`,声明在 `profile.references[]` |
| 大 (> 500 行) 或跨 agent 共享 | 多 agent 复用 | 提升为 Skill,声明 `profile.skills[]`                           |
| 实时变化的外部源              | 任意          | MCP server 暴露查询工具,声明 `profile.mcpServers[]`            |

判断准则:**这份资料有没有第二个 agent 会用?**有 → Skill;没有 → references;介于之间 → 先 references,复用时升级为 Skill。

**参考实现**: `agents/code_reviewer/` 使用 references 引用本地 standards.md / patterns.md;`yummy` agent 使用 skill 调用 yummy CLI 的方法论。
```

### Task 5.3: Final verification

- [ ] **Step 1: Typecheck clean**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: clean (no new errors beyond pre-existing baseline).

- [ ] **Step 2: Test suite green**

```bash
npm test 2>&1 | tail -15
```

Expected: same pass/fail count as pre-plan baseline minus removed tests (contract-guard.test.ts; deleted test cases for acceptance/deliverables).

- [ ] **Step 3: Dev boot smoke**

```bash
npm run dev &
DEV_PID=$!
sleep 5
kill $DEV_PID 2>/dev/null
```

Expected: no startup crash. (User can manually check the UI loads if they want.)

### Task 5.4: Commit Phase 5

```bash
git add CLAUDE.md vibe/project/patterns.md
git commit -m "$(cat <<'EOF'
docs: Schema 2.0 — update CLAUDE.md and patterns.md

- CLAUDE.md: refresh code map and §8 to reflect Schema 2.0 flat structure.
- patterns.md: add P12 "领域知识加载策略" — how to choose between
  references / skills / MCP / inline agentPrompt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### Spec coverage check

- [x] 15 top-level fields, 6 required — Task 1.1
- [x] description multi-line absorbs scope — Task 1.1 (type doc), Task 4.4 (templates)
- [x] agentPrompt free markdown — Task 1.1, template
- [x] references file-only index, no auto-inject — Task 1.1 type, Task 2.1 template, Task 4.3 dep-checker
- [x] deliverables removed — Task 1.1 type, Task 3.1/3.3 contract-guard delete
- [x] workflow/mission/method gone — Task 1.1
- [x] 9 validator rules — Task 1.3
- [x] No backward-compat — Task 1.3 validator rule 1 rejects v1.0; Task 1.4/1.5 logs skip
- [x] knowledge → references rename — Task 1.1, Task 4.3
- [x] prompt template ~55 lines — Task 2.1
- [x] tools whitelist no `disabled` flag — Task 1.1 (BuiltinToolName[] instead of ToolDependency[])

### Placeholder scan

Sweep this plan for: "TBD", "TODO", "fill in", "appropriate", "similar to". Found:

- "(Adapt fs setup to existing test patterns in the file.)" — Task 1.4 — this is a small leniency; the existing loader.test.ts will show the pattern.
- "(Find the exact line via Read.)" — Task 2.3 — acceptable; trivial grep.

All other steps contain concrete code or exact transformations.

### Type consistency check

- `validateProfile(json, ctx?)` signature consistent across Phase 1 ✓
- `TemplateContext` shape change (Task 2.2) consistent with template Task 2.1 fields (`name`, `description`, `agentPrompt`, `hasReferences`, `references`, `criticalRoleConstraints`, `hasSkillListing`, `skillListing`) ✓
- `ReferenceFile = { id, path, description }` consistent in types (Task 1.1), validator (Task 1.3), dependency-checker (Task 4.3) ✓
- `DependencyStepName` adds `'references'` removes `'knowledge'` — Task 1.1 type, Task 4.3 consumer ✓

No drift found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-agent-schema-2-0.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best given the scope (5 phases, ~20 tasks) and that each task has clear scope boundaries.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for your review.

Which approach?
