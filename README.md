# Talor

[![License: Apache-2.0 + Commons Clause](https://img.shields.io/badge/license-Apache--2.0%20%2B%20Commons%20Clause-blue.svg)](./LICENSE)
[![CI](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml/badge.svg)](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](#prerequisites)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**English** · [中文](./docs/zh-CN/README.md)

> A pure agent platform — distill reusable AI coworkers from your own conversations.

Talor is an Electron desktop app that ships **no business agents of its own**. It provides an agent runtime + tool stack; every business agent is distilled by the user from chat history (the **Crystallizer**).

---

## What problem it solves

After a useful session with ChatGPT / Claude, that experience is usually lost — next time you start over. Talor lets you:

1. **Run a conversation** with Talor (using builtin tools / MCP / Skills).
2. **Click Crystallize** — Talor distills that conversation into a **reusable agent** (`prompt.md` + tool config).
3. **Invoke that agent** next time — it carries the original workflow and knowledge.

---

## Key features

- **Minimal schema** — an agent has just 8 fields (`id / name / description / agentPrompt / tools / skills / mcpServers / subagents`).
- **`prompt.md` sibling** — behavior lives in a standalone markdown file, editable on its own.
- **Reference architecture** — skills and MCP are managed by the platform; agents reference them by name, no copies.
- **Subagent delegation** — agents can call other agents (`delegate_agent` tool).
- **Feature framework** — business objects plug in as Features (`ArtifactStore` for read/write + `ArtifactUI` for rendering + tool ops); the platform core stays domain-agnostic. See [docs/talor-feature-architecture.md](./docs/talor-feature-architecture.md).
- **Credential safety** — MCP `envFromAccount` references the Account store; secrets never reach prompts, IPC, or the LLM.
- **Local-first** — all data under `~/.talor/`, no cloud dependency.
- **Multi-model** — Anthropic / OpenAI / Google / Ollama via Vercel AI SDK v7.
- **Prompt prefix caching** — append-only stability-layered assembly keeps the stable prefix contiguous and cacheable; Anthropic gets `cacheControl` breakpoints, others (e.g. deepseek) cache automatically (~80% hit measured).
- **Token usage stats** — vendor-agnostic, per-session input/output/cache read+write persisted and shown in the UI (k/M).

---

## Data layout

```
~/.talor/
  agents/<agent-id>/
    agent.json       # metadata (7 fields, excludes agentPrompt)
    prompt.md        # full agentPrompt
    README.md        # derived
  skills/<skill-name>/
    SKILL.md         # platform skill (shared by all agents)
    ...
  chat.db            # SQLite: sessions / messages / mcp_servers / account_keys
```

---

## Install

### Prerequisites

- Node.js 22+ (required to compile Electron 41 native modules)
- npm 10+
- macOS / Linux (Windows untested)

### Development

```bash
git clone https://github.com/Quinn-Talor/talor.git
cd talor
npm install
npm run dev
```

Vite HMR and the Electron main process start together.

### Build

```bash
npm run build       # electron-vite + electron-builder → dist/
```

---

## First run

1. On launch you land in `__chat__` (the platform assistant).
2. Run a workflow you want to capture (e.g. "review this PR https://github.com/.../pull/123 …").
3. Click **Crystallize** at the end of the turn.
4. The Crystallizer confirms your intent, then drafts `agent.json` + `prompt.md`.
5. Review → save; the agent appears on the Agents page.
6. Next time, type `/<agent-name> …` in chat or launch it from the Agents page.

### Configuring MCP / Skills / Accounts

- **MCP**: Settings → MCP Servers (stdio / http transport).
- **Skill**: drop a `SKILL.md` (+ assets) into `~/.talor/skills/<name>/` (if you use Claude Code, `~/.claude/skills/` is auto-copied).
- **Account**: Settings → Accounts (API keys / envVars like `GITHUB_TOKEN`).

---

## Architecture

See [vibe/project/overview.md](./vibe/project/overview.md) for the full architecture and the agent execution flow (detect / reflect / turn-end).

```
Renderer (React 19 + Tailwind + Zustand)
   │ IPC
Main Process
   ipc/*                       entry layer
   chat/orchestrator + loop/react-loop   ReAct engine
   prompt/PromptPipeline       7-plugin append-only assembly
   agent/agent-manager         platform + business agent lifecycle
   mcp/client                  MCP (stdio + http)
   skills/registry             platform SkillRegistry
   tools/*                     7 builtins (bash/read/write/edit/glob/grep/ls)
   repos/* + db/               SQLite
   accounts/account-store      encrypted credentials
```

---

## Contributing & community

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, workflow, non-negotiable invariants
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant
- [SECURITY.md](./SECURITY.md) — private vulnerability reporting
- [CHANGELOG.md](./CHANGELOG.md)

Engineering knowledge base lives in [vibe/project/](./vibe/project/); the AI-agent collaboration guide is [CLAUDE.md](./CLAUDE.md). Issues and PRs welcome — please read CONTRIBUTING first.

---

## License

Apache 2.0 + Commons Clause (no commercial resale). See [LICENSE](./LICENSE).
