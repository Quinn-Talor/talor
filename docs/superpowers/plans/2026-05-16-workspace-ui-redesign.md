# Talor Workspace UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Talor Electron workspace UI per [spec 2026-05-15](../specs/2026-05-15-workspace-ui-redesign.md) — chromeless flow, MCP-agnostic rendering, hidden block labels, streaming consistency.

**Architecture:**

- Design tokens centralized in `index.css` + `tailwind.config.js` (5 colors, 4 type sizes, 3 radii, 5 spacings)
- Chat layout extracted from 1969-line `Chat/index.tsx` into 4 sub-components (Sidebar / TopBar / MessageStream / InputArea)
- New block: `Proposal` (generalized "user-confirmable action" with `tool + args + label`); UI knows nothing about email/calendar/web
- Built-in 7 tools get specialized renderers; all MCP tools share a generic row + JSON expandable; LLM generates content via markdown + 5 blocks

**Tech Stack:** Electron, React 19, Tailwind, Zustand, Vercel AI SDK, Vitest, Zod, better-sqlite3

**Reference visual:** `.superpowers/brainstorm/91391-1778854140/content/final-v2.html`

---

## Phase 0 · Preflight & baseline

### Task 0.1: Verify clean state + baseline tests pass

**Files:** none (read-only)

- [ ] **Step 1: Confirm on correct branch**

```bash
git branch --show-current
```

Expected: `feature/workspace-ui-redesign`

- [ ] **Step 2: Confirm clean working tree (besides .superpowers/ + docs/)**

```bash
git status --short
```

Expected: only untracked `.superpowers/` and `docs/superpowers/`

- [ ] **Step 3: Baseline npm test (note any pre-existing failures)**

```bash
npm test 2>&1 | tail -30
```

Expected: tests run. **Record any pre-existing failures** — those are the floor; redesign must not increase failures.

- [ ] **Step 4: Baseline typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: 0 errors (or record existing errors as baseline).

- [ ] **Step 5: Commit baseline note (spec + plan)**

```bash
git add docs/superpowers/specs/2026-05-15-workspace-ui-redesign.md docs/superpowers/plans/2026-05-16-workspace-ui-redesign.md
git commit -m "docs(ui-redesign): add spec + plan for workspace UI overhaul

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 · Design tokens foundation

Replace ad-hoc hex literals with CSS variables. App should still render (just with new colors), no layout change.

### Task 1.1: Rewrite `src/renderer/index.css` with new token system

**Files:**

- Modify: `src/renderer/index.css` (36 → ~110 lines)

- [ ] **Step 1: Read current file to confirm small + scoped**

```bash
cat src/renderer/index.css
```

Expected: minimal file with @tailwind + scrollbar + reset.

- [ ] **Step 2: Write new tokens**

Replace entire content with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Colors */
  --text: #09090b;
  --body: #27272a;
  --mute: #71717a;
  --subtle: #a1a1aa;
  --line: #e4e4e7;
  --line-2: #f4f4f5;
  --surface: #fafafa;
  --canvas: #ffffff;

  --accent: #3b82f6;
  --indigo: #6366f1;

  --ok: #16a34a;
  --warn: #d97706;
  --err: #dc2626;
  --info: #2563eb;

  /* Diff backgrounds */
  --add-bg: #f0fdf4;
  --del-bg: #fef2f2;

  /* Radii */
  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;

  /* Type */
  --font-ui: -apple-system, 'Segoe UI', 'PingFang SC', sans-serif;
  --font-mono: 'SF Mono', 'Menlo', monospace;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.65;
  color: var(--text);
  background: var(--canvas);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: var(--line);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--subtle);
}

/* Animation primitives (used by streaming cursor + spinner) */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
```

- [ ] **Step 3: Run dev mode to verify**

```bash
npm run dev
```

Expected: app loads. Colors shift slightly (background lighter, text neutral). UI works.

- [ ] **Step 4: Stop dev mode (Ctrl-C in terminal)**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(ui): introduce design tokens (colors / radii / type) in index.css

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Update `tailwind.config.js` colors to match tokens

**Files:**

- Modify: `tailwind.config.js`

- [ ] **Step 1: Replace `theme.extend.colors`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // Map CSS variables to Tailwind names for class-based use
        text: 'var(--text)',
        body: 'var(--body)',
        mute: 'var(--mute)',
        subtle: 'var(--subtle)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        surface: 'var(--surface)',
        canvas: 'var(--canvas)',
        accent: 'var(--accent)',
        indigo: 'var(--indigo)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-md)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 2: Run typecheck (existing components reference primary/accent — may break)**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: typecheck passes (Tailwind classes are strings, no TS impact).

- [ ] **Step 3: Run grep for old color references that may visually break**

```bash
grep -rn "primary-\|bg-\[#111827\]\|text-pink-500" src/renderer/ | head -20
```

Note: these will be fixed in later phases. The grep documents the scope.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.js
git commit -m "feat(ui): map design tokens into Tailwind theme

- replace primary/accent palette with neutral + status colors
- expose --r-* radii and --font-* families to utility classes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Strip `bg-[#111827]` from `App.tsx`

**Files:**

- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Replace inline bg color**

```tsx
import { useState } from 'react'
import { ChatPage } from './pages/Chat'
import { SettingsPage } from './pages/Settings'

export function App() {
  const [page, setPage] = useState<'chat' | 'settings'>('chat')

  return (
    <div className="flex flex-col h-screen bg-canvas">
      <main className="flex-1 overflow-hidden">
        {page === 'chat' && <ChatPage onOpenSettings={() => setPage('settings')} />}
        {page === 'settings' && <SettingsPage onBack={() => setPage('chat')} />}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Run dev mode**

```bash
npm run dev
```

Expected: app loads. Background no longer dark navy at extreme edges.

- [ ] **Step 3: Stop dev mode**

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ui): drop hardcoded dark bg from App root

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 · Block schema — add Proposal block

Extend `src/shared/talor-blocks/talor-block-schema.ts` with `ProposalBlock`. Keep existing 4 blocks intact (done / need_input / blocked / warning).

### Task 2.1: Write failing test for ProposalBlock parsing

**Files:**

- Modify: `src/shared/talor-blocks/talor-block-parser.test.ts`

- [ ] **Step 1: Read current parser test file**

```bash
wc -l src/shared/talor-blocks/talor-block-parser.test.ts
```

Note structure (we'll add to existing `describe('parseTalorBlock', ...)`).

- [ ] **Step 2: Append new test**

Add at end of file (inside outer `describe` block — adapt to existing style):

```ts
describe('proposal block', () => {
  it('parses a minimal proposal', () => {
    const raw = `\`\`\`talor
{
  "type": "proposal",
  "summary": "Send email to wang@acme.com",
  "action": {
    "label": "Send",
    "tool": "gmail.send_draft",
    "args": { "draft_id": "abc123" }
  }
}
\`\`\``
    const r = parseTalorBlock(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.block.type).toBe('proposal')
      // @ts-expect-error narrowing
      expect(r.block.summary).toBe('Send email to wang@acme.com')
      // @ts-expect-error narrowing
      expect(r.block.action.tool).toBe('gmail.send_draft')
    }
  })

  it('parses a proposal with preview and secondary_actions', () => {
    const raw = `\`\`\`talor
{
  "type": "proposal",
  "summary": "Draft reply ready",
  "preview": "Hi Wang,\\n\\nThanks for your...",
  "action": { "label": "Send", "tool": "gmail.send_draft", "args": {} },
  "secondary_actions": [
    { "label": "Edit", "emit": "I want to revise" },
    { "label": "Rewrite", "emit": "Use a different tone" }
  ]
}
\`\`\``
    const r = parseTalorBlock(raw)
    expect(r.ok).toBe(true)
    if (r.ok && r.block.type === 'proposal') {
      expect(r.block.preview).toMatch(/^Hi Wang/)
      expect(r.block.secondary_actions).toHaveLength(2)
    }
  })

  it('rejects proposal without action', () => {
    const raw = `\`\`\`talor
{ "type": "proposal", "summary": "missing action" }
\`\`\``
    const r = parseTalorBlock(raw)
    expect(r.ok).toBe(false)
  })

  it('rejects proposal with empty tool name', () => {
    const raw = `\`\`\`talor
{ "type": "proposal", "summary": "s", "action": { "label": "Go", "tool": "", "args": {} } }
\`\`\``
    const r = parseTalorBlock(raw)
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 3: Run test — expect failures**

```bash
npx vitest run src/shared/talor-blocks/talor-block-parser.test.ts 2>&1 | tail -20
```

Expected: 4 failures (proposal type not in schema yet).

### Task 2.2: Add ProposalBlock schema

**Files:**

- Modify: `src/shared/talor-blocks/talor-block-schema.ts`

- [ ] **Step 1: Add interface and zod schema**

Locate the section after `WarningBlock` and before `PlanBlock`. Insert:

```ts
/**
 * 用户可一键确认的动作提议 — 任意 tool + args + label。
 *
 * 用法: 任何"提议执行一个动作并由用户确认"的场景统一使用，
 * 取代原 v1 draft_detected (只能用于 agent profile 保存)。
 *
 * 设计原则: UI 不感知 tool 业务概念，仅渲染 summary + preview + CTA。
 * 用户点 CTA 时 Talor 用 toolRegistry.invoke(action.tool, action.args)
 * 走标准 tool 调用链路（含权限校验）。
 */
export interface ProposalBlock {
  type: 'proposal'
  /** 必填: 一行摘要 — 描述将要发生什么 */
  summary: string
  /** 选填: markdown preview，给用户看完整内容 */
  preview?: string
  /** 必填: 主动作 */
  action: {
    /** 按钮文字 */
    label: string
    /** 必须是 registry 注册的 tool name */
    tool: string
    /** 工具参数，由对应 tool 的 schema 校验 */
    args: Record<string, unknown>
  }
  /** 选填: 二级动作 — 不触发 tool，将 emit 字符串塞回 LLM 上下文 */
  secondary_actions?: Array<{
    label: string
    emit: string
  }>
}
```

- [ ] **Step 2: Update `TalorBlock` union type**

Find:

```ts
export type TalorBlock = DoneBlock | NeedInputBlock | BlockedBlock | WarningBlock
```

Change to:

```ts
export type TalorBlock = DoneBlock | NeedInputBlock | BlockedBlock | WarningBlock | ProposalBlock
```

- [ ] **Step 3: Update parser's discriminator**

```bash
grep -n "case 'done'\|case 'need_input'\|case 'blocked'\|case 'warning'" src/shared/talor-blocks/talor-block-parser.ts
```

Open the parser, add `case 'proposal'` to the switch, calling a new `validateProposal(...)` helper following the same pattern as `validateNeedInput`. Validate:

- `summary`: non-empty string
- `action.label`: non-empty string
- `action.tool`: non-empty string
- `action.args`: object
- `preview`: optional string
- `secondary_actions[]`: optional array of `{label, emit}`

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/shared/talor-blocks/ 2>&1 | tail -20
```

Expected: all proposal tests + all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/shared/talor-blocks/talor-block-schema.ts src/shared/talor-blocks/talor-block-parser.ts src/shared/talor-blocks/talor-block-parser.test.ts
git commit -m "feat(blocks): add ProposalBlock type for user-confirmable actions

Generalizes the old draft_detected concept — any tool + args + label triggers
a render-confirm-invoke flow. UI is MCP-agnostic; LLM picks the tool.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Verify whole-suite test still green

- [ ] **Step 1: Full test run**

```bash
npm test 2>&1 | tail -20
```

Expected: failures count not larger than Phase 0 baseline.

---

## Phase 3 · System prompt UiBlockPlugin

Inject the 5-block protocol into system prompt so LLM knows when/how to emit each block.

### Task 3.1: Read existing PromptPipeline to confirm plugin signature

**Files:**

- Read: `src/main/prompt/plugins/SystemPlugin.ts` (template)
- Read: `src/main/prompt/PromptPipeline.ts` (registration)

- [ ] **Step 1: List existing plugin pattern**

```bash
sed -n '1,40p' src/main/prompt/plugins/SystemPlugin.ts
```

Note the interface (`PromptPlugin` shape, `apply` method signature).

- [ ] **Step 2: Find plugin registration point**

```bash
grep -n "Plugin\(\)\|registerPlugin\|plugins:" src/main/prompt/PromptPipeline.ts | head -10
```

Note where plugins are constructed.

### Task 3.2: Write failing test for UiBlockPlugin

**Files:**

- Create: `src/main/prompt/plugins/UiBlockPlugin.test.ts`

- [ ] **Step 1: Write test**

````ts
// src/main/prompt/plugins/UiBlockPlugin.test.ts
import { describe, it, expect } from 'vitest'
import { UiBlockPlugin } from './UiBlockPlugin'

describe('UiBlockPlugin', () => {
  it('appends block protocol section to system prompt', async () => {
    const plugin = new UiBlockPlugin()
    const ctx: any = { systemPrompt: 'You are a helpful agent.' }
    await plugin.apply(ctx)
    expect(ctx.systemPrompt).toContain('You are a helpful agent.')
    expect(ctx.systemPrompt).toContain('```talor')
    expect(ctx.systemPrompt).toContain('"type": "need_input"')
    expect(ctx.systemPrompt).toContain('"type": "proposal"')
    expect(ctx.systemPrompt).toContain('"type": "done"')
  })

  it('only injects once when called twice', async () => {
    const plugin = new UiBlockPlugin()
    const ctx: any = { systemPrompt: 'X' }
    await plugin.apply(ctx)
    await plugin.apply(ctx)
    const proposalCount = (ctx.systemPrompt.match(/"type": "proposal"/g) || []).length
    expect(proposalCount).toBe(1)
  })
})
````

- [ ] **Step 2: Run — expect FAIL (file not exist)**

```bash
npx vitest run src/main/prompt/plugins/UiBlockPlugin.test.ts 2>&1 | tail -10
```

### Task 3.3: Implement UiBlockPlugin

**Files:**

- Create: `src/main/prompt/plugins/UiBlockPlugin.ts`

- [ ] **Step 1: Create plugin**

```ts
// src/main/prompt/plugins/UiBlockPlugin.ts
//
// 业务层: 在 system prompt 末尾注入 Talor Block 协议说明，让 LLM 知道何时
// 用什么 block + 如何填字段。
//
// 允许依赖: shared/talor-blocks
// 禁止依赖: ipc/* / renderer/*

import type { PromptPlugin, PromptContext } from '../PromptPlugin'

const BLOCK_PROTOCOL_MARKER = '\n\n<!-- talor:ui-blocks -->'

const BLOCK_PROTOCOL_SECTION = `

## UI blocks

You can emit structured UI blocks in your response when interaction or terminal
state is needed. Markdown is the default — use blocks sparingly.

Each block is a fenced code block with language \`talor\`:

\`\`\`talor
{"type": "<block-type>", ...}
\`\`\`

### need_input — ask user to pick from 2-5 options

Use when you need a discrete choice. Don't use for confirmations (use \`proposal\`).

\`\`\`talor
{
  "type": "need_input",
  "question": "Which time slot works?",
  "choices": ["Mon 10:30", "Tue 15:00", "Let me check others"],
  "reason": "Each slot has different conflicts."
}
\`\`\`

### proposal — propose a one-click action the user confirms

Use when you've prepared something the user should review and execute with one
click (send email, save config, create event, ...). The \`action.tool\` must be
a real tool name available to you; \`action.args\` must satisfy that tool's schema.

\`\`\`talor
{
  "type": "proposal",
  "summary": "Email draft to wang@acme.com - Re: Q4 renewal",
  "preview": "Hi Wang,\\n\\nRe: your two questions...",
  "action": {
    "label": "Send",
    "tool": "gmail.send_draft",
    "args": {"draft_id": "abc-123"}
  },
  "secondary_actions": [
    { "label": "Edit", "emit": "I want to revise it" },
    { "label": "Rewrite", "emit": "Use a different tone" }
  ]
}
\`\`\`

### done — signal end of turn with summary

\`\`\`talor
{"type": "done", "summary": "Verified all 24 tests pass."}
\`\`\`

### blocked — task cannot continue without external change

\`\`\`talor
{
  "type": "blocked",
  "reason": "Need read permission on ~/.ssh/config.",
  "retry_hint": "Add ~/.ssh/config to allowlist in Settings → Permissions, then say 'retry'."
}
\`\`\`

### warning — alert user mid-flow (non-blocking)

\`\`\`talor
{"type": "warning", "message": "Detected rm -rf, intercepted.", "severity": "high"}
\`\`\`
`

export class UiBlockPlugin implements PromptPlugin {
  readonly name = 'UiBlockPlugin'

  async apply(ctx: PromptContext): Promise<void> {
    if (ctx.systemPrompt.includes(BLOCK_PROTOCOL_MARKER)) return
    ctx.systemPrompt = ctx.systemPrompt + BLOCK_PROTOCOL_MARKER + BLOCK_PROTOCOL_SECTION
  }
}
```

- [ ] **Step 2: Run test — expect pass**

```bash
npx vitest run src/main/prompt/plugins/UiBlockPlugin.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Commit (don't wire into pipeline yet — separate task)**

```bash
git add src/main/prompt/plugins/UiBlockPlugin.ts src/main/prompt/plugins/UiBlockPlugin.test.ts
git commit -m "feat(prompt): UiBlockPlugin injects block protocol into system prompt

Teaches LLM the 5-block vocabulary (need_input / proposal / done / blocked /
warning) with one example each. Plugin is idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: Wire plugin into PromptPipeline

**Files:**

- Modify: `src/main/prompt/PromptPipeline.ts`

- [ ] **Step 1: Read pipeline constructor**

```bash
grep -n "Plugin\|plugins" src/main/prompt/PromptPipeline.ts | head -20
```

- [ ] **Step 2: Import UiBlockPlugin + register after AgentPromptPlugin**

The exact edit depends on pipeline structure. Add:

```ts
import { UiBlockPlugin } from './plugins/UiBlockPlugin'
```

And in the plugin list array, append `new UiBlockPlugin()` **after** `AgentPromptPlugin` but **before** any plugin that summarizes / truncates the prompt.

- [ ] **Step 3: Run pipeline tests**

```bash
npx vitest run src/main/prompt/ 2>&1 | tail -20
```

Expected: existing tests still pass; block protocol now in built prompts.

- [ ] **Step 4: Commit**

```bash
git add src/main/prompt/PromptPipeline.ts
git commit -m "feat(prompt): wire UiBlockPlugin into PromptPipeline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 · Extract Chat sub-components (structural only)

Split 1969-line `Chat/index.tsx` into 4 sub-files. **No visual change** — just file structure.

### Task 4.1: Create Sidebar component (structural extract)

**Files:**

- Create: `src/renderer/pages/Chat/Sidebar.tsx`
- Modify: `src/renderer/pages/Chat/index.tsx`

- [ ] **Step 1: Read current sidebar JSX**

```bash
sed -n '658,825p' src/renderer/pages/Chat/index.tsx
```

This is the sidebar block (drag region + new session button + session list + settings footer).

- [ ] **Step 2: Create new file with props interface**

```tsx
// src/renderer/pages/Chat/Sidebar.tsx
//
// 渲染层: workspace sidebar (会话列表 + 顶部 search/+ + 底部设置)
//
// 允许依赖: components/* / hooks/* / store/*
// 禁止依赖: ipc/* / main/*

import { SessionItem, agentColor, getDateGroup } from '../../components/SessionItem'
import type { ChatSession } from '../../types/chat'
import type { AgentProfile } from '@shared/types/agent'

export interface SidebarProps {
  sessions: ChatSession[]
  agents: AgentProfile[]
  currentSessionId: string | null
  renamingSessionId: string | null
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onDeleteSession: (id: string) => void
  onStartRename: (id: string) => void
  onCommitRename: (id: string, title: string) => void
  onCancelRename: () => void
  onOpenSettings: () => void
}

export function Sidebar(props: SidebarProps) {
  // Move the entire JSX from Chat/index.tsx lines 658-825 here.
  // Use props instead of local variables.
  // Container: <aside class="sb"> with flex column
  // ⚠️ Use the visual style from .superpowers/brainstorm/.../final-v2.html (will be
  //   restyled in Phase 8). For now keep current dark-bg classes — Phase 8 swaps them.
  return null // placeholder to be replaced
}
```

- [ ] **Step 3: Cut-and-paste sidebar JSX from Chat/index.tsx into Sidebar.tsx**

Replace the `return null` with the JSX from `Chat/index.tsx` lines ~658-825, replacing local refs with `props.X`. Pre-compute `agentMap` inside Sidebar (it's local to sidebar rendering).

- [ ] **Step 4: Replace sidebar block in Chat/index.tsx with `<Sidebar ...props/>`**

In `Chat/index.tsx`, replace the sidebar JSX (between `{/* DARK SIDEBAR */}` comment and end of that `</div>`) with:

```tsx
<Sidebar
  sessions={sessions}
  agents={agents}
  currentSessionId={currentSessionId}
  renamingSessionId={renamingSessionId}
  onSelectSession={setCurrentSession}
  onCreateSession={handleCreateSession}
  onDeleteSession={(id) => setSessionToDelete(id)}
  onStartRename={(id) => setRenamingSessionId(id)}
  onCommitRename={handleRenameSession}
  onCancelRename={() => setRenamingSessionId(null)}
  onOpenSettings={onOpenSettings}
/>
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck 2>&1 | tail -10
```

Expected: 0 new errors.

- [ ] **Step 6: Smoke test in dev**

```bash
npm run dev
```

Expected: sidebar still renders identically. Sessions still clickable.

- [ ] **Step 7: Stop dev. Commit.**

```bash
git add src/renderer/pages/Chat/Sidebar.tsx src/renderer/pages/Chat/index.tsx
git commit -m "refactor(chat): extract Sidebar component from Chat/index.tsx

No visual change. Splits the 168-line sidebar block into its own file
to enable focused redesign in Phase 8. patterns.md §P5 small-files principle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Create TopBar component (extract)

**Files:**

- Create: `src/renderer/pages/Chat/TopBar.tsx`
- Modify: `src/renderer/pages/Chat/index.tsx`

- [ ] **Step 1: Identify topbar JSX**

```bash
sed -n '833,1180p' src/renderer/pages/Chat/index.tsx | head -50
```

Note: topbar spans agent picker + model picker + popovers + (later) export agent.

- [ ] **Step 2: Create TopBar.tsx**

Move the topbar JSX (currently inside the `{currentSessionId ? <>` branch) into a new component with props. Include:

- `currentAgent` / `agents` / `onSelectAgent`
- `currentModel` / `models` / `onSelectModel`
- Popover open states (or hoist to local state inside TopBar)

⚠️ The agent + model picker logic uses click-outside listeners + portals. Move those too. Keep behavior identical.

- [ ] **Step 3: Replace topbar JSX in Chat/index.tsx with `<TopBar .../>`**

- [ ] **Step 4: Typecheck + smoke test**

```bash
npm run typecheck && npm run dev
```

Stop dev when verified.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Chat/TopBar.tsx src/renderer/pages/Chat/index.tsx
git commit -m "refactor(chat): extract TopBar component (agent + model pickers)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: Create MessageStream component (extract)

**Files:**

- Create: `src/renderer/pages/Chat/MessageStream.tsx`
- Modify: `src/renderer/pages/Chat/index.tsx`

- [ ] **Step 1: Identify message list JSX**

`Chat/index.tsx` ~1186-1322: the `<div ref={messagesContainerRef} ...>` block with rendered messages + streaming + crystallize panel + error banner.

- [ ] **Step 2: Move into MessageStream.tsx** with props:
- `messages`, `streamState`, `error`, `renderedMessages`
- `messagesContainerRef`, `messagesEndRef`, `userScrolledUpRef`
- `ws` (workbench state for crystallize panel)
- `onReviewDraft`, `setPreviewAgentId`, `startAgentSession`, `setSeparatorCollapsed`

- [ ] **Step 3: Replace in Chat/index.tsx**

- [ ] **Step 4: Typecheck + smoke**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Chat/MessageStream.tsx src/renderer/pages/Chat/index.tsx
git commit -m "refactor(chat): extract MessageStream component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.4: Create InputArea component (extract)

**Files:**

- Create: `src/renderer/pages/Chat/InputArea.tsx`
- Modify: `src/renderer/pages/Chat/index.tsx`

- [ ] **Step 1: Identify input area JSX**

`Chat/index.tsx` ~1325 to end of input block: attachments + workspace + permissions + textarea + toolbar.

- [ ] **Step 2: Move into InputArea.tsx** with props:
- `input`, `setInput`, `streamState`
- `currentWorkspace`, `setCurrentWorkspace`, `currentSessionId`
- `attachments`, `addAttachment`, `removeAttachment`
- `onSubmit`, `currentAgentName`
- `ws` (crystallize hints)

- [ ] **Step 3: Replace in Chat/index.tsx**

- [ ] **Step 4: Typecheck + smoke**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/pages/Chat/InputArea.tsx src/renderer/pages/Chat/index.tsx
git commit -m "refactor(chat): extract InputArea component

Chat/index.tsx now under 800 lines, just state hookup + composition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 · Build new visual primitives (no layout swap yet)

Create the new components but **don't replace old ones** — wire-up happens in later phases.

### Task 5.1: Create Prose component (markdown rendering)

**Files:**

- Create: `src/renderer/components/markdown/Prose.tsx`
- Create: `src/renderer/components/markdown/CodeBlock.tsx`
- Create: `src/renderer/components/markdown/Prose.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// Prose.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Prose } from './Prose'

describe('Prose', () => {
  it('renders inline code without pink class', () => {
    render(<Prose source="some `code` here" />)
    const code = screen.getByText('code')
    expect(code.tagName).toBe('CODE')
    expect(code.className).not.toMatch(/pink/)
  })

  it('renders headings h1-h4', () => {
    render(<Prose source="# H1\n## H2\n### H3\n#### H4" />)
    expect(screen.getByText('H1').tagName).toBe('H1')
    expect(screen.getByText('H2').tagName).toBe('H2')
  })

  it('renders task list items', () => {
    render(<Prose source="- [x] done\n- [ ] todo" />)
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('todo')).toBeInTheDocument()
  })

  it('renders tables with header / body', () => {
    render(<Prose source="| A | B |\n|---|---|\n| 1 | 2 |" />)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('A').tagName).toBe('TH')
  })
})
```

- [ ] **Step 2: Implement Prose.tsx**

```tsx
// src/renderer/components/markdown/Prose.tsx
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

const components: Components = {
  code: CodeBlock as Components['code'],
  pre: ({ children }) => <>{children}</>,
}

export function Prose({ source }: { source: string }) {
  return (
    <div className="prose-talor">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 3: Implement CodeBlock.tsx (light theme, no pink inline)**

```tsx
// src/renderer/components/markdown/CodeBlock.tsx
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

interface CodeBlockProps {
  inline?: boolean
  className?: string
  children?: React.ReactNode
}

export function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const match = /language-(\w+)/.exec(className || '')
  const code = String(children ?? '').replace(/\n$/, '')

  if (inline || !match) {
    return <code className="inline-code">{children}</code>
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="lang">{match[1]}</span>
        <CopyButton text={code} />
      </div>
      <SyntaxHighlighter
        style={oneLight}
        language={match[1] || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, padding: '12px 14px', background: 'transparent' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="code-copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}
```

- [ ] **Step 4: Add `.prose-talor` styles to index.css**

Append to `src/renderer/index.css`:

```css
/* Prose */
.prose-talor {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}
.prose-talor p {
  margin: 0 0 10px;
}
.prose-talor p:last-child {
  margin-bottom: 0;
}
.prose-talor h1 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  margin: 24px 0 8px;
}
.prose-talor h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 22px 0 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.prose-talor h3 {
  font-size: 15.5px;
  font-weight: 600;
  margin: 18px 0 4px;
}
.prose-talor h4 {
  font-size: 13.5px;
  font-weight: 600;
  margin: 14px 0 4px;
  color: var(--body);
}
.prose-talor ul,
.prose-talor ol {
  margin: 4px 0 10px;
  padding-left: 22px;
}
.prose-talor ul {
  list-style: none;
}
.prose-talor ul > li {
  position: relative;
}
.prose-talor ul > li::before {
  content: '';
  position: absolute;
  left: -14px;
  top: 11px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--mute);
}
.prose-talor blockquote {
  border-left: 2px solid var(--line);
  padding: 4px 0 4px 14px;
  margin: 12px 0;
  color: var(--body);
}
.prose-talor hr {
  border: none;
  border-top: 1px solid var(--line);
  margin: 20px 0;
}
.prose-talor a {
  color: var(--info);
  text-decoration: none;
  border-bottom: 1px solid rgba(37, 99, 235, 0.3);
}
.prose-talor a:hover {
  border-bottom-color: currentColor;
}
.prose-talor strong {
  font-weight: 600;
}
.prose-talor table {
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}
.prose-talor th {
  text-align: left;
  padding: 8px 14px 8px 0;
  font-weight: 600;
  color: var(--mute);
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--line);
}
.prose-talor td {
  padding: 8px 14px 8px 0;
  border-bottom: 1px solid var(--line-2);
  color: var(--text);
  vertical-align: top;
}
.prose-talor tr:last-child td {
  border-bottom: none;
}
.inline-code {
  background: var(--line-2);
  padding: 1.5px 5px;
  border-radius: var(--r-sm);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
}

/* Code block */
.code-block {
  margin: 12px 0;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: #fcfcfc;
  overflow: hidden;
}
.code-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line-2);
  font-size: 11px;
  color: var(--mute);
  font-family: var(--font-mono);
}
.code-head .lang {
  text-transform: lowercase;
}
.code-copy {
  font-size: 10px;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 3px;
  background: none;
  border: none;
  color: var(--mute);
}
.code-copy:hover {
  background: var(--line-2);
  color: var(--text);
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npx vitest run src/renderer/components/markdown/ 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/markdown/ src/renderer/index.css
git commit -m "feat(ui): Prose + CodeBlock components with new tokens

- Light theme code blocks (no more dark island)
- Inline code uses zinc-100 bg (no more pink-on-gray)
- Bullets are 4px gray dots
- Tables uppercase mute headers + tabular-nums

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: Create ToolRow + spinner/check icons

**Files:**

- Create: `src/renderer/components/tool-calls/ToolRow.tsx`
- Create: `src/renderer/components/tool-calls/ToolRow.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// ToolRow.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolRow } from './ToolRow'

describe('ToolRow', () => {
  it('renders running state with spinner', () => {
    const { container } = render(<ToolRow status="running" name="bash" target="npm test" />)
    expect(container.querySelector('.spinner')).toBeInTheDocument()
  })

  it('renders done state with check icon', () => {
    render(<ToolRow status="done" name="grep" target='"foo"' durationMs={12} />)
    expect(screen.getByText('grep')).toBeInTheDocument()
    expect(screen.getByText('"foo"')).toBeInTheDocument()
    expect(screen.getByText('12ms')).toBeInTheDocument()
  })

  it('renders error state with red color class', () => {
    const { container } = render(<ToolRow status="error" name="edit" target="failed" />)
    expect(container.querySelector('.stat-err')).toBeInTheDocument()
  })

  it('formats long duration as seconds', () => {
    render(<ToolRow status="done" name="bash" target="run" durationMs={2400} />)
    expect(screen.getByText('2.4s')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement ToolRow**

```tsx
// src/renderer/components/tool-calls/ToolRow.tsx
import { useState, type ReactNode } from 'react'

export type ToolStatus = 'running' | 'done' | 'error' | 'denied'

interface ToolRowProps {
  status: ToolStatus
  name: string
  target: string
  durationMs?: number
  expandable?: boolean
  children?: ReactNode // expanded body
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function ToolRow({ status, name, target, durationMs, expandable, children }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const dur = formatDuration(durationMs)
  return (
    <>
      <button
        type="button"
        className="tool-row"
        onClick={() => expandable && setExpanded((v) => !v)}
        disabled={!expandable}
      >
        <span className={`tool-stat stat-${status}`}>
          {status === 'running' && <span className="spinner" />}
          {status === 'done' && <CheckIcon />}
          {status === 'error' && <CrossIcon />}
          {status === 'denied' && <span>—</span>}
        </span>
        <span className="tool-name">{name}</span>
        <span className="tool-target">{target}</span>
        {dur && <span className="tool-dur">{dur}</span>}
        {expandable && <span className="tool-chev">{expanded ? '▾' : '▸'}</span>}
      </button>
      {expanded && children && <div className="tool-body">{children}</div>}
    </>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function CrossIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
```

- [ ] **Step 3: Append CSS to index.css**

```css
/* Tool row */
.tool-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 8px;
  margin: 4px -8px;
  border-radius: var(--r-md);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--body);
  background: none;
  border: none;
  width: calc(100% + 16px);
  cursor: default;
  text-align: left;
}
.tool-row[disabled] {
  cursor: default;
}
.tool-row:not([disabled]):hover {
  background: var(--surface);
  cursor: pointer;
}
.tool-stat {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.tool-stat svg {
  width: 12px;
  height: 12px;
}
.stat-done {
  color: var(--ok);
}
.stat-error {
  color: var(--err);
}
.stat-running {
  color: var(--info);
}
.stat-denied {
  color: var(--mute);
}
.tool-name {
  color: var(--text);
  font-weight: 500;
  min-width: 38px;
}
.tool-target {
  color: var(--mute);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-dur {
  color: var(--subtle);
  font-size: 11px;
}
.tool-chev {
  color: var(--subtle);
  font-size: 10px;
}
.tool-body {
  margin: 2px 0 8px 4px;
  padding: 10px 12px;
  border-left: 2px solid var(--line);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
}
.spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--line);
  border-top-color: var(--info);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
```

- [ ] **Step 4: Run tests, commit**

```bash
npx vitest run src/renderer/components/tool-calls/ 2>&1 | tail -10
git add src/renderer/components/tool-calls/ src/renderer/index.css
git commit -m "feat(ui): ToolRow component with 4 states + expand affordance

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.3: Create block components (DonePill, NeedInput, BlockedRow, WarningRow, Proposal)

**Files:**

- Create: `src/renderer/components/talor-blocks/DonePill.tsx`
- Create: `src/renderer/components/talor-blocks/NeedInput.tsx`
- Create: `src/renderer/components/talor-blocks/BlockedRow.tsx`
- Create: `src/renderer/components/talor-blocks/WarningRow.tsx`
- Create: `src/renderer/components/talor-blocks/Proposal.tsx`
- Create: `src/renderer/components/talor-blocks/index.ts`
- Create: `src/renderer/components/talor-blocks/Proposal.test.tsx`

- [ ] **Step 1: Write failing test for Proposal**

```tsx
// Proposal.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Proposal } from './Proposal'

describe('Proposal block', () => {
  it('renders summary + CTA, no "proposal" label text', () => {
    render(
      <Proposal
        summary="Send email"
        preview="Hi there..."
        action={{ label: 'Send', tool: 'gmail.send', args: {} }}
        onConfirm={vi.fn()}
        onEmit={vi.fn()}
      />,
    )
    expect(screen.getByText('Send email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByText(/proposal/i)).not.toBeInTheDocument()
  })

  it('invokes onConfirm with tool + args when CTA clicked', () => {
    const onConfirm = vi.fn()
    render(
      <Proposal
        summary="X"
        action={{ label: 'Go', tool: 'gmail.send', args: { id: 'abc' } }}
        onConfirm={onConfirm}
        onEmit={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onConfirm).toHaveBeenCalledWith('gmail.send', { id: 'abc' })
  })

  it('renders secondary actions and routes them through onEmit', () => {
    const onEmit = vi.fn()
    render(
      <Proposal
        summary="X"
        action={{ label: 'Go', tool: 't', args: {} }}
        secondary_actions={[{ label: 'Edit', emit: 'I want to edit' }]}
        onConfirm={vi.fn()}
        onEmit={onEmit}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEmit).toHaveBeenCalledWith('I want to edit')
  })
})
```

- [ ] **Step 2: Implement Proposal.tsx**

```tsx
// src/renderer/components/talor-blocks/Proposal.tsx
import { Prose } from '../markdown/Prose'

interface ProposalProps {
  summary: string
  preview?: string
  action: { label: string; tool: string; args: Record<string, unknown> }
  secondary_actions?: Array<{ label: string; emit: string }>
  onConfirm: (tool: string, args: Record<string, unknown>) => void
  onEmit: (text: string) => void
}

export function Proposal({
  summary,
  preview,
  action,
  secondary_actions,
  onConfirm,
  onEmit,
}: ProposalProps) {
  return (
    <div className="prop">
      <div className="prop-summary">{summary}</div>
      {preview && (
        <div className="prop-preview">
          <Prose source={preview} />
        </div>
      )}
      <div className="prop-actions">
        <button className="prop-cta" onClick={() => onConfirm(action.tool, action.args)}>
          {action.label}
        </button>
        {secondary_actions?.map((s, i) => (
          <button key={i} className="prop-secondary" onClick={() => onEmit(s.emit)}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Implement DonePill.tsx**

```tsx
// src/renderer/components/talor-blocks/DonePill.tsx
interface DonePillProps {
  summary: string
  metrics?: { tools?: number; duration_ms?: number; files_modified?: number }
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function DonePill({ summary, metrics }: DonePillProps) {
  const parts: string[] = []
  if (metrics?.tools != null) parts.push(`${metrics.tools} tool${metrics.tools === 1 ? '' : 's'}`)
  if (metrics?.duration_ms != null) parts.push(fmt(metrics.duration_ms))
  if (metrics?.files_modified != null)
    parts.push(`${metrics.files_modified} file${metrics.files_modified === 1 ? '' : 's'}`)

  return (
    <span className="done-pill">
      <span className="done-dot" />
      {parts.length > 0 ? parts.join(' · ') : summary}
    </span>
  )
}
```

- [ ] **Step 4: Implement NeedInput.tsx**

```tsx
// src/renderer/components/talor-blocks/NeedInput.tsx
interface NeedInputProps {
  question: string
  choices?: string[]
  reason?: string
  onPick: (choice: string) => void
}

export function NeedInput({ question, choices, reason, onPick }: NeedInputProps) {
  return (
    <div className="ni">
      <div className="ni-q">{question}</div>
      {choices && choices.length > 0 && (
        <div className="ni-opts">
          {choices.map((c) => (
            <button key={c} className="ni-opt" onClick={() => onPick(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {reason && <div className="ni-reason">{reason}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Implement BlockedRow.tsx**

```tsx
// src/renderer/components/talor-blocks/BlockedRow.tsx
interface BlockedRowProps {
  reason: string
  retry_hint?: string
  onRetry?: () => void
}

export function BlockedRow({ reason, retry_hint, onRetry }: BlockedRowProps) {
  return (
    <div className="blocked-row">
      <span className="blocked-dot" />
      <div className="blocked-body">
        <div>{reason}</div>
        {retry_hint && (
          <div className="blocked-hint">
            {retry_hint}{' '}
            {onRetry && (
              <span className="blocked-retry" onClick={onRetry}>
                retry ↻
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Implement WarningRow.tsx**

```tsx
// src/renderer/components/talor-blocks/WarningRow.tsx
interface WarningRowProps {
  message: string
  severity?: 'low' | 'medium' | 'high'
}

export function WarningRow({ message, severity = 'medium' }: WarningRowProps) {
  return (
    <div className={`warn-row warn-${severity}`}>
      <span className="warn-dot" />
      <span className="warn-body">{message}</span>
    </div>
  )
}
```

- [ ] **Step 7: Index file + CSS**

`src/renderer/components/talor-blocks/index.ts`:

```ts
export { DonePill } from './DonePill'
export { NeedInput } from './NeedInput'
export { BlockedRow } from './BlockedRow'
export { WarningRow } from './WarningRow'
export { Proposal } from './Proposal'
```

Append CSS to `index.css`:

```css
/* Done pill (no label text) */
.done-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--mute);
  margin-top: 8px;
}
.done-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--ok);
}

/* need_input */
.ni {
  padding: 4px 0 4px 14px;
  border-left: 2px solid var(--info);
  margin: 8px 0;
}
.ni-q {
  font-size: 14px;
  color: var(--text);
  margin-bottom: 8px;
  line-height: 1.5;
}
.ni-opts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ni-opt {
  padding: 3px 10px;
  border: 1px solid var(--line);
  background: var(--canvas);
  border-radius: var(--r-md);
  font-size: 12.5px;
  color: var(--text);
  cursor: pointer;
  font-family: inherit;
}
.ni-opt:hover {
  background: var(--surface);
  border-color: var(--subtle);
}
.ni-reason {
  font-size: 12px;
  color: var(--mute);
  margin-top: 8px;
}

/* blocked */
.blocked-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  padding: 2px 0;
  margin: 6px 0;
}
.blocked-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
  margin-top: 7px;
  flex-shrink: 0;
}
.blocked-body {
  flex: 1;
  color: var(--text);
}
.blocked-hint {
  font-size: 12px;
  color: var(--mute);
  margin-top: 2px;
}
.blocked-retry {
  color: var(--info);
  cursor: pointer;
  border-bottom: 1px solid rgba(37, 99, 235, 0.3);
}

/* warning */
.warn-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  padding: 2px 0;
  margin: 6px 0;
}
.warn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 7px;
  flex-shrink: 0;
}
.warn-row.warn-low .warn-dot {
  background: var(--info);
}
.warn-row.warn-medium .warn-dot {
  background: var(--warn);
}
.warn-row.warn-high .warn-dot {
  background: var(--err);
}
.warn-row.warn-high .warn-body {
  color: var(--err);
  font-weight: 500;
}
.warn-body {
  flex: 1;
  color: var(--body);
}

/* proposal */
.prop {
  padding: 6px 0 6px 14px;
  border-left: 2px solid var(--indigo);
  margin: 8px 0;
}
.prop-summary {
  font-size: 14px;
  color: var(--text);
  font-weight: 500;
  margin-bottom: 6px;
}
.prop-preview {
  margin: 6px 0;
  padding: 10px 12px;
  background: var(--surface);
  border-radius: 8px;
  max-height: 140px;
  overflow: hidden;
  position: relative;
}
.prop-preview::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 26px;
  background: linear-gradient(transparent, var(--surface));
  pointer-events: none;
}
.prop-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.prop-cta {
  background: var(--text);
  color: white;
  padding: 4px 12px;
  border: none;
  border-radius: var(--r-md);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.prop-cta:hover {
  background: #18181b;
}
.prop-secondary {
  background: var(--canvas);
  color: var(--body);
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  font-size: 12.5px;
  cursor: pointer;
}
.prop-secondary:hover {
  background: var(--surface);
  border-color: var(--subtle);
}
```

- [ ] **Step 8: Run tests, commit**

```bash
npx vitest run src/renderer/components/talor-blocks/ 2>&1 | tail -10
git add src/renderer/components/talor-blocks/ src/renderer/index.css
git commit -m "feat(ui): 5 Talor block components (no label text)

DonePill / NeedInput / BlockedRow / WarningRow / Proposal.
All blocks omit the block-type label text (per spec §11.2) —
visual semantics carried by left rails, dots, and body content.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.4: Create DiffView + BashOutput for built-in tools

**Files:**

- Create: `src/renderer/components/tool-calls/DiffView.tsx`
- Create: `src/renderer/components/tool-calls/BashOutput.tsx`
- Create: `src/renderer/components/tool-calls/GrepResults.tsx`

- [ ] **Step 1: Implement DiffView**

```tsx
// src/renderer/components/tool-calls/DiffView.tsx
interface DiffLine {
  kind: '+' | '-' | ' '
  ln?: number
  text: string
}
interface DiffViewProps {
  file: string
  added: number
  removed: number
  lines: DiffLine[]
}

export function DiffView({ file, added, removed, lines }: DiffViewProps) {
  return (
    <div className="diff">
      <div className="diff-head">
        <span>{file}</span>
        <span>
          +{added} / −{removed}
        </span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`diff-row ${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : ''}`}>
          <span className="diff-sign">{l.kind}</span>
          <span className="diff-ln">{l.ln ?? ''}</span>
          <span className="diff-text">{l.text}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Implement BashOutput**

```tsx
// src/renderer/components/tool-calls/BashOutput.tsx
interface BashOutputProps {
  stdout?: string
  stderr?: string
  summary?: string // 末尾 sans 色摘要 — e.g., "24/24 passed"
}

export function BashOutput({ stdout, stderr, summary }: BashOutputProps) {
  return (
    <div className="bash-out">
      {stdout && <pre className="bash-stdout">{stdout}</pre>}
      {stderr && <pre className="bash-stderr">{stderr}</pre>}
      {summary && <div className="bash-summary">{summary}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Implement GrepResults**

```tsx
// src/renderer/components/tool-calls/GrepResults.tsx
interface GrepHit {
  file: string
  matches: Array<{ ln: number; text: string; hit: string }>
}
interface GrepResultsProps {
  groups: GrepHit[]
}

export function GrepResults({ groups }: GrepResultsProps) {
  return (
    <div className="grep-out">
      {groups.map((g, i) => (
        <div key={i}>
          <div className="grep-file">{g.file}</div>
          {g.matches.map((m, j) => (
            <div key={j} className="grep-match">
              <span className="grep-ln">{m.ln}</span>
              <span className="grep-text">{highlight(m.text, m.hit)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function highlight(text: string, hit: string) {
  const i = text.indexOf(hit)
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <span className="grep-hit">{hit}</span>
      {text.slice(i + hit.length)}
    </>
  )
}
```

- [ ] **Step 4: Append CSS for diff / bash / grep**

```css
/* Diff */
.diff {
  margin: 10px 0;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: #fcfcfc;
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.diff-head {
  padding: 6px 12px;
  border-bottom: 1px solid var(--line-2);
  font-size: 11px;
  color: var(--mute);
  display: flex;
  justify-content: space-between;
}
.diff-row {
  display: flex;
  padding: 0 12px;
  min-height: 20px;
  align-items: center;
}
.diff-row.add {
  background: var(--add-bg);
}
.diff-row.del {
  background: var(--del-bg);
}
.diff-sign {
  color: var(--subtle);
  width: 14px;
  flex-shrink: 0;
}
.diff-row.add .diff-sign {
  color: var(--ok);
  font-weight: 700;
}
.diff-row.del .diff-sign {
  color: var(--err);
  font-weight: 700;
}
.diff-ln {
  color: var(--subtle);
  width: 30px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 12px;
  font-size: 11px;
}
.diff-text {
  white-space: pre;
}

/* Bash */
.bash-out {
  margin: 6px 0 8px 4px;
  padding: 10px 14px;
  border-left: 2px solid var(--line);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
}
.bash-stdout {
  color: var(--body);
  margin: 0;
  white-space: pre-wrap;
}
.bash-stderr {
  color: var(--err);
  margin: 0;
  white-space: pre-wrap;
}
.bash-summary {
  color: var(--subtle);
  font-size: 11px;
  margin-top: 4px;
  font-family: var(--font-ui);
}

/* Grep */
.grep-out {
  margin: 6px 0 8px 4px;
  padding-left: 12px;
  border-left: 2px solid var(--line);
  font-family: var(--font-mono);
  font-size: 12px;
}
.grep-file {
  color: var(--info);
  padding: 2px 0;
}
.grep-match {
  display: flex;
  gap: 12px;
  padding: 2px 0;
  color: var(--body);
}
.grep-ln {
  color: var(--subtle);
  min-width: 30px;
  text-align: right;
}
.grep-hit {
  background: #fef3c7;
  color: var(--text);
  padding: 0 2px;
  border-radius: 2px;
}
```

- [ ] **Step 5: Smoke check + commit**

```bash
npm run typecheck 2>&1 | tail -5
git add src/renderer/components/tool-calls/ src/renderer/index.css
git commit -m "feat(ui): built-in tool renderers (DiffView / BashOutput / GrepResults)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 · Redesign Sidebar (A2 style)

Apply the A2 style: light surface, search filled chip + black solid +, gradient agent avatars, settings as sibling-pinned-bottom.

### Task 6.1: Rewrite Sidebar.tsx with new visual

**Files:**

- Modify: `src/renderer/pages/Chat/Sidebar.tsx`
- Modify: `src/renderer/components/SessionItem.tsx`
- Append: `src/renderer/index.css`

- [ ] **Step 1: Read final-v2.html for canonical structure (reference)**

```bash
sed -n '40,260p' .superpowers/brainstorm/91391-1778854140/content/final-v2.html | head -180
```

Use the HTML structure as ground truth.

- [ ] **Step 2: Replace Sidebar.tsx**

```tsx
// src/renderer/pages/Chat/Sidebar.tsx
import { SessionItem, agentColor, getDateGroup } from '../../components/SessionItem'
import type { ChatSession } from '../../types/chat'
import type { AgentProfile } from '@shared/types/agent'

export interface SidebarProps {
  sessions: ChatSession[]
  agents: AgentProfile[]
  currentSessionId: string | null
  renamingSessionId: string | null
  onSelectSession: (id: string) => void
  onCreateSession: () => void
  onDeleteSession: (id: string) => void
  onStartRename: (id: string) => void
  onCommitRename: (id: string, title: string) => void
  onCancelRename: () => void
  onOpenSettings: () => void
}

export function Sidebar(props: SidebarProps) {
  const agentMap = new Map(props.agents.map((a) => [a.id, a]))
  const today: ChatSession[] = []
  const yesterday: ChatSession[] = []
  const earlier: ChatSession[] = []
  for (const s of props.sessions) {
    const g = getDateGroup(s.updated_at)
    if (g === 'today') today.push(s)
    else if (g === 'yesterday') yesterday.push(s)
    else earlier.push(s)
  }

  return (
    <aside className="sb">
      <div className="sb-drag" />

      <div className="sb-bar">
        <div className="sb-search" role="button" tabIndex={0}>
          <SearchIcon />
          <span>搜索</span>
        </div>
        <button className="sb-plus" title="新建会话 ⌘N" onClick={props.onCreateSession}>
          <PlusIcon />
        </button>
      </div>

      <div className="sb-list">
        {today.length > 0 && (
          <>
            <div className="sb-group">今天</div>
            {today.map((s) => renderSession(s))}
          </>
        )}
        {yesterday.length > 0 && (
          <>
            <div className="sb-group">昨天</div>
            {yesterday.map((s) => renderSession(s))}
          </>
        )}
        {earlier.length > 0 && (
          <>
            <div className="sb-group">更早</div>
            {earlier.map((s) => renderSession(s))}
          </>
        )}
      </div>

      {/* Settings: sibling of sb-list, NOT inside it */}
      <button className="sb-settings" onClick={props.onOpenSettings}>
        <GearIcon />
        <span>设置</span>
        <span className="sb-kbd">⌘,</span>
      </button>
    </aside>
  )

  function renderSession(s: ChatSession) {
    return (
      <SessionItem
        key={s.id}
        session={s}
        isActive={s.id === props.currentSessionId}
        agentName={s.agent_id ? agentMap.get(s.agent_id)?.name : undefined}
        agentColor={agentColor(s.agent_id)}
        isRenaming={s.id === props.renamingSessionId}
        onStartRename={() => props.onStartRename(s.id)}
        onCommitRename={(t) => props.onCommitRename(s.id, t)}
        onCancelRename={props.onCancelRename}
        onClick={() => props.onSelectSession(s.id)}
        onDelete={() => props.onDeleteSession(s.id)}
      />
    )
  }
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
```

- [ ] **Step 3: Rewrite SessionItem.tsx for light theme**

Open `src/renderer/components/SessionItem.tsx`. The current implementation uses dark colors (rgba whites). Replace the styles section (everything inside `return (`) with light theme:

- Container: `flex items-center gap-2 px-2 py-1.5 mx-2 rounded-md cursor-pointer`
- active: `bg-canvas` + `shadow-[0_0_0_1px_var(--line)]`
- hover: `bg-line-2`
- avatar: 20×20, radius 5, gradient by agent (use `agentColor` to derive hue → simple `bg-gradient-to-br from-X to-Y`)
- title: 12.5px text color
- meta: 10.5px subtle
- delete button: opacity-0 group-hover:opacity-100 + hover:text-err

Keep all the rename logic (input, key handlers, ref). Only change visual classes.

- [ ] **Step 4: Append sidebar CSS to index.css**

```css
/* Sidebar */
.sb {
  width: 240px;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sb-drag {
  height: 30px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}
.sb-bar {
  margin: 0 14px 6px;
  display: flex;
  gap: 8px;
  align-items: center;
  -webkit-app-region: no-drag;
}
.sb-search {
  flex: 1;
  height: 30px;
  padding: 0 10px;
  background: var(--line-2);
  border-radius: 7px;
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: text;
  transition: background 0.15s;
}
.sb-search:hover {
  background: var(--line);
}
.sb-search svg {
  stroke: var(--mute);
}
.sb-search span {
  flex: 1;
  font-size: 12.5px;
  color: var(--mute);
}
.sb-plus {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: var(--text);
  color: var(--canvas);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: none;
}
.sb-plus:hover {
  background: #000;
}
.sb-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
}
.sb-group {
  padding: 10px 16px 4px;
  font-size: 10px;
  color: var(--mute);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}
.sb-settings {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  margin: 0 8px 8px;
  border-radius: var(--r-md);
  cursor: pointer;
  color: var(--mute);
  font-size: 12.5px;
  background: none;
  border: none;
  width: calc(100% - 16px);
  text-align: left;
}
.sb-settings:hover {
  background: var(--line-2);
  color: var(--text);
}
.sb-settings svg {
  stroke: currentColor;
}
.sb-kbd {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--subtle);
}
```

- [ ] **Step 5: Update `agentColor` helper to return gradient pair**

In `SessionItem.tsx`, the existing `agentColor` returns one hex. Change to return `{ from: string, to: string }` so SessionItem can compose `bg-gradient-to-br from-[X] to-[Y]`. Keep the deterministic hash, but pick from these 5 gradient pairs:

```ts
const AGENT_GRADIENTS = [
  ['#10b981', '#059669'], // emerald (secretary)
  ['#3b82f6', '#6366f1'], // blue→indigo (researcher)
  ['#f59e0b', '#d97706'], // amber→orange (writer)
  ['#8b5cf6', '#a855f7'], // purple (scheduler)
  ['#ec4899', '#db2777'], // pink (data)
]
export function agentColor(agentId: string | undefined): { from: string; to: string } {
  if (!agentId) return { from: '#3b82f6', to: '#6366f1' }
  let hash = 0
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0
  const [from, to] = AGENT_GRADIENTS[hash % AGENT_GRADIENTS.length]
  return { from, to }
}
```

Update SessionItem's avatar styling to use `style={{ background: \`linear-gradient(135deg, ${agentColor.from}, ${agentColor.to})\` }}`.

Update Sidebar's `renderSession` to pass the gradient object (the existing SessionItem signature needs adjusting too).

- [ ] **Step 6: Typecheck + smoke**

```bash
npm run typecheck && npm run dev
```

Expected: sidebar now light, search chip + black solid +, agent avatars in gradients. Sessions still clickable. Settings at the very bottom (no border-top line).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/pages/Chat/Sidebar.tsx src/renderer/components/SessionItem.tsx src/renderer/index.css
git commit -m "feat(ui): rebuild Sidebar with A2 light theme

- Search filled chip + black solid + button
- Light surface background (no more dark navy)
- Agent avatars: 5 deterministic gradient pairs
- Settings as sibling of session list (sticks to bottom, no border-top)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 · Redesign TopBar (44px, neutral, with export agent)

### Task 7.1: Rewrite TopBar.tsx with new visual

**Files:**

- Modify: `src/renderer/pages/Chat/TopBar.tsx`
- Append: `src/renderer/index.css`

- [ ] **Step 1: Replace TopBar.tsx**

Keep the picker logic (dropdown state, click-outside, callbacks). Change the visual to:

- `<div className="topbar">` (44px height, 1px bottom border)
- agent picker: `.pick` (18×18 gradient avatar + name + sub + chevron)
- model picker: `.pick.model` (18×18 indigo-tinted avatar)
- right end: `<button className="export">` with `<DownloadIcon /> 导出 agent`

Use `<button>` for clickable elements; ensure no inline styles except gradient backgrounds.

- [ ] **Step 2: Append topbar CSS**

```css
/* TopBar */
.topbar {
  height: 44px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  flex-shrink: 0;
  -webkit-app-region: drag;
}
.topbar > * {
  -webkit-app-region: no-drag;
}
.pick {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: 12px;
  color: var(--body);
  background: none;
  border: none;
  font-family: inherit;
}
.pick:hover {
  background: var(--surface);
}
.pick .pa {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  color: white;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.pick.model .pa {
  background: #e0e7ff;
  color: var(--indigo);
}
.pick .pn {
  color: var(--text);
  font-weight: 500;
}
.pick .pm {
  color: var(--subtle);
  font-size: 11px;
}
.pick .ch {
  color: var(--subtle);
  font-size: 9px;
}
.topbar .export {
  margin-left: auto;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--canvas);
  color: var(--body);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.topbar .export:hover {
  border-color: var(--subtle);
}
```

- [ ] **Step 3: If Crystallizer button still exists in TopBar, remove it.** The crystallize flow is folded into prose; no top-bar entry needed.

- [ ] **Step 4: Wire export-agent handler**

Look at the existing flow (search `export` or `exportAgent` in `src/`). If a handler exists (likely in store / IPC), wire to the new `.export` button. If no handler — note as a follow-up. Don't invent a new IPC.

- [ ] **Step 5: Typecheck + smoke**

- [ ] **Step 6: Commit**

```bash
git add src/renderer/pages/Chat/TopBar.tsx src/renderer/index.css
git commit -m "feat(ui): rebuild TopBar (44px, neutral pickers, export agent right-aligned)

Removes Crystallizer entry — flow folds back into prose per spec §7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8 · Redesign MessageStream (turn rail + new block rendering)

This is the biggest visual change. Replace the existing bubble + tool-call layout with the chromeless turn rail.

### Task 8.1: Build TurnContainer + avatar helper

**Files:**

- Create: `src/renderer/pages/Chat/Turn.tsx`
- Append CSS

- [ ] **Step 1: Create Turn.tsx**

```tsx
// src/renderer/pages/Chat/Turn.tsx
import type { ReactNode } from 'react'

interface TurnProps {
  role: 'user' | 'bot'
  agentInitial?: string // for bot, e.g. "T" or "秘"
  agentGradient?: { from: string; to: string }
  isLast?: boolean // suppress vertical rail
  children: ReactNode
}

export function Turn({ role, agentInitial, agentGradient, isLast, children }: TurnProps) {
  return (
    <div className={`turn ${isLast ? 'turn-last' : ''}`}>
      <div
        className={`turn-av ${role === 'user' ? 'av-user' : 'av-bot'}`}
        style={
          role === 'bot' && agentGradient
            ? { background: `linear-gradient(135deg, ${agentGradient.from}, ${agentGradient.to})` }
            : undefined
        }
      >
        {role === 'user' ? 'Q' : (agentInitial ?? 'T')}
      </div>
      <div className="turn-body">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: Append CSS**

```css
/* Turn rail */
.turn {
  position: relative;
  padding-left: 32px;
  padding-bottom: 6px;
}
.turn + .turn {
  margin-top: 20px;
}
.turn:not(.turn-last)::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 22px;
  bottom: 0;
  width: 1px;
  background: var(--line);
}
.turn-av {
  position: absolute;
  left: 0;
  top: 0;
  width: 22px;
  height: 22px;
  border-radius: var(--r-md);
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}
.av-user {
  background: var(--text);
}
.av-bot {
  background: linear-gradient(135deg, var(--accent), var(--indigo));
}
.turn-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/Chat/Turn.tsx src/renderer/index.css
git commit -m "feat(ui): Turn component — chromeless avatar + vertical rail wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8.2: Rewrite message rendering inside MessageStream

**Files:**

- Modify: `src/renderer/pages/Chat/MessageStream.tsx`
- Modify: `src/renderer/components/MessageBubble.tsx` (or replace its usage)

This is the big swap. The current `MessageBubble` renders a bubble container; the new design is bubble-less inside a Turn.

- [ ] **Step 1: Decide approach**

Option A — replace `MessageBubble` entirely with new components inside MessageStream.
Option B — keep `MessageBubble` but strip its bubble-shell, output just prose + blocks.

Pick **A** — cleaner. MessageBubble becomes a thin wrapper that picks role + agent and renders Turn with prose/tool/block children.

- [ ] **Step 2: Write a new `MessageView.tsx`**

`src/renderer/components/MessageView.tsx`:

```tsx
import type { ChatMessage } from '../types/chat'
import { decodeMessageContent } from '../types/chat'
import { Prose } from './markdown/Prose'
import { Turn } from '../pages/Chat/Turn'
import { splitMessageWithTalorBlocks } from '@shared/talor-blocks/talor-block-parser'
import { DonePill, NeedInput, BlockedRow, WarningRow, Proposal } from './talor-blocks'

interface MessageViewProps {
  message: ChatMessage
  isStreaming?: boolean
  isLast?: boolean
  onPickChoice: (text: string) => void
  onConfirmProposal: (tool: string, args: Record<string, unknown>) => void
  onEmit: (text: string) => void
}

export function MessageView({
  message,
  isStreaming,
  isLast,
  onPickChoice,
  onConfirmProposal,
  onEmit,
}: MessageViewProps) {
  const isUser = message.role === 'user'
  const parts = decodeMessageContent(message.content)
  const textContent = parts.map((p) => (p.type === 'text' ? p.content : '')).join('')

  if (isUser) {
    return (
      <Turn role="user" isLast={isLast}>
        <div className="user-msg">{textContent}</div>
      </Turn>
    )
  }

  const segments = splitMessageWithTalorBlocks(textContent || '')

  return (
    <Turn role="bot" isLast={isLast}>
      {segments.map((seg, i) => {
        if (seg.type === 'markdown') return <Prose key={i} source={seg.content} />
        if (seg.type === 'talor' && seg.block) {
          switch (seg.block.type) {
            case 'done':
              return <DonePill key={i} summary={seg.block.summary} />
            case 'need_input':
              return (
                <NeedInput
                  key={i}
                  question={seg.block.question}
                  choices={seg.block.choices}
                  reason={seg.block.reason}
                  onPick={onPickChoice}
                />
              )
            case 'blocked':
              return (
                <BlockedRow key={i} reason={seg.block.reason} retry_hint={seg.block.retry_hint} />
              )
            case 'warning':
              return (
                <WarningRow key={i} message={seg.block.message} severity={seg.block.severity} />
              )
            case 'proposal':
              return (
                <Proposal
                  key={i}
                  summary={seg.block.summary}
                  preview={seg.block.preview}
                  action={seg.block.action}
                  secondary_actions={seg.block.secondary_actions}
                  onConfirm={onConfirmProposal}
                  onEmit={onEmit}
                />
              )
          }
        }
        if (seg.type === 'invalid-talor' || seg.type === 'streaming-talor') return null
        return null
      })}
      {isStreaming && <span className="streaming-cursor" />}
    </Turn>
  )
}
```

CSS:

```css
.user-msg {
  color: var(--text);
  font-size: 14px;
}
.streaming-cursor {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: var(--body);
  vertical-align: text-bottom;
  margin-left: 2px;
  animation: blink 1s steps(2) infinite;
}
```

- [ ] **Step 3: Update MessageStream.tsx to use MessageView instead of MessageBubble**

Replace `<MessageBubble ... />` calls with `<MessageView ... />` (passing the new handlers).

Hook up `onPickChoice` to append `text` as a new user message (use existing `chat:send` flow).
Hook up `onConfirmProposal` to invoke a tool via IPC (see Task 8.3 for the safety gate).
Hook up `onEmit` similarly to `onPickChoice` — append as user message.

- [ ] **Step 4: Smoke test in dev**

```bash
npm run dev
```

Expected: messages now in turn rail format. Markdown renders cleanly. Blocks render correctly.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/MessageView.tsx src/renderer/pages/Chat/MessageStream.tsx src/renderer/index.css
git commit -m "feat(ui): MessageView + chromeless turn rail rendering

Replaces bubble + tool-list layout with single-rail flow per spec §8.
Each turn = avatar + rail + (prose | tool row | block) children.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 8.3: Add Proposal CTA safety gate (Talor-side tool invocation)

**Files:**

- Create or extend: `src/main/chat/proposal-invoke.ts`
- Add IPC: `src/main/ipc/chat.ts` (handler `chat:invoke-proposal`)
- Modify: `src/preload/*` and `src/renderer/api/*` for the new IPC

- [ ] **Step 1: Define IPC contract**

Add to `src/shared/types/ipc.ts` (or wherever IPC types live):

```ts
export interface InvokeProposalArgs {
  session_id: string
  message_id: string
  tool: string
  args: Record<string, unknown>
}

export interface InvokeProposalResult {
  ok: boolean
  error?: { code: string; message: string }
}
```

- [ ] **Step 2: Implement business-layer handler**

```ts
// src/main/chat/proposal-invoke.ts
import { toolRegistry } from '../tools/registry'
import { PermissionGuard } from '../permissions/guard'

export async function invokeProposal(args: {
  session_id: string
  tool: string
  args: Record<string, unknown>
}): Promise<{ ok: boolean; error?: { code: string; message: string } }> {
  // 1. Tool must exist
  if (!toolRegistry.has(args.tool)) {
    return {
      ok: false,
      error: { code: 'TOOL_NOT_FOUND', message: `Tool "${args.tool}" not registered` },
    }
  }
  // 2. Args validated by the tool's own zod schema
  const validated = toolRegistry.validateInput(args.tool, args.args)
  if (!validated.ok) {
    return { ok: false, error: { code: 'TOOL_INVALID_ARGS', message: validated.error } }
  }
  // 3. Permission check
  const allowed = await PermissionGuard.check({
    session_id: args.session_id,
    tool: args.tool,
    args: validated.data,
  })
  if (!allowed.ok) {
    return { ok: false, error: { code: 'TOOL_DENIED', message: allowed.reason } }
  }
  // Execute and stream result back through normal chat:send loop
  await toolRegistry.invoke(args.tool, validated.data, { session_id: args.session_id })
  return { ok: true }
}
```

(Adapt to actual `toolRegistry` / `PermissionGuard` API — names may differ.)

- [ ] **Step 3: Wire IPC handler**

In `src/main/ipc/chat.ts` (or appropriate file):

```ts
ipcMain.handle(
  'chat:invoke-proposal',
  async (_, args: InvokeProposalArgs): Promise<InvokeProposalResult> => {
    return await invokeProposal(args)
  },
)
```

- [ ] **Step 4: Expose in preload + renderer API**

Add `talorAPI.chat.invokeProposal(args)` mirror in preload + renderer api wrapper.

- [ ] **Step 5: Wire in MessageView**

In `MessageStream.tsx`, `onConfirmProposal` becomes:

```ts
const onConfirmProposal = async (tool: string, args: Record<string, unknown>) => {
  const res = await talorAPI.chat.invokeProposal({
    session_id: currentSessionId!,
    message_id: '...', // current message
    tool,
    args,
  })
  if (!res.ok) {
    // Show inline error toast (use existing error display)
  }
}
```

- [ ] **Step 6: Test (integration — using real toolRegistry)**

Write a quick test in `src/main/chat/proposal-invoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { invokeProposal } from './proposal-invoke'

describe('invokeProposal', () => {
  it('rejects unknown tool', async () => {
    const r = await invokeProposal({ session_id: 's1', tool: 'does.not.exist', args: {} })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('TOOL_NOT_FOUND')
  })
})
```

```bash
npx vitest run src/main/chat/proposal-invoke.test.ts 2>&1 | tail -10
```

- [ ] **Step 7: Commit**

```bash
git add src/main/chat/proposal-invoke.ts src/main/chat/proposal-invoke.test.ts src/main/ipc/chat.ts src/preload/ src/renderer/api/ src/shared/types/ipc.ts
git commit -m "feat(chat): Proposal block CTA safety gate (chat:invoke-proposal IPC)

Three-stage check: tool exists, zod args, PermissionGuard. LLM proposes,
Talor executes — separated authority per spec §11A.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9 · Redesign InputArea

### Task 9.1: Rewrite InputArea.tsx

**Files:**

- Modify: `src/renderer/pages/Chat/InputArea.tsx`
- Append CSS

- [ ] **Step 1: Replace structure**

New layout:

- Outer: `<div className="input-wrap">` (14px 32px padding)
- Inner card: `<div className="input-card">` (1px border, 12px radius)
- Meta row: `[ws-button] [permissions-popover]` (mono 11.5px)
- Textarea: 14px text, min-height 48px
- Toolbar: attachment / slash / send (send is solid black)

Keep existing handlers (input change, key down with cmd+enter, attachments, workspace selection).

- [ ] **Step 2: Append CSS**

```css
/* Input area */
.input-wrap {
  padding: 14px 32px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
  background: var(--canvas);
}
.input-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--canvas);
  transition: all 0.15s;
}
.input-card:focus-within {
  border-color: var(--subtle);
  box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04);
}
.input-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 4px;
  font-size: 11.5px;
  color: var(--mute);
  font-family: var(--font-mono);
}
.input-meta .ws {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  background: none;
  border: none;
  color: var(--mute);
  font-family: inherit;
  font-size: inherit;
}
.input-meta .ws:hover {
  color: var(--body);
}
.input-meta .perm {
  margin-left: auto;
  cursor: pointer;
  font-family: var(--font-ui);
}
.input-textarea {
  width: 100%;
  padding: 6px 14px;
  font-size: 14px;
  color: var(--text);
  line-height: 1.55;
  resize: none;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  min-height: 48px;
  max-height: 160px;
}
.input-textarea::placeholder {
  color: var(--subtle);
}
.input-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 8px;
}
.input-btn {
  background: none;
  border: none;
  cursor: pointer;
  width: 28px;
  height: 28px;
  border-radius: var(--r-md);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--mute);
}
.input-btn:hover {
  background: var(--surface);
  color: var(--text);
}
.input-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.input-send {
  margin-left: auto;
  background: var(--text);
  color: white;
  padding: 5px 12px;
  border-radius: var(--r-md);
  border: none;
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}
.input-send:disabled {
  background: var(--line);
  color: var(--subtle);
  cursor: not-allowed;
}
```

- [ ] **Step 3: Smoke test, commit**

```bash
npm run dev  # verify
git add src/renderer/pages/Chat/InputArea.tsx src/renderer/index.css
git commit -m "feat(ui): rebuild InputArea (mono meta + neutral focus ring + solid send)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 10 · Tool call rendering — replace ToolCallMessage with new ToolRow

### Task 10.1: Build tool dispatcher

**Files:**

- Create: `src/renderer/components/tool-calls/ToolDispatch.tsx`
- Modify: `src/renderer/pages/Chat/MessageStream.tsx` (replace ToolCallMessage usage)

- [ ] **Step 1: Implement ToolDispatch**

```tsx
// src/renderer/components/tool-calls/ToolDispatch.tsx
import { ToolRow } from './ToolRow'
import { DiffView } from './DiffView'
import { BashOutput } from './BashOutput'
import { GrepResults } from './GrepResults'

interface ToolCallPart {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  input: unknown
}
interface ToolResultPart {
  type: 'tool-result'
  toolCallId: string
  toolName: string
  output: string
  isError: boolean
}

interface ToolDispatchProps {
  use: ToolCallPart
  result?: ToolResultPart
}

const BUILTIN_TOOLS = new Set(['bash', 'read', 'write', 'edit', 'grep', 'glob', 'ls'])

export function ToolDispatch({ use, result }: ToolDispatchProps) {
  const status = !result ? 'running' : result.isError ? 'error' : 'done'
  const summary = buildSummary(use.toolName, use.input)

  // MCP tool — generic row, expandable to JSON
  if (!BUILTIN_TOOLS.has(use.toolName)) {
    return (
      <ToolRow status={status} name={use.toolName} target={summary} expandable={!!result}>
        {result && (
          <>
            <div className="tool-body-label">Input</div>
            <pre>{JSON.stringify(use.input, null, 2)}</pre>
            <div className="tool-body-label">Output</div>
            <pre className={result.isError ? 'tool-err-pre' : ''}>
              {truncate(result.output, 500)}
            </pre>
          </>
        )}
      </ToolRow>
    )
  }

  // Built-in: row + specialized output
  return (
    <>
      <ToolRow status={status} name={use.toolName} target={summary} />
      {result && renderBuiltinOutput(use.toolName, use.input, result.output)}
    </>
  )
}

function buildSummary(name: string, input: unknown): string {
  // Same logic as old ToolCallMessage.buildInputSummary
  const obj = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
      return String(obj.path ?? '')
    case 'bash':
      return String(obj.command ?? '')
    case 'grep':
      return `"${obj.pattern ?? ''}"${obj.path ? ' ' + obj.path : ''}`
    case 'glob':
      return String(obj.pattern ?? '')
    case 'ls':
      return String(obj.path ?? '.')
    default:
      return JSON.stringify(input)
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '\n[truncated]'
}

function renderBuiltinOutput(name: string, input: unknown, output: string): JSX.Element | null {
  switch (name) {
    case 'bash':
      // parse stdout/stderr from output structure (depends on Talor's tool return format)
      return <BashOutput stdout={output} />
    case 'edit':
      // parse diff from output (Talor's edit tool returns success message + diff?)
      // For now, fall through to no extra render — the tool row + summary is enough.
      return null
    case 'grep':
      // parse matches — Talor's grep returns "file:line:text" format
      return parseGrepOutput(output)
    case 'read':
      return null // row is enough
    case 'ls':
      return <BashOutput stdout={output} /> // simple tree
    default:
      return null
  }
}

function parseGrepOutput(raw: string) {
  // TODO: real parser. For now, fallback to a simple display.
  return <pre style={{ marginLeft: 16, fontSize: 12 }}>{raw}</pre>
}
```

- [ ] **Step 2: Replace ToolCallMessage usage**

In `MessageStream.tsx`, find where `ToolCallMessage` is rendered and replace with mapped `ToolDispatch` for each tool call.

- [ ] **Step 3: Append CSS**

```css
.tool-body-label {
  color: var(--subtle);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 3px;
  font-family: var(--font-ui);
  font-weight: 500;
}
.tool-body-label + .tool-body-label {
  margin-top: 8px;
}
.tool-body pre {
  margin: 0;
  color: var(--body);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 120px;
  overflow-y: auto;
}
.tool-err-pre {
  color: var(--err) !important;
}
```

- [ ] **Step 4: Smoke test + commit**

```bash
npm run dev  # exercise a tool call
git add src/renderer/components/tool-calls/ToolDispatch.tsx src/renderer/pages/Chat/MessageStream.tsx src/renderer/index.css
git commit -m "feat(ui): ToolDispatch — built-in renderers + generic MCP fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 11 · Streaming consistency + edge states

### Task 11.1: Streaming cursor for in-flight prose

Already added in Phase 8 (`.streaming-cursor`). Verify it's positioned in the prose during `isStreaming`.

### Task 11.2: Remove `StreamingTalorSkeleton` (replace with final container)

**Files:**

- Modify: `src/renderer/components/TalorBlockRenderer.tsx` (or wherever skeleton lives)

- [ ] **Step 1: Find skeleton usage**

```bash
grep -rn "StreamingTalorSkeleton\|animate-pulse" src/renderer/ | head -10
```

- [ ] **Step 2: Replace skeleton rendering**

If the parser yields `{ type: 'streaming-talor', streamingType, content }`, render the final block component but with placeholder content (e.g., for `need_input`, render the rail + question text accumulated so far, and choices as `disabled` placeholders with `border-style: dashed` until args resolve).

```tsx
// Inside MessageView's segment switch:
if (seg.type === 'streaming-talor' && isStreaming) {
  // Render the final container with whatever partial data the parser extracted
  switch (seg.streamingType) {
    case 'need_input':
      return (
        <NeedInput question={seg.partialQuestion ?? ''} choices={undefined} onPick={() => {}} />
      )
    case 'proposal':
      return (
        <Proposal
          summary={seg.partialSummary ?? ''}
          action={{ label: '...', tool: '', args: {} }}
          onConfirm={() => {}}
          onEmit={() => {}}
        />
      )
    // etc.
  }
}
```

(Extend `splitMessageWithTalorBlocks` if needed to expose partial fields. If the parser only knows the `type`, render the container shell with empty content — that's also fine.)

- [ ] **Step 3: Delete the old skeleton component**

```bash
# Find and delete:
grep -rn "function StreamingTalorSkeleton\|class StreamingTalorSkeleton" src/renderer/
```

Remove the function/component.

- [ ] **Step 4: Tests + smoke**

```bash
npm test 2>&1 | tail -10
npm run dev  # exercise streaming with a need_input block
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(blocks): drop StreamingTalorSkeleton, render final container during streaming

Streaming consistency rule per spec §12: container shape is stable from the
moment 'type' is parsed; only text content streams in. No more skeleton→card jump.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11.3: Remove InferredIntentCard rendering

**Files:**

- Modify: `src/renderer/components/MessageBubble.tsx` (or `MessageView`)

- [ ] **Step 1: Remove inferIntent call and InferredIntentCard render branch**

Find and remove:

```bash
grep -n "inferIntent\|InferredIntentCard" src/renderer/
```

Delete the inferIntent call and the InferredIntentCard JSX branch. (Don't delete `inferIntent` function from `@shared/ui-rendering/intent-classifier.ts` yet — leave for any backend telemetry use.)

- [ ] **Step 2: Smoke + commit**

```bash
git add -A
git commit -m "refactor(ui): drop InferredIntentCard rendering

Spec §11.1: inferred_intent is system meta, not user-facing UI.
Function kept in @shared for any backend telemetry use.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11.4: Empty state + API error banner

**Files:**

- Modify: `src/renderer/pages/Chat/MessageStream.tsx`

- [ ] **Step 1: Empty state**

When `messages.length === 0 && streamState !== 'streaming'`, render:

```tsx
<div className="empty-state">
  <div className="empty-logo">T</div>
  <div className="empty-title">开始对话</div>
  <div className="empty-sub">下方输入消息，或拖入文件 / 图片</div>
</div>
```

CSS:

```css
.empty-state {
  padding: 80px 24px;
  text-align: center;
}
.empty-logo {
  font-size: 28px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--accent), var(--indigo));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 8px;
}
.empty-title {
  font-size: 15px;
  color: var(--text);
  font-weight: 600;
  margin-bottom: 4px;
}
.empty-sub {
  font-size: 13px;
  color: var(--mute);
}
```

- [ ] **Step 2: API error banner**

When `streamState === 'error' && error`, render after messages:

```tsx
<div className="err-banner">
  <div className="err-banner-code">{error.code}</div>
  <div className="err-banner-msg">{error.message}</div>
  {error.recoverable && (
    <span className="err-banner-retry" onClick={retry}>
      立即重试
    </span>
  )}
</div>
```

CSS:

```css
.err-banner {
  margin: 10px 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: var(--err);
  font-size: 13px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.err-banner-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #991b1b;
}
.err-banner-msg {
  flex: 1;
}
.err-banner-retry {
  color: var(--err);
  cursor: pointer;
  font-weight: 500;
  border-bottom: 1px solid currentColor;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/pages/Chat/MessageStream.tsx src/renderer/index.css
git commit -m "feat(ui): empty state + API error banner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11.5: Crystallize workbench — dashed separator

**Files:**

- Modify: `src/renderer/pages/Chat/MessageStream.tsx` (the `{ws.isOpen && ...}` block)
- Modify or remove: `src/renderer/components/CrystallizeSeparator.tsx`

- [ ] **Step 1: Replace purple-bordered card with dashed top border + centered label**

The current crystallize panel is a `border:1px solid #c084fc; background:#faf5ff` container. Replace with:

```tsx
{ws.isOpen && (
  <div className="crystal">
    <div className="crystal-bar" data-label={`Crystallize · ${ws.workbenchMessages.length} from this point`} />
    <div className="crystal-body">
      {/* keep existing message list + agent list as children */}
      {ws.workbenchMessages.map((m) => (
        <MessageView key={m.id} message={m} ... />
      ))}
      <WorkbenchAgentList ... />
    </div>
  </div>
)}
```

CSS:

```css
.crystal {
  margin: 16px 0;
}
.crystal-bar {
  border-top: 1px dashed var(--indigo);
  position: relative;
  height: 18px;
}
.crystal-bar::after {
  content: attr(data-label);
  position: absolute;
  left: 50%;
  top: -8px;
  transform: translateX(-50%);
  background: var(--canvas);
  padding: 0 10px;
  font-size: 10.5px;
  color: var(--indigo);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
}
.crystal-body {
  padding-left: 8px;
  border-left: 2px solid #e0e7ff;
}
```

- [ ] **Step 2: Smoke + commit**

```bash
git add -A
git commit -m "feat(ui): crystallize workbench — dashed separator instead of purple box

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 12 · Cleanup & remove dead code

### Task 12.1: Strip dark-mode classes and stale styles

**Files:** various

- [ ] **Step 1: Find dark-mode classes (project is light-only)**

```bash
grep -rn "dark:\|dark-mode" src/renderer/ | head -20
```

- [ ] **Step 2: Remove `dark:` Tailwind variants from MessageBubble / ToolCallMessage / others**

Use targeted edits per file. Don't blanket sed — review each.

- [ ] **Step 3: Find old MessageBubble usage and either delete file or shrink to a re-export**

```bash
grep -rn "from.*MessageBubble\|import.*MessageBubble" src/renderer/
```

If MessageBubble is no longer used after MessageView swap-in, delete the file. Otherwise replace with a tiny shim that forwards to MessageView (mark `@deprecated`).

- [ ] **Step 4: Remove ToolCallMessage (replaced by ToolDispatch)**

```bash
grep -rn "ToolCallMessage" src/renderer/
```

Delete file + all references.

- [ ] **Step 5: Smoke test full app + commit**

```bash
npm run dev
# manually exercise: new session, message, tool call, block, settings
npm run typecheck && npm test
git add -A
git commit -m "chore(ui): remove dead components — MessageBubble, ToolCallMessage, dark variants

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 12.2: Remove `text-pink-500`, dark-bg-#111827, and similar hex literals

- [ ] **Step 1: Grep for known stale literals**

```bash
grep -rn "text-pink\|#111827\|#0f172a\|#1a1b26\|primary-[0-9]\|accent-[0-9]" src/renderer/
```

- [ ] **Step 2: Replace each match with a token reference**

Walk through each hit; replace with `var(--X)` (in CSS) or `bg-text` / `bg-canvas` etc. (in JSX classes).

- [ ] **Step 3: Smoke + commit**

```bash
npm run dev
git add -A
git commit -m "chore(ui): purge stale hex literals + primary/accent classes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 13 · Final verification

### Task 13.1: Full test + typecheck + lint

- [ ] **Step 1: Tests**

```bash
npm test 2>&1 | tail -20
```

Expected: failure count ≤ Phase 0 baseline. **If new failures**: triage before continuing.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: 0 new errors beyond baseline.

- [ ] **Step 3: Lint**

```bash
npm run lint 2>&1 | tail -10
```

Expected: 0 errors.

### Task 13.2: Manual UI walkthrough

- [ ] **Step 1: Start dev**

```bash
npm run dev
```

- [ ] **Step 2: Walk through scenarios** (visual comparison vs `final-v2.html`):
  1. New session — empty state shows centered logo + "开始对话"
  2. Type message → send → see user turn (Q avatar) + bot turn (agent avatar) + rail line
  3. Verify markdown rendering: bold, italic, code (no pink), table, list (4px dot bullets)
  4. Trigger a bash tool → see ToolRow with spinner → done check + duration
  5. Trigger a need_input block → see 2px blue rail + question + option buttons; click an option → sends as new user message
  6. Trigger a proposal block → see 2px indigo rail + summary + preview + black solid CTA; click → invokes tool through safety gate
  7. Sidebar: search chip + black solid + button; sessions in light theme; settings at very bottom
  8. Topbar: 44px, agent picker + model picker + 导出 agent right-aligned
  9. Input area: focused state shows neutral outer ring (not blue glow)
  10. Streaming: prose has blinking cursor; tool row shows spinner; block container stable

- [ ] **Step 3: If any deviation from spec**, file a follow-up task and proceed (don't block the merge).

### Task 13.3: Final commit + PR description

- [ ] **Step 1: Verify clean tree**

```bash
git status
```

- [ ] **Step 2: Optional — squash review commits**

(Skip if many small commits are preferred. Talor's CLAUDE.md prefers small focused commits.)

- [ ] **Step 3: Push branch**

```bash
git push -u origin feature/workspace-ui-redesign
```

- [ ] **Step 4: Open PR with title and summary**

PR title: `feat(ui): workspace redesign — chromeless flow, MCP-agnostic blocks`

PR body sections:

- Summary (3 bullets from spec §2 goals)
- Screenshots (link to final-v2.html)
- Test plan (checklist from Task 13.2)
- Spec reference

---

## Self-Review Notes

After writing this plan, applied checks:

1. **Spec coverage:**
   - §3 design tokens → Phase 1 ✓
   - §6 Sidebar → Phase 6 (incl. 6.3 pin-bottom structure) ✓
   - §7 Topbar → Phase 7 ✓
   - §8 message stream → Phase 8 ✓
   - §9 markdown → Phase 5.1 (Prose) ✓
   - §10 tool calls (built-in + MCP fallback) → Phase 5.2, 5.4, Phase 10 ✓
   - §11 blocks + §11A protocol → Phase 2, 3, 5.3, 8.2, 8.3 ✓
   - §12 streaming consistency → Phase 11.2 ✓
   - §13 input → Phase 9 ✓
   - §14 edge states → Phase 11.4, 11.5 ✓
   - §15 removal list → Phase 12 ✓

2. **Placeholder scan:** Two intentional placeholders:
   - Task 10.1 `parseGrepOutput` — has a "TODO: real parser. For now, fallback" — this is a deliberate v1 simplification; grep results in raw form are still useful.
   - Task 8.3 `PermissionGuard` API names — adapt to actual existing API; this requires reading current code.

   No "TBD" / "implement later" patterns elsewhere.

3. **Type consistency:** Names cross-referenced:
   - `ProposalBlock` schema (Phase 2) → used in MessageView (Phase 8) → matches
   - `ToolRow` props (Phase 5.2) → used by ToolDispatch (Phase 10) → matches
   - `Turn` props → consumed in MessageView → matches
   - `agentColor` returns `{from, to}` (Phase 6) → SessionItem consumes → matches

4. **Ambiguity:** One open question — actual `toolRegistry` API shape for `validateInput` and `invoke` (Task 8.3). Note in task: "Adapt to actual toolRegistry / PermissionGuard API — names may differ." Engineer will read existing code first.

---
