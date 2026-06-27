# Contributing to Talor

Thanks for your interest in contributing!

> 中文版见 [docs/zh-CN/CONTRIBUTING.md](./docs/zh-CN/CONTRIBUTING.md).

> Talor is a **pure agent platform** — it ships no business agents of its own. Contributions should strengthen the runtime (agent loop, tools, skills, providers, prompt pipeline), not add domain logic.

---

## Quick start

**Prerequisites**: Node.js 22+, npm 10+, macOS or Linux (Windows untested).

```bash
git clone https://github.com/Quinn-Talor/talor.git
cd talor
npm install
npm run dev          # Vite HMR + Electron main process
```

| Command              | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `npm run dev`        | Launch dev (Electron + Vite HMR)                |
| `npm test`           | Full vitest run                                 |
| `npm run test:watch` | Watch mode                                      |
| `npm run typecheck`  | 3-tsconfig merged check (main/preload/renderer) |
| `npm run lint`       | ESLint                                          |
| `npm run build`      | electron-vite build + electron-builder package  |

**Native module caveat**: `better-sqlite3` is built for Electron's ABI. Running `vitest` under Node needs a Node-ABI rebuild, then restore for the app:

```bash
# before running vitest directly:
cd node_modules/better-sqlite3 && npx --no-install node-gyp rebuild
# after, to run the app again:
npx @electron/rebuild -f -w better-sqlite3
```

---

## Before you code

Read the engineering knowledge base under [`vibe/project/`](./vibe/project/):

- [`overview.md`](./vibe/project/overview.md) — architecture + the agent execution flow (detect / reflect / turn-end)
- [`standards.md`](./vibe/project/standards.md) — MUST / SHOULD / NEVER rules
- [`patterns.md`](./vibe/project/patterns.md) — patterns + reference-implementation index

[`CLAUDE.md`](./CLAUDE.md) is the fast on-ramp (also used by AI coding agents) and lists the most common pitfalls.

---

## Workflow

1. **Branch** off `master` (`git switch -c fix/...` or `feat/...`). Don't commit to `master` directly.
2. **Find a reference implementation** in the patterns index and follow its idiom.
3. **Write tests** — both a "triggers" and a "does-not-trigger" case (`standards.md §L-MUST-3`). For a bug fix, add a failing test that reproduces it first.
4. **Verify locally**: `npm test && npm run typecheck` must be green (allow pre-existing failures, but call them out).
5. **Commit** as `type(scope): summary` (type ∈ feat / fix / refactor / docs / test / chore). The body explains **why**, not just what.
6. **Open a PR** against `master` with a clear description and a linked issue.

### Non-negotiable invariants

A few rules are enforced by code and guarded by tests — breaking them corrupts sessions or breaks tool turns. See `CLAUDE.md §4` and `standards.md` for the full list. Highlights:

- `assistant(tool_use)` + `tool(result)` must be persisted in one transaction (`createBatch`) **and** read back in a deterministic order (`ORDER BY created_at, rowid`); nothing may split the pair when rebuilding the prompt. (§I-MUST-1/3, §J-MUST-2b)
- The cacheable prompt prefix (system/agent/tools/history layers) must stay byte-identical across builds — no timestamps/randomness. (§J-MUST-2c)
- All file paths go through `resolveToolPath`; high-risk commands are blocked at the validate/path-guard layer, not via user confirmation. (§K)
- Tool errors use `ToolErrorEnvelope`, not string prefixes. (§F-MUST-3)

---

## Reporting bugs

Open a [GitHub issue](https://github.com/Quinn-Talor/talor/issues) using the templates. For **security vulnerabilities**, do **not** open a public issue — see [SECURITY.md](./SECURITY.md).

## License of contributions

By contributing, you agree your contributions are licensed under the repository's license (Apache 2.0 + Commons Clause).
