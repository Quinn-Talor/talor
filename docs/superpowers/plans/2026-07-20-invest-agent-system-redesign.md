# 投研 Agent 体系重构 + 闭环 MVP —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让一张股票卡能被指令驱动着走完「建卡→取事实→梳理逻辑→更新事实→更新逻辑→决策→复盘」闭环,每个判断先过独立证伪(空方 gate 硬校验),命门只立在可信事实上,复盘教训回流下一轮。

**Architecture:** 三层落地,顺序即依赖。**Phase 1**(store/tools/types)加写入不变量与新读工具,纯后端可单测;**Phase 2**(agents)加空方 agent + 建模下沉 + PM 编排 prompt;**Phase 3**(UI)从**卡片 bundle**渲染红蓝对抗 + 补无卡入口 + 流程状态。关键约束:空方的 `challenge` 作为结构化数据**持久化在 thesis/checkpoint 上**(不是聊天消息),因此对抗过程从 `artifact.read` 的 bundle 渲染,绕开"子 agent 聊天turn 渲染器取不到"的限制。

**Tech Stack:** Electron + TS;better-sqlite3;Zod 工具校验;vitest(happy-dom for 渲染);设计依据 `docs/superpowers/specs/2026-07-20-invest-agent-system-redesign.md`。

**Scope note:** 三个 Phase 顺序依赖(Phase 2 用 Phase 1 的类型/工具,Phase 3 用 Phase 2 的 agent),非独立子系统,故合为一份计划;每个 Phase 结束时软件可测、可跑。

---

## File Structure(改动地图)

**Phase 1 — store/tools/types**

- Modify `src/shared/types/invest.ts` — 加 `ShortThesisChallenge` / `ThesisChallenge`;`ThesisSnapshot`+`Checkpoint` 加 `challenge`;`ReviewEvent` 扩容。
- Modify `src/main/invest/tools/card-tools.ts` — Zod 同步加字段;新增 `get_prior_lessons` 读工具。
- Modify `src/main/invest/store.ts` — 4 条新不变量(challenge 必填 ×2 / spawned_v / outcome-validity / ANCHOR_UNTRUSTED)+ `priorLessons()` + `addReview` 收严 `ref_v`。
- Modify `src/main/invest/tools/index.ts`(注释)、`src/main/invest/tools/index.test.ts`(计数 23→24)。
- Test `src/main/invest/store.redesign.test.ts`(新建,集中放新不变量测试)。

**Phase 2 — agents**

- Modify `src/main/invest/agents.ts` — 加 `short-thesis` profile + PM `subagents.ids` + 改 `MAIN_PROMPT # 流程` + 重排 `stock-specialist` 建模目标。
- Modify `src/main/invest/feature.ts` — `deniedWriteTools` 加 `short-thesis` case;更新计数注释。
- Modify `src/main/invest/feature.test.ts` / `feature.integration.test.ts` — agent 计数 5→6 + 新 agent 只读断言。

**Phase 3 — UI**

- Create `src/renderer/invest/ChallengeCard.tsx` — 红蓝对抗块(从 bundle 渲染)。
- Modify `src/renderer/invest/ActivePaper.tsx` — 命门/时间线节点挂 ChallengeCard + PriorLessonNote。
- Modify `src/renderer/invest/InvestWorkspace.tsx` — 无卡入口 + `researchSessionId` 覆写 `activeSession` + FlowStatusBadge。
- Modify `src/main/index.ts` + `src/preload/index.ts` + `src/renderer/api/talorAPI.ts` — `invest:start-research` IPC(建无卡研究会话,绑 stock-research)。
- Modify `src/renderer/invest/invest.css` — `.challenge` / `.flowbadge` / `.priorlesson` 样式。
- Test `src/renderer/invest/ChallengeCard.test.tsx`、扩 `InvestWorkspace.test.tsx`。

---

# Phase 1 — 地基与闭环(store / tools / types)

## Task 1: 数据模型 —— `challenge` 字段 + `ReviewEvent` 扩容(类型 + Zod)

**Files:**

- Modify: `src/shared/types/invest.ts:130-139`(ThesisSnapshot)、`:184-195`(Checkpoint)、`:207-214`(ReviewEvent)
- Modify: `src/main/invest/tools/card-tools.ts:139-147`(ThesisSnapshotZ)、`:184-200`(CheckpointZ)、`:211-221`(ReviewEventZ)
- Test: `src/main/invest/tools/card-tools.schema.test.ts`(新建)

- [ ] **Step 1: Write the failing test**

```ts
// src/main/invest/tools/card-tools.schema.test.ts
import { describe, it, expect } from 'vitest'
import { createCardTools } from './card-tools'
import { CardRepo, createCardTables } from '../store'
import Database from 'better-sqlite3'

function toolByName(name: string) {
  const db = new Database(':memory:')
  createCardTables(db)
  const t = createCardTools(new CardRepo(db)).find((x) => x.name === name)
  if (!t) throw new Error(`tool ${name} missing`)
  return t
}

describe('schema: challenge + review 扩容', () => {
  it('add_thesis zodSchema 接受 challenge 字段', () => {
    const parsed = (toolByName('add_thesis').zodSchema as any).safeParse({
      card_id: 'c1',
      snapshot: {
        v: 1,
        at: '2026-03',
        scope: '建立',
        claim: 'x',
        profit_type: '成长',
        valuation: {
          method: 'pe',
          assumptions: [],
          V: { bear: 1, base: 2, bull: 3 },
          margin_of_safety: { required: 0.2 },
        },
        challenge: {
          output: {
            target: 'thesis',
            weakest_assumption: 'co_share',
            refutation: 'r',
            suggested_verdict: '维持',
            severity: 'mid',
          },
          adjudication: { verdict: 'reject', note: 'n' },
        },
      },
    })
    expect(parsed.success).toBe(true)
  })

  it('add_review zodSchema 接受 thesis_realized / attribution / ref_decisions', () => {
    const parsed = (toolByName('add_review').zodSchema as any).safeParse({
      card_id: 'c1',
      review: {
        type: '复盘',
        at: '2026-06',
        vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        thesis_realized: [{ assumption: 'co_share', outcome: '兑现' }],
        attribution: { correctness: '对', luck_skill: '能力', alpha_beta: 'alpha' },
        lesson: 'l',
        ref_v: 1,
        ref_decisions: ['d1'],
      },
    })
    expect(parsed.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/main/invest/tools/card-tools.schema.test.ts`
Expected: FAIL — Zod rejects unknown keys `challenge` / `thesis_realized` (schemas don't define them yet).

- [ ] **Step 3: Add the types** (`src/shared/types/invest.ts`)

Add near the thesis/checkpoint types (after `Checkpoint`, ~line 195):

```ts
/** 空方·证伪官对一份草案的独立证伪结论(read-only 产出,不落判断)。 */
export interface ShortThesisChallenge {
  target: 'thesis' | 'checkpoint'
  weakest_assumption: string // 指向某命门 key
  refutation: string // 证伪论据
  counter_evidence?: { fact: string; as_of: string }[]
  suggested_verdict: '证伪' | '校准' | '维持'
  severity: 'high' | 'mid' | 'low'
}
/** 空方挑战 + PM 裁决(落在 thesis 版本 / checkpoint 上,供审计与 UI 红蓝对抗)。 */
export interface ThesisChallenge {
  output: ShortThesisChallenge
  adjudication: { verdict: 'accept' | 'reject' | 'revise'; note: string }
}
```

Add `challenge?: ThesisChallenge` to `ThesisSnapshot`(line 138 后)和 `Checkpoint`(line 194 后):

```ts
// ThesisSnapshot 内追加:
  challenge?: ThesisChallenge // 立论前空方证伪 + PM 裁决(add_thesis 硬校验必填)
// Checkpoint 内追加:
  challenge?: ThesisChallenge // 复查裁定前空方证伪 + PM 裁决(add_checkpoint 硬校验必填)
```

Replace `ReviewEvent`(207-214)with:

```ts
/** 复盘(平仓/周期):跑赢宽基 + 兑现度 + 归因 + 教训(回流下一轮)。 */
export interface ReviewEvent {
  type: '复盘'
  at: string
  vs_benchmark: { satellite: number; index: number; verdict: '跑赢' | '跑输' }
  thesis_realized?: { assumption: string; outcome: '兑现' | '未兑现' | '证伪' }[]
  attribution?: {
    correctness: '对' | '错'
    luck_skill: '能力' | '运气'
    alpha_beta: 'alpha' | 'beta'
  }
  lesson?: string
  ref_v?: number // Task 5 起 store 对新写强制必填
  ref_decisions?: string[]
}
```

- [ ] **Step 4: Add the Zod** (`src/main/invest/tools/card-tools.ts`)

After `VerifyHookZ`(~line 87)add:

```ts
const ShortThesisChallengeZ = z.object({
  target: z.enum(['thesis', 'checkpoint']),
  weakest_assumption: z.string(),
  refutation: z.string(),
  counter_evidence: z.array(z.object({ fact: z.string(), as_of: z.string() })).optional(),
  suggested_verdict: z.enum(['证伪', '校准', '维持']),
  severity: z.enum(['high', 'mid', 'low']),
})
const ThesisChallengeZ = z.object({
  output: ShortThesisChallengeZ,
  adjudication: z.object({ verdict: z.enum(['accept', 'reject', 'revise']), note: z.string() }),
})
```

Add `challenge: ThesisChallengeZ.optional()` into `ThesisSnapshotZ`(after line 146 `ref_checkpoint`)and into `CheckpointZ`(after line 199 `signal`). Replace `ReviewEventZ`(211-221):

```ts
const ReviewEventZ = z.object({
  type: z.literal('复盘'),
  at: z.string(),
  vs_benchmark: z.object({
    satellite: z.number(),
    index: z.number(),
    verdict: z.enum(['跑赢', '跑输']),
  }),
  thesis_realized: z
    .array(z.object({ assumption: z.string(), outcome: z.enum(['兑现', '未兑现', '证伪']) }))
    .optional(),
  attribution: z
    .object({
      correctness: z.enum(['对', '错']),
      luck_skill: z.enum(['能力', '运气']),
      alpha_beta: z.enum(['alpha', 'beta']),
    })
    .optional(),
  lesson: z.string().optional(),
  ref_v: z.number().optional(),
  ref_decisions: z.array(z.string()).optional(),
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/main/invest/tools/card-tools.schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck` — Expected: no new errors in touched files.

```bash
git add src/shared/types/invest.ts src/main/invest/tools/card-tools.ts src/main/invest/tools/card-tools.schema.test.ts
git commit -m "feat(invest): add challenge field + extend ReviewEvent (types+zod) — closes-loop schema"
```

---

## Task 2: 空方 gate 硬校验 —— add_thesis / add_checkpoint 无 challenge 拒写

**Files:**

- Modify: `src/main/invest/store.ts:326`(addThesisVersion)、`:466`(addCheckpoint)
- Test: `src/main/invest/store.redesign.test.ts`(新建)

- [ ] **Step 1: Write the failing test**

```ts
// src/main/invest/store.redesign.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { CardRepo, createCardTables, CardValidationError } from './store'
import type { ThesisSnapshot, Checkpoint } from '@shared/types/invest'

let store: CardRepo
beforeEach(() => {
  const db = new Database(':memory:')
  createCardTables(db)
  store = new CardRepo(db)
})

const CHALLENGE = {
  output: {
    target: 'thesis' as const,
    weakest_assumption: 'co_share',
    refutation: 'r',
    suggested_verdict: '维持' as const,
    severity: 'mid' as const,
  },
  adjudication: { verdict: 'reject' as const, note: '论据不成立:先行数据仍支持' },
}
function facts() {
  return {
    co_share: {
      level: 'company' as const,
      label: '份额',
      unit: '%',
      series: [{ value: '16%', as_of: '2026-03', source: '乘联会', tier: 'T1' as const }],
    },
  }
}
function baseSnap(over: Partial<ThesisSnapshot> = {}): ThesisSnapshot {
  return {
    v: 1,
    at: '2026-03',
    scope: '建立',
    claim: '份额抢占',
    profit_type: '成长',
    valuation: {
      method: 'pe',
      assumptions: [
        {
          key: 'co_share',
          label: '份额',
          unit: '%',
          anchor: { fact: 'co_share', as_of: '2026-03' },
          forecast: { mode: 'delta', bear: -1, base: 0, bull: 1, horizon: '2026' },
          logic: '成本护城河→份额',
          falsify_if: '连2季<14%',
          verify: [{ fact: 'co_share', at: 'quarterly', role: '先行' }],
          step: { order: 1, out: 'V' },
        },
      ],
      V: { bear: 13, base: 14, bull: 15 },
      margin_of_safety: { required: 0.2, anchor: 'bear' },
    },
    challenge: CHALLENGE,
    ...over,
  }
}
function seed() {
  const c = store.apply({ kind: 'create', code: '002594', name: '比亚迪', originSessionId: 's1' })
  store.apply({ kind: 'addFacts', id: c.id, facts: facts() })
  return c.id
}

describe('空方 gate (硬校验)', () => {
  it('(no-trigger) add_thesis 带 challenge → 通过', () => {
    const id = seed()
    expect(() => store.apply({ kind: 'addThesisVersion', id, snapshot: baseSnap() })).not.toThrow()
  })
  it('(trigger) add_thesis 无 challenge → THESIS_NO_CHALLENGE', () => {
    const id = seed()
    const snap = baseSnap()
    delete (snap as { challenge?: unknown }).challenge
    try {
      store.apply({ kind: 'addThesisVersion', id, snapshot: snap })
      throw new Error('should throw')
    } catch (e) {
      expect((e as CardValidationError).code).toBe('THESIS_NO_CHALLENGE')
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "空方 gate"`
Expected: the (trigger) case FAILS (no guard yet — throws "should throw").

- [ ] **Step 3: Implement the guards** (`src/main/invest/store.ts`)

In `addThesisVersion`, right after `this.assertCardExists(id)`(line 327)insert:

```ts
if (!snap.challenge?.output || !snap.challenge?.adjudication?.verdict) {
  throw new CardValidationError(
    'THESIS_NO_CHALLENGE',
    '立论须先过空方:add_thesis 缺 challenge(空方证伪 + PM 裁决)。委托 short-thesis 挑战草案后再落卡。',
  )
}
```

In `addCheckpoint`, right after `this.assertCardExists(id)`(line 467)insert:

```ts
if (!cp.challenge?.output || !cp.challenge?.adjudication?.verdict) {
  throw new CardValidationError(
    'CHECKPOINT_NO_CHALLENGE',
    '复查裁定须先过空方:add_checkpoint 缺 challenge(空方证伪 + PM 裁决)。',
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "空方 gate"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/invest/store.ts src/main/invest/store.redesign.test.ts
git commit -m "feat(invest): 空方 gate — add_thesis/add_checkpoint reject missing challenge"
```

---

## Task 3: 复查薄守卫 —— spawned_v + outcome/validity 一致性

**Files:**

- Modify: `src/main/invest/store.ts:466`(addCheckpoint,在 against_v 校验后)
- Test: `src/main/invest/store.redesign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 store.redesign.test.ts
function baseCheckpoint(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    type: '复查',
    at: '2026-07',
    against_v: 1,
    validity: '持有',
    checks: [],
    value_now: { V: { bear: 13, base: 14, bull: 15 }, margin_of_safety: { at_buy_point: true } },
    gate: { state: '通行' },
    spawned_v: null,
    signal: { verdict: '等', reason: 'r' },
    challenge: {
      output: {
        target: 'checkpoint',
        weakest_assumption: 'co_share',
        refutation: 'r',
        suggested_verdict: '维持',
        severity: 'low',
      },
      adjudication: { verdict: 'reject', note: 'n' },
    },
    ...over,
  }
}
function seedWithThesis() {
  const id = seed()
  store.apply({ kind: 'addThesisVersion', id, snapshot: baseSnap() })
  return id
}
describe('复查薄守卫', () => {
  it('(trigger) validity=校准 但 spawned_v=null → CALIBRATE_NO_SPAWN', () => {
    const id = seedWithThesis()
    try {
      store.apply({
        kind: 'addCheckpoint',
        id,
        checkpoint: baseCheckpoint({ validity: '校准', spawned_v: null }),
      })
      throw new Error('should throw')
    } catch (e) {
      expect((e as CardValidationError).code).toBe('CALIBRATE_NO_SPAWN')
    }
  })
  it('(trigger) checks 有 outcome=破 但 validity=持有 → OUTCOME_VALIDITY_MISMATCH', () => {
    const id = seedWithThesis()
    const cp = baseCheckpoint({
      validity: '持有',
      checks: [{ metric: 'co_share', actual_value: '12%', outcome: '破' }],
    })
    try {
      store.apply({ kind: 'addCheckpoint', id, checkpoint: cp })
      throw new Error('should throw')
    } catch (e) {
      expect((e as CardValidationError).code).toBe('OUTCOME_VALIDITY_MISMATCH')
    }
  })
  it('(no-trigger) validity=持有 + 无破 outcome → 通过', () => {
    const id = seedWithThesis()
    expect(() =>
      store.apply({ kind: 'addCheckpoint', id, checkpoint: baseCheckpoint() }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "复查薄守卫"`
Expected: 前两个 (trigger) FAIL(无守卫)。

- [ ] **Step 3: Implement** (`src/main/invest/store.ts`, addCheckpoint,在 `CHECKPOINT_NO_VERSION` 块之后、line 475 之后)

```ts
// 薄守卫:裁定必须推进循环状态,且与 checks 结论自洽
if ((cp.validity === '校准' || cp.validity === '证伪') && cp.spawned_v == null) {
  throw new CardValidationError(
    'CALIBRATE_NO_SPAWN',
    `validity=${cp.validity} 须出新版本(spawned_v 非空):校准/证伪意味着逻辑变了。`,
  )
}
if (
  (cp.checks ?? []).some((c) => c.outcome === '破') &&
  (cp.validity === '持有' || cp.validity === '强化')
) {
  throw new CardValidationError(
    'OUTCOME_VALIDITY_MISMATCH',
    `有对账 outcome=破 却判 validity=${cp.validity}:破=证伪,不能持有/强化。`,
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "复查薄守卫"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/invest/store.ts src/main/invest/store.redesign.test.ts
git commit -m "feat(invest): checkpoint 薄守卫 — spawned_v + outcome/validity 一致性"
```

---

## Task 4: 命门锚可信硬闸 —— `ANCHOR_UNTRUSTED`

规则:命门(有 logic 的参数)的锚事实,其 `anchor.as_of` 观测必须 **tier=T1**,或 **tier=T2 且该 fact key 在该 as_of 有 ≥2 个不同 source 的观测**(交叉校验);否则拒写。T3/compute 不得作命门锚。

**Files:**

- Modify: `src/main/invest/store.ts:326`(addThesisVersion,`needsAnchor` 块内)
- Test: `src/main/invest/store.redesign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 store.redesign.test.ts
describe('命门锚可信硬闸', () => {
  it('(no-trigger) 命门锚 T1 → 通过', () => {
    expect(() =>
      store.apply({ kind: 'addThesisVersion', id: seed(), snapshot: baseSnap() }),
    ).not.toThrow()
  })
  it('(trigger) 命门锚 T3 → ANCHOR_UNTRUSTED', () => {
    const c = store.apply({ kind: 'create', code: '600519', name: '茅台', originSessionId: 's2' })
    store.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [{ value: '16%', as_of: '2026-03', source: '雪球某帖', tier: 'T3' }],
        },
      },
    })
    try {
      store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: baseSnap() })
      throw new Error('should throw')
    } catch (e) {
      expect((e as CardValidationError).code).toBe('ANCHOR_UNTRUSTED')
    }
  })
  it('(no-trigger) 命门锚 T2 + 两源交叉 → 通过', () => {
    const c = store.apply({ kind: 'create', code: '000001', name: '平安', originSessionId: 's3' })
    store.apply({
      kind: 'addFacts',
      id: c.id,
      facts: {
        co_share: {
          level: 'company',
          label: '份额',
          unit: '%',
          series: [
            { value: '16%', as_of: '2026-03', source: '券商A研报', tier: 'T2' },
            { value: '16%', as_of: '2026-03', source: '券商B研报', tier: 'T2' },
          ],
        },
      },
    })
    expect(() =>
      store.apply({ kind: 'addThesisVersion', id: c.id, snapshot: baseSnap() }),
    ).not.toThrow()
  })
})
```

注:`雪球某帖`/`券商A研报` 须落在白名单里才能过 `addFacts`。若白名单不含"券商研报"通配,先在 `TRUSTED_SOURCE_PATTERNS`(store.ts:127-152)确认含"研报/券商";测试 source 用已在白名单的写法(如含"研报")。**实施前先读 store.ts:127-152 确认可信写法,按实际白名单调整 fixture 的 source 字符串。**

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "命门锚"`
Expected: T3 (trigger) FAIL(无闸)。

- [ ] **Step 3: Implement** (`src/main/invest/store.ts`, addThesisVersion,在 `needsAnchor` 块确认 `factKeys.has(a.anchor.fact)` 之后、line 367 附近)

```ts
// 命门锚可信硬闸:命门锚只能立在 T1、或 T2+两源交叉的事实上(T3/compute 拒)
if (isCore) {
  const series = facts[a.anchor!.fact]?.series ?? []
  const asOf = a.anchor?.as_of
  const obs = asOf ? series.filter((o) => o.as_of === asOf) : series
  const tiers = new Set(obs.map((o) => o.tier))
  const sources = new Set(obs.map((o) => o.source))
  const t1 = tiers.has('T1')
  const t2crossed = tiers.has('T2') && sources.size >= 2
  if (!t1 && !t2crossed) {
    throw new CardValidationError(
      'ANCHOR_UNTRUSTED',
      `命门「${name}」锚事实「${a.anchor!.fact}@${asOf ?? '*'}」不可信:命门锚须 T1,或 T2 且≥2 独立源交叉(当前 tier=${[...tiers].join('/') || '∅'}、源数=${sources.size})。`,
    )
  }
}
```

(此块放在 `needsAnchor` 的 `factKeys.has` 校验之后即可;`name`/`isCore`/`facts` 均在作用域内。)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "命门锚"`
Expected: PASS (3 tests)。若 T1 用例反而失败,检查 fixture source 是否在白名单。

- [ ] **Step 5: Commit**

```bash
git add src/main/invest/store.ts src/main/invest/store.redesign.test.ts
git commit -m "feat(invest): 命门锚可信硬闸 ANCHOR_UNTRUSTED — 命门只能立在 T1 或 T2 交叉事实上"
```

---

## Task 5: `add_review` 收严 `ref_v` 必填(新写)

**Files:**

- Modify: `src/main/invest/store.ts:559`(addReview)
- Test: `src/main/invest/store.redesign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 store.redesign.test.ts
function fullReviewSeed() {
  const id = seedWithThesis()
  // 需先复查+决策才能进入可复盘态?复盘只校验 verdict + ref_v,直接可加。
  return id
}
describe('复盘 ref_v 必填', () => {
  it('(trigger) 无 ref_v → REVIEW_NO_REF_VERSION', () => {
    const id = fullReviewSeed()
    try {
      store.apply({
        kind: 'addReview',
        id,
        review: {
          type: '复盘',
          at: '2026-08',
          vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        },
      })
      throw new Error('should throw')
    } catch (e) {
      expect((e as CardValidationError).code).toBe('REVIEW_NO_REF_VERSION')
    }
  })
  it('(no-trigger) 带 ref_v=1 → 通过', () => {
    const id = fullReviewSeed()
    expect(() =>
      store.apply({
        kind: 'addReview',
        id,
        review: {
          type: '复盘',
          at: '2026-08',
          vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
          ref_v: 1,
        },
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "ref_v"`
Expected: (trigger) FAIL。

- [ ] **Step 3: Implement** (`src/main/invest/store.ts`, addReview,在 `this.assertCardExists(id)` 之后、`ref_v != null` 校验块之前)

```ts
if (review.ref_v == null) {
  throw new CardValidationError(
    'REVIEW_NO_REF_VERSION',
    '复盘须挂逻辑版本 ref_v(复盘的是哪一版论点);无 ref_v 无法回溯兑现。',
  )
}
```

(原有 `if (review.ref_v != null) { …版本存在性… }` 块保留,现在恒成立。)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "ref_v"`
Expected: PASS。同时跑 `npx vitest run src/main/invest/feature.integration.test.ts` 确认既有 review() fixture 已带 `ref_v`(若无则补)。

- [ ] **Step 5: Commit**

```bash
git add src/main/invest/store.ts src/main/invest/store.redesign.test.ts
git commit -m "feat(invest): add_review 收严 ref_v 必填(复盘必挂逻辑版本)"
```

---

## Task 6: `get_prior_lessons` 读工具(回程边)

`get_prior_lessons(code)` 跨"同 code 的所有卡"收集其时间线里的复盘 lesson/attribution,供 PM 建卡/立论前读上轮教训。

**Files:**

- Modify: `src/main/invest/store.ts`(加 `priorLessons(code)` 方法)
- Modify: `src/main/invest/tools/card-tools.ts:299`(在返回数组追加 `def('get_prior_lessons', …)`)
- Test: `src/main/invest/store.redesign.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// 追加到 store.redesign.test.ts
describe('get_prior_lessons(回程边)', () => {
  it('返回同 code 卡的复盘教训', () => {
    const id = seedWithThesis()
    store.apply({
      kind: 'addReview',
      id,
      review: {
        type: '复盘',
        at: '2026-08',
        vs_benchmark: { satellite: 15, index: 10, verdict: '跑赢' },
        lesson: '风向顺+alpha 对',
        ref_v: 1,
        attribution: { correctness: '对', luck_skill: '能力', alpha_beta: 'alpha' },
      },
    })
    const lessons = store.priorLessons('002594')
    expect(lessons).toHaveLength(1)
    expect(lessons[0].lesson).toBe('风向顺+alpha 对')
    expect(lessons[0].ref_v).toBe(1)
  })
  it('无历史 → 空数组', () => {
    expect(store.priorLessons('999999')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "get_prior_lessons"`
Expected: FAIL — `store.priorLessons` 不存在。

- [ ] **Step 3: Implement store 方法** (`src/main/invest/store.ts`, 加 public 方法,参考 `listAll()`/`normalizeCode()` 现有工具)

```ts
  /** 回程边:跨同 code 的所有卡,取其复盘 lesson/attribution(供下一轮建卡复用)。 */
  priorLessons(code: string): { code: string; card_id: string; ref_v?: number; lesson?: string; attribution?: unknown; at: string }[] {
    const target = normalizeCode(code)
    const out: { code: string; card_id: string; ref_v?: number; lesson?: string; attribution?: unknown; at: string }[] = []
    for (const s of this.listAll()) {
      if (normalizeCode(s.code) !== target) continue
      const b = this.read(s.id)
      for (const e of b?.timeline ?? []) {
        if (e.type !== '复盘') continue
        const r = e as unknown as import('@shared/types/invest').ReviewEvent
        out.push({ code: s.code, card_id: s.id, ref_v: r.ref_v, lesson: r.lesson, attribution: r.attribution, at: r.at })
      }
    }
    return out
  }
```

(`normalizeCode` 已在 store.ts:162 作为模块内函数存在;若非 export 需在方法内直接调用同文件函数——确认可见性,必要时用现成的 `normalizeCode`。)

- [ ] **Step 4: Add the tool** (`src/main/invest/tools/card-tools.ts`, 在返回数组末尾 `get_timeline` 之后追加)

```ts
    def(
      'get_prior_lessons',
      '读同一股票代码历史卡的复盘教训(回程边:建卡/立论前先看上轮教训)。入参 code=股票代码。',
      z.object({ code: z.string().describe('股票代码') }),
      (i) => run(() => store.priorLessons(i.code)),
    ),
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/main/invest/store.redesign.test.ts -t "get_prior_lessons"`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/invest/store.ts src/main/invest/tools/card-tools.ts src/main/invest/store.redesign.test.ts
git commit -m "feat(invest): get_prior_lessons — 跨同 code 卡取复盘教训(闭环回程边)"
```

---

## Task 7: 修陈旧计数 + 全量回归

**Files:**

- Modify: `src/main/invest/tools/index.ts:1,15`(注释 23→24)、`src/main/invest/tools/index.test.ts:14-45`(计数 + 名单)
- Modify: `src/main/invest/tools/card-tools.ts:261`(注释 "9 个"→"10 个")

- [ ] **Step 1: Update the count test** (`src/main/invest/tools/index.test.ts`)

把 `toHaveLength(23)` 与 `Set(names).size === 23` 改为 `24`;在名单断言里加 `'get_prior_lessons'`。

- [ ] **Step 2: Update comments**

`tools/index.ts:1,15`:"14 compute + 9 card … 共 23" → "14 compute + 10 card … 共 24"。
`card-tools.ts:261`:"返回 9 个 card 工具" → "返回 10 个 card 工具"。

- [ ] **Step 3: Full suite + typecheck**

Run: `npm run rebuild:node && npx vitest run` — Expected: 全绿(允许既有 http-tool-call 未处理 rejection 噪声)。
Run: `npm run typecheck` — Expected: 无新错误。

- [ ] **Step 4: Commit**

```bash
git add src/main/invest/tools/index.ts src/main/invest/tools/index.test.ts src/main/invest/tools/card-tools.ts
git commit -m "chore(invest): 工具计数 23→24 + 注释同步(get_prior_lessons)"
```

---

# Phase 2 — Agent 行为(空方 + 建模下沉 + PM 编排)

## Task 8: 建模下沉标的分析师(prompt 重排)

**Files:**

- Modify: `src/main/invest/agents.ts:100-110`(stock-specialist 的 `specialistPrompt` goals)

- [ ] **Step 1: Rewrite the goals string**

把 `stock-specialist` 的 `specialistPrompt('标的', '<goals>')`(agents.ts:104-108)第二参补上建模职责:

```ts
    agentPrompt: specialistPrompt(
      '标的',
      '**通用核心**(营收/利润/毛利净利率/ROE/经营现金流/资产负债/估值PE-PB分位)+ **按行业补 KPI**(制造:产能利用率/在手订单;消费:同店/客单/会员;周期:产品价格/库存;科技:研发占比/在手订单);' +
        '每条事实给**三维**(数值·变化·结构)。' +
        '**并承担估值建模**:compute_dupont/compute_turnover 拆 ROE → compute_projection 出 EPS 路径 → compute_valuation 四情景 V + compute_percentile 位置 + reverse_dcf 反推隐含增速 → 组装**命门草案**(哪几个是命门、各自 anchor.fact/forecast/verify/falsify_if + valuation trace),fan-out 给主理人落 add_thesis;**自身不落卡、不下决策**。',
    ),
```

- [ ] **Step 2: Verify registration unchanged**

Run: `npx vitest run src/main/invest/feature.test.ts` — Expected: PASS(profile 仍在,tools 未变)。

- [ ] **Step 3: Commit**

```bash
git add src/main/invest/agents.ts
git commit -m "feat(invest): 建模下沉标的分析师(命门草案由标的分析师产出,PM 不再自建模)"
```

---

## Task 9: 新增空方·证伪官(read-only agent)

**Files:**

- Modify: `src/main/invest/agents.ts:84`(INVEST_SEED_AGENTS 加 profile)、`:91-98`(PM subagents.ids 加 short-thesis)
- Modify: `src/main/invest/feature.ts:77`(deniedWriteTools 加 case)
- Test: `src/main/invest/feature.short-thesis.test.ts`(新建)

- [ ] **Step 1: Write the failing test**

```ts
// src/main/invest/feature.short-thesis.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { investFeatureMain } from './feature'

describe('空方 agent 注册', () => {
  beforeEach(() => investFeatureMain.init({ db: new Database(':memory:') }))
  it('short-thesis 已注册且零写卡权(读/compute 保留)', () => {
    const agents = investFeatureMain.agents!()
    const st = agents.find((a) => a.profile.id === 'short-thesis')
    expect(st).toBeTruthy()
    const names = (st!.tools ?? []).map((t) => t.name)
    for (const w of [
      'create_card',
      'set_eligibility',
      'add_facts',
      'add_thesis',
      'add_checkpoint',
      'add_decision',
      'add_review',
    ]) {
      expect(names).not.toContain(w)
    }
    expect(names).toContain('get_card')
    expect(names).toContain('check_falsification')
    expect(names).toContain('reverse_dcf')
    expect(names).toContain('get_prior_lessons')
  })
  it('PM(stock-research)把 short-thesis 列为 subagent', () => {
    const pm = investFeatureMain.agents!().find((a) => a.profile.id === 'stock-research')!
    const ids = pm.profile.subagents?.ids?.map((r) => r.id) ?? []
    expect(ids).toContain('short-thesis')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/feature.short-thesis.test.ts`
Expected: FAIL — short-thesis 未注册。

- [ ] **Step 3: Add the profile** (`src/main/invest/agents.ts`, INVEST_SEED_AGENTS 数组内追加,参考 review-analyst 的 inline 写法 + 复用 `TOOL_DISCIPLINE`)

```ts
  {
    id: 'short-thesis',
    name: '空方·证伪官',
    description:
      '一句话:独立证伪官(空方)。会做:read-only 读全卡,挑最弱命门、论证已破/预测过乐观、反"持有"惯性,产结构化 challenge。不会做:建卡、改事实、落任何判断(裁决权在主理人)。',
    agentPrompt: `你是空方·证伪官,对主理人的草案(立论/复查裁定)做**独立证伪**。

${TOOL_DISCIPLINE}

# 目标
尽力**推翻**当前草案,不是配合它:
1. 挑**最弱命门**:reverse_dcf(现价是否已隐含过高增速)/ check_falsification(某 verify.fact 是否已越阈)/ cross_check(来源是否打架)/ compute_percentile(估值是否已在历史高位)。
2. 独立采**反面证据**(search_tool + 检索),不复用主理人给的中间结论。
3. 质疑机制:护城河真伪、逻辑是否已被新事实推翻。

# 输出(结构化 challenge)
{ target:'thesis'|'checkpoint', weakest_assumption:命门key, refutation:证伪论据, counter_evidence?:[{fact,as_of}], suggested_verdict:'证伪'|'校准'|'维持', severity:'high'|'mid'|'low' }
**你只挑战、不裁决、不落卡**;是否采纳由主理人定。`,
  },
```

- [ ] **Step 4: Register as PM subagent** (`src/main/invest/agents.ts:92-97`, stock-research `subagents.ids` 追加)

```ts
        { id: 'short-thesis', required: true, purpose: '立论/复查裁定前的独立证伪(空方 gate)' },
```

- [ ] **Step 5: Add read-only narrowing** (`src/main/invest/feature.ts`, deniedWriteTools 的 switch 内,`stock-specialist` 那组之后)

```ts
    // 空方:纯 read-only,零写卡(读/检索/compute 全保留)
    case 'short-thesis':
      return new Set(CARD_WRITE_TOOLS)
```

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/main/invest/feature.short-thesis.test.ts`
Expected: PASS (2 tests)。

- [ ] **Step 7: Fix agent-count assertions + commit**

更新 `feature.ts:109` 注释(5→6 agent);若 `feature.test.ts`/`feature.integration.test.ts` 有"agent 数=5"或枚举断言,改为 6 + 含 short-thesis。

```bash
git add src/main/invest/agents.ts src/main/invest/feature.ts src/main/invest/feature.short-thesis.test.ts src/main/invest/feature.test.ts
git commit -m "feat(invest): 新增空方·证伪官(read-only)+ 挂为 PM 必备 subagent"
```

---

## Task 10: PM 编排 prompt —— 空方 gate + 冷启动

**Files:**

- Modify: `src/main/invest/agents.ts:64-68`(MAIN_PROMPT `# 流程`)

- [ ] **Step 1: Rewrite `# 流程`** (agents.ts:64-68)

```ts
# 流程
**冷启动(无卡/新标的)**:先锚代码(search_tool/MCP 得准确 code)→ get_prior_lessons(code) 读上轮教训 → create_card → **资格赛(第一道闸)**:委托 stock-specialist compute_red_flags 排雷 + 判能力圈/护城河 → set_eligibility;**不合格明说"不建逻辑"、停在资格态**,合格才继续。
建立:委托 specialist 采公司/行业/宏观事实 add_facts → 委托 stock-specialist 建模出**命门草案** → 【强制】委托 short-thesis 空方证伪 → 你裁决(驳回留痕 or 按 challenge 改) → add_thesis(v1,**带 challenge**)→ macro 用 compute_macro_clock 出 gate。
跟踪:specialist 增量 add_facts(先行 key 优先)→ 对账 → 【强制】委托 short-thesis 证伪该裁定 → 你裁决 → add_checkpoint(**带 challenge**;校准/证伪必填 spawned_v)→ 校准/证伪则 add_thesis 新版本(同样过空方)。
决策:gate + 安全边际双闸过 → add_decision。
复盘:委托 review-analyst → add_review(带 ref_v/thesis_realized/attribution;跑输宽基=失败)。
**铁律补充**:add_thesis/add_checkpoint 无 challenge 会被 store 拒写(THESIS_NO_CHALLENGE/CHECKPOINT_NO_CHALLENGE);命门锚只能立在 T1 或 T2+两源交叉事实(否则 ANCHOR_UNTRUSTED),取数优先走结构化数值接口、不背数字。`
```

- [ ] **Step 2: Sanity check the prompt string compiles**

Run: `npm run typecheck` — Expected: 无新错误(纯字符串改动)。
Run: `npx vitest run src/main/invest/feature.test.ts src/main/invest/feature.short-thesis.test.ts` — Expected: PASS。

- [ ] **Step 3: Manual behavior note (记录在 PR)**

Prompt 行为(委托空方→裁决→带 challenge 落卡)是软引导,硬约束已在 Phase 1 store 焊死;真实轮次行为需在 dev app 手验(需 provider),不做自动断言。

- [ ] **Step 4: Commit**

```bash
git add src/main/invest/agents.ts
git commit -m "feat(invest): PM 流程加空方 gate + 冷启动(先资格赛后逻辑)+ 带 challenge 落卡"
```

---

# Phase 3 — UI(从 bundle 渲染对抗 + 无卡入口 + 流程状态)

> **架构约束(实施前必读)**:子 agent(空方/specialist)的对话 turn 跑在**独立子会话**里,渲染器取不到(`ChatMessage` 无 `agent_id`,`getMessages` 只回根会话)。因此**红蓝对抗不从聊天渲染**,而从 `artifact.read` 的 `CardBundle` 里 `thesis.challenge` / checkpoint.challenge 渲染(数据在 Phase 1 已落 bundle)。**"分析过程按发言人分角色"因缺数据平铺,推迟到 v2**(需新增 message.agent_id + 子会话 IPC)。

## Task 11: ChallengeCard —— 从 bundle 渲染红蓝对抗

**Files:**

- Create: `src/renderer/invest/ChallengeCard.tsx`
- Modify: `src/renderer/invest/ActivePaper.tsx`(当前 thesis 版本区挂 ChallengeCard)
- Modify: `src/renderer/invest/invest.css`(`.challenge` 样式)
- Test: `src/renderer/invest/ChallengeCard.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/invest/ChallengeCard.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ChallengeCard } from './ChallengeCard'

afterEach(cleanup)

const challenge = {
  output: {
    target: 'thesis' as const,
    weakest_assumption: 'co_share',
    refutation: '现价已隐含 25% 增速,过高',
    suggested_verdict: '校准' as const,
    severity: 'high' as const,
  },
  adjudication: { verdict: 'reject' as const, note: '先行销量仍支撑,维持' },
}

describe('ChallengeCard(红蓝对抗)', () => {
  it('渲染空方论据 + PM 裁决', () => {
    const { container } = render(<ChallengeCard challenge={challenge} />)
    const txt = container.textContent ?? ''
    expect(txt).toContain('现价已隐含 25% 增速')
    expect(txt).toContain('先行销量仍支撑')
    expect(container.querySelector('.challenge')).toBeTruthy()
  })
  it('challenge 为空 → 不渲染', () => {
    const { container } = render(<ChallengeCard challenge={undefined} />)
    expect(container.querySelector('.challenge')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/invest/ChallengeCard.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Implement** (`src/renderer/invest/ChallengeCard.tsx`)

```tsx
// src/renderer/invest/ChallengeCard.tsx —— 红蓝对抗:空方证伪(红)+ PM 裁决(中性)
import type { ThesisChallenge } from '@shared/types/invest'

const VERDICT_LABEL: Record<string, string> = { accept: '采纳', reject: '驳回', revise: '改判' }

export function ChallengeCard({ challenge }: { challenge?: ThesisChallenge }) {
  if (!challenge?.output) return null
  const { output: o, adjudication: a } = challenge
  return (
    <div className="challenge">
      <div className="ch-short">
        <span className="ch-tag ch-tag-bear">空方 · {o.severity}</span>
        <b>最弱命门:{o.weakest_assumption}</b>
        <div className="ch-body">{o.refutation}</div>
        <div className="ch-verdict-sug">空方建议:{o.suggested_verdict}</div>
      </div>
      <div className="ch-pm">
        <span className="ch-tag ch-tag-pm">
          主理人裁决 · {VERDICT_LABEL[a.verdict] ?? a.verdict}
        </span>
        <div className="ch-body">{a.note}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS** (`src/renderer/invest/invest.css`, 追加)

```css
.invest-surface .challenge {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  margin: 8px 0;
  font-size: 11.5px;
}
.invest-surface .challenge .ch-short {
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bad) 8%, transparent);
  border-left: 3px solid var(--bad);
}
.invest-surface .challenge .ch-pm {
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  border-left: 3px solid var(--accent);
}
.invest-surface .challenge .ch-tag {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 5px;
  margin-bottom: 4px;
}
.invest-surface .challenge .ch-tag-bear {
  background: var(--bad);
  color: #fff;
}
.invest-surface .challenge .ch-tag-pm {
  background: var(--accent);
  color: #fff;
}
.invest-surface .challenge .ch-body {
  color: var(--ink-2);
  line-height: 1.55;
}
.invest-surface .challenge .ch-verdict-sug {
  margin-top: 3px;
  color: var(--ink-3);
  font-size: 10.5px;
}
```

- [ ] **Step 5: Mount in ActivePaper** (`src/renderer/invest/ActivePaper.tsx`, 当前逻辑版本区渲染处)

import 后,在当前 thesis 版本详情块(命门 chainflow 附近)插入 `{currentThesis(view)?.challenge && <ChallengeCard challenge={currentThesis(view).challenge} />}`(按 ActivePaper 现有 `currentThesis`/`view` 取法调用;实施时读 ActivePaper 现有变量名对齐)。

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run src/renderer/invest/ChallengeCard.test.tsx`
Expected: PASS (2 tests)。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/invest/ChallengeCard.tsx src/renderer/invest/ChallengeCard.test.tsx src/renderer/invest/ActivePaper.tsx src/renderer/invest/invest.css
git commit -m "feat(invest,ui): 红蓝对抗 ChallengeCard(从 bundle 的 thesis.challenge 渲染)"
```

---

## Task 12: 无卡入口 —— "+ 研究新标的" + `invest:start-research` IPC

**Files:**

- Modify: `src/main/invest/feature.ts`(加 `startResearchSession(providerId)` 导出)、`src/main/index.ts`(IPC)、`src/preload/index.ts`、`src/renderer/api/talorAPI.ts`
- Modify: `src/renderer/invest/InvestWorkspace.tsx`(researchSessionId 覆写 activeSession + 池子入口)
- Test: `src/main/invest/ensure-session.test.ts`(扩,验证 startResearchSession)

- [ ] **Step 1: Write the failing test** (扩 `src/main/invest/ensure-session.test.ts`)

```ts
it('startResearchSession 建无卡研究会话,绑 stock-research', () => {
  const sid = startResearchSession('p1')
  expect(sid).toMatch(/^[0-9a-f-]{36}$/)
  expect(sessionRepo.getById(sid)?.agent_id).toBe('stock-research')
})
```

(文件顶部 import 里加 `startResearchSession`。)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/main/invest/ensure-session.test.ts -t "startResearchSession"`
Expected: FAIL — 未导出。

- [ ] **Step 3: Implement** (`src/main/invest/feature.ts`, 参考 `ensureCardSession` 的 sessionRepo.create 写法)

```ts
/** 无卡发起研究:建一个绑 stock-research 的新会话(冷启动;PM 建卡前先有会话可对话)。 */
export function startResearchSession(providerId: string): string {
  const s = sessionRepo.create({
    title: '投研 · 新标的',
    provider_id: providerId,
    agent_id: 'stock-research',
    status: 'completed',
  })
  log.info('[invest] started card-less research session', s.id)
  return s.id
}
```

- [ ] **Step 4: Wire IPC** (`src/main/index.ts`, 紧邻 `invest:ensure-session`)

```ts
ipcMain.handle('invest:start-research', () => {
  let providerId = ''
  try {
    providerId = getDefaultProvider().id
  } catch {
    providerId = ''
  }
  return startResearchSession(providerId)
})
```

import 处加 `startResearchSession`。

- [ ] **Step 5: preload + 类型** (`src/preload/index.ts` invest 内、`src/renderer/api/talorAPI.ts` 全局类型内)

```ts
// preload invest:
startResearch: (): Promise<string> => ipcRenderer.invoke('invest:start-research'),
// talorAPI.ts 类型 invest:
startResearch: () => Promise<string>
```

- [ ] **Step 6: Renderer 接线** (`src/renderer/invest/InvestWorkspace.tsx`)

加 state + 覆写 activeSession(line 55)+ 池子入口:

```tsx
const [researchSessionId, setResearchSessionId] = useState<string | null>(null)
// line 55 改为:
const activeSession = selected?.origin_session_id ?? researchSessionId ?? null
// 池子 <aside> 内、cards.map 之前加:
<button className="thumb thumb-new" onClick={async () => {
  try { const sid = await window.talorAPI.invest.startResearch(); setSelectedId(null); setResearchSessionId(sid) } catch {}
}}>+ 研究新标的</button>
```

落库后经既有 `onMessagePersisted`→`setTick` 刷新池子;PM `create_card` 后新卡入池,用户可点选切到该卡(其 origin_session 即接续)。

- [ ] **Step 7: Run + typecheck**

Run: `npx vitest run src/main/invest/ensure-session.test.ts` — Expected: PASS。
Run: `npm run typecheck` — Expected: 无新错误。

- [ ] **Step 8: Commit**

```bash
git add src/main/invest/feature.ts src/main/index.ts src/preload/index.ts src/renderer/api/talorAPI.ts src/renderer/invest/InvestWorkspace.tsx src/main/invest/ensure-session.test.ts
git commit -m "feat(invest,ui): 无卡入口 + invest:start-research(冷启动可从零发起研究)"
```

---

## Task 13: FlowStatusBadge —— 每卡流程状态

从卡的最新时间线节点 + validity 派生 `建立/持有/待复查/校准中/已平仓`,池子缩略卡露出。

**Files:**

- Create: `src/renderer/invest/flowStatus.ts`(纯函数 + 单测)
- Modify: `src/renderer/invest/InvestWorkspace.tsx`(池子缩略卡挂 badge)
- Test: `src/renderer/invest/flowStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/invest/flowStatus.test.ts
import { describe, it, expect } from 'vitest'
import { flowStatus } from './flowStatus'
import type { CardSummary } from '@shared/types/invest'

const base = (o: Partial<CardSummary>): CardSummary =>
  ({ id: 'c', code: '1', name: 'n', status: 'held', ...o }) as CardSummary

describe('flowStatus', () => {
  it('无逻辑 → 建立', () =>
    expect(flowStatus(base({ claim: undefined, validity: undefined }))).toBe('建立'))
  it('已平仓 → 已平仓', () => expect(flowStatus(base({ status: 'closed' }))).toBe('已平仓'))
  it('validity=校准 → 校准中', () => expect(flowStatus(base({ validity: '校准' }))).toBe('校准中'))
  it('持有态 → 持有', () => expect(flowStatus(base({ claim: 'x', validity: '持有' }))).toBe('持有'))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/invest/flowStatus.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Implement** (`src/renderer/invest/flowStatus.ts`)

```ts
import type { CardSummary } from '@shared/types/invest'
export type FlowStatus = '建立' | '持有' | '待复查' | '校准中' | '已平仓'
export function flowStatus(c: CardSummary): FlowStatus {
  if (c.status === 'closed') return '已平仓'
  if (!c.claim && !c.validity) return '建立'
  if (c.validity === '校准' || c.validity === '证伪') return '校准中'
  return '持有'
}
```

(实施时确认 `CardSummary` 是否有 `status:'closed'` 与 `claim`/`validity` 字段;按实际字段名对齐——探针确认 `validity`/`claim`/`status` 均在 CardSummary 上。)

- [ ] **Step 4: Mount badge** (`src/renderer/invest/InvestWorkspace.tsx`, 缩略卡 `.tn` 内)

```tsx
<span className="flowbadge">{flowStatus(c)}</span>
```

CSS(invest.css):`.invest-surface .flowbadge { font-size: 8.5px; color: var(--ink-3); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; margin-left: auto; }`

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/renderer/invest/flowStatus.test.ts`
Expected: PASS (4 tests)。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/invest/flowStatus.ts src/renderer/invest/flowStatus.test.ts src/renderer/invest/InvestWorkspace.tsx src/renderer/invest/invest.css
git commit -m "feat(invest,ui): FlowStatusBadge — 每卡流程状态(从时间线/validity 派生)"
```

---

## Task 14: PriorLessonNote —— 建卡/立论时露出上轮教训

**Files:**

- Create: `src/renderer/invest/PriorLessonNote.tsx`
- Modify: `src/renderer/invest/ActivePaper.tsx`(逻辑区上方,调 `talorAPI.invest.getPriorLessons(code)`)
- Modify: `src/main/index.ts` + preload + talorAPI 类型(`invest:prior-lessons` IPC 包 `get_prior_lessons` 的 store 方法)
- Test: `src/renderer/invest/PriorLessonNote.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/renderer/invest/PriorLessonNote.test.tsx
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PriorLessonNote } from './PriorLessonNote'
afterEach(cleanup)
describe('PriorLessonNote', () => {
  it('有教训 → 渲染', () => {
    const { container } = render(
      <PriorLessonNote lessons={[{ ref_v: 1, lesson: '别把运气当能力', at: '2026-06' }]} />,
    )
    expect(container.textContent ?? '').toContain('别把运气当能力')
  })
  it('无教训 → 不渲染', () => {
    const { container } = render(<PriorLessonNote lessons={[]} />)
    expect(container.querySelector('.priorlesson')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderer/invest/PriorLessonNote.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: Implement component** (`src/renderer/invest/PriorLessonNote.tsx`)

```tsx
export interface PriorLesson {
  ref_v?: number
  lesson?: string
  at: string
}
export function PriorLessonNote({ lessons }: { lessons: PriorLesson[] }) {
  const withText = lessons.filter((l) => l.lesson)
  if (withText.length === 0) return null
  return (
    <div className="priorlesson">
      <div className="pl-h">↩ 上轮教训</div>
      {withText.map((l, i) => (
        <div key={i} className="pl-item">
          · {l.lesson}
          <span className="pl-at">{l.at}</span>
        </div>
      ))}
    </div>
  )
}
```

CSS:`.invest-surface .priorlesson { border: 1px dashed var(--border-2); border-radius: 8px; padding: 6px 9px; margin: 6px 0; font-size: 10.5px; color: var(--ink-2); } .invest-surface .priorlesson .pl-h { font-weight: 600; color: var(--ink-3); margin-bottom: 3px; } .invest-surface .priorlesson .pl-at { color: var(--ink-3); margin-left: 6px; font-size: 9px; }`

- [ ] **Step 4: Add IPC** (`invest:prior-lessons` → store.priorLessons)

`src/main/index.ts`:

```ts
ipcMain.handle(
  'invest:prior-lessons',
  (_e, code: string) => getInvestStore()?.priorLessons(code) ?? [],
)
```

(import `getInvestStore`。)preload invest 加 `getPriorLessons: (code: string) => ipcRenderer.invoke('invest:prior-lessons', code)`;talorAPI 类型加 `getPriorLessons: (code: string) => Promise<{ ref_v?: number; lesson?: string; at: string }[]>`。

- [ ] **Step 5: Mount in ActivePaper** (`src/renderer/invest/ActivePaper.tsx`)

在逻辑区上方,用 effect 拉 `talorAPI.invest.getPriorLessons(bundle.head.code)` 存 state → `<PriorLessonNote lessons={priorLessons} />`(实施时对齐 ActivePaper 现有 bundle 变量名 + effect 依赖 [cardId, refreshTick])。

- [ ] **Step 6: Run + typecheck**

Run: `npx vitest run src/renderer/invest/PriorLessonNote.test.tsx` — Expected: PASS。
Run: `npm run typecheck` — Expected: 无新错误。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/invest/PriorLessonNote.tsx src/renderer/invest/PriorLessonNote.test.tsx src/renderer/invest/ActivePaper.tsx src/renderer/invest/invest.css src/main/index.ts src/preload/index.ts src/renderer/api/talorAPI.ts
git commit -m "feat(invest,ui): PriorLessonNote — 建卡/立论露出上轮教训(回程边可视)"
```

---

## Deferred(明确不做 / 推迟 v2)

- **分析过程按发言人分角色平铺** —— 子 agent turn 在独立子会话,渲染器取不到;需先加 `message.agent_id` + 子会话消息 IPC。红蓝对抗已用 bundle 渲染覆盖了"看到证伪"的核心价值,分角色平铺推迟。
- 空方 panel(多数表决)、对账 grounding(系统填 actual)、结构化 provenance + 口径字段、到期检测/自动盯/后台 push —— 均 v2(见 spec §10)。

---

## Self-Review

**Spec coverage(对照 spec §):**

- §2.2.5 空方 + §2.3 gate → Task 2(硬校验)、Task 9(agent)、Task 10(PM 流程)。✅
- §2.2.4 建模下沉 → Task 8。✅
- §2.5 冷启动 → Task 10(PM 流程)、Task 12(无卡入口 IPC)。✅
- §3.1 闭环增补(get_prior_lessons / add_review 扩容 / 薄守卫)→ Task 6 / Task 1+5 / Task 3。✅
- §3.2 命门锚可信硬闸 → Task 4。✅(L0 结构化取数、L2 交叉校验为 agent 行为 + Task 4 的 T2 双源规则落地;provenance/口径按决策 7 推迟 v2。)
- §5.2 红蓝对抗 → Task 11(改为 bundle 渲染)。§5.4 无卡入口 → Task 12。§5.1 流程状态 → Task 13;上轮教训 → Task 14。✅
- §5.2 分角色发言 → **Deferred**(数据不可得,已记原因)。

**Placeholder scan:** 无 TBD/TODO;每个改代码步给了实际代码。UI Task 11/13/14 有"对齐 ActivePaper 现有变量名"提示——因 ActivePaper 内部变量名未逐行取回,实施首步须读该文件确认(已在步骤中显式要求),非占位。

**Type consistency:** `ThesisChallenge`/`ShortThesisChallenge`(Task 1)在 Task 2 守卫、Task 11 渲染中字段一致(`output.weakest_assumption`/`output.refutation`/`output.suggested_verdict`/`adjudication.verdict`/`adjudication.note`);`store.priorLessons`(Task 6)返回形与 Task 14 `PriorLesson`/IPC 一致(`ref_v?`/`lesson?`/`at`);错误码新增 `THESIS_NO_CHALLENGE`/`CHECKPOINT_NO_CHALLENGE`/`CALIBRATE_NO_SPAWN`/`OUTCOME_VALIDITY_MISMATCH`/`ANCHOR_UNTRUSTED`/`REVIEW_NO_REF_VERSION` 全程一致。
