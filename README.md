# Talor

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml/badge.svg)](https://github.com/Quinn-Talor/talor/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](#prerequisites)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**English** · [中文](./docs/zh-CN/README.md)

> A local-first desktop agent platform — runtime, tools, MCP, skills and multi-agent delegation in one app.

Talor is an Electron desktop app that ships **no business logic of its own**. It provides the agent runtime and tool stack; the agents you run are plain files you own — a short `agent.json` plus a `prompt.md` — and everything stays on your machine.

---

## What you get

- **A ReAct agent runtime** — multi-step reasoning with tools, plus code-level guards: dead-loop and failure-streak detection, context-budget halts, completion checks and forced summaries when a turn goes wrong.
- **Built-in tools** — `bash` / `read` / `write` / `edit` / `glob` / `grep` / `ls`, with path guarding (sensitive paths are hard-blocked, paths outside the workspace need your consent) and confirmation for high-risk calls.
- **MCP** — connect stdio or Streamable HTTP MCP servers; their tools are exposed on demand through `search_tool`.
- **Skills** — drop a `SKILL.md` into `~/.talor/skills/<name>/`; agents activate it with the `skill` tool.
- **Agents as files** — a minimal 8-field schema (`id / name / description / agentPrompt / tools / skills / mcpServers / subagents`); behavior lives in a sibling `prompt.md` you can edit directly. Skills and MCP servers are referenced by name, never copied.
- **Subagent delegation** — an agent can hand a sub-task to another agent (`delegate_agent`) in an isolated session, with concurrency limits, timeouts and recursion guards.
- **Multi-model** — Anthropic / OpenAI (and OpenAI-compatible endpoints such as DeepSeek) / Google / Ollama via Vercel AI SDK v7, with per-session reasoning depth.
- **Turn tracing** — every chat turn is recorded as a Langfuse-style trace (model calls, tools, reflections, token usage) you can inspect in the app.
- **Prompt prefix caching** — append-only, stability-layered prompt assembly keeps the cacheable prefix stable; Anthropic gets `cacheControl` breakpoints.
- **Token usage stats** — per-session input / output / cache read + write, normalized across vendors.
- **Feature framework** — business objects plug in as Features (`ArtifactStore` + `ArtifactUI` + tools) without touching the platform core. See [docs/talor-feature-architecture.md](./docs/talor-feature-architecture.md).
- **Local-first & private** — data lives under `~/.talor/`; provider API keys are encrypted with the OS keychain.

---

## Data layout

```
~/.talor/
  agents/<agent-id>/
    agent.json       # metadata (excludes agentPrompt)
    prompt.md        # full agentPrompt
  skills/<skill-name>/
    SKILL.md         # platform skill, shared by all agents
    ...
  config.json        # providers and app settings
  chat.db            # SQLite: sessions, messages, MCP servers, accounts, traces
```

---

## Install

### Prerequisites

- Node.js 22+ (needed to compile native modules for Electron 41)
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

1. **Add a model provider** — Settings → Provider (Anthropic / OpenAI / Google / Ollama, or any OpenAI-compatible base URL).
2. **Chat with the platform assistant** — you start in the default assistant, which can use the built-in tools, your MCP servers and skills, and delegate to your agents. Set a workspace folder for file and shell work.
3. **Add your own agents** — create `~/.talor/agents/<id>/agent.json` and `prompt.md` (minimal example below). Restart Talor to load a newly added agent; it then appears on the Agents page, where you can view it, edit it (JSON editor with live validation) and start a chat with it.

```json
{
  "id": "pr-reviewer",
  "name": "PR Reviewer",
  "description": "Reviews pull requests for correctness and risk.",
  "tools": ["bash", "read", "grep"]
}
```

### Configuring MCP / Skills / Accounts

- **MCP**: Settings → MCP (stdio command, or HTTP URL with bearer / API-key auth).
- **Skill**: put `SKILL.md` (+ assets) into `~/.talor/skills/<name>/`.
- **Account**: Settings → Account, for third-party credentials (e.g. `GITHUB_TOKEN`).
- **Permissions**: Settings → Permissions lists the path rules you have granted per workspace.

---

## Architecture

See [docs/engineering/overview.md](./docs/engineering/overview.md) for the full architecture and the agent execution flow (detect / reflect / turn-end).

```
Renderer (React 19 + Tailwind + Zustand)
   │ IPC (contextBridge, sandboxed)
Main Process
   ipc/*                                 entry layer
   chat/orchestrator + loop/react-loop   ReAct engine + detectors / reflectors
   prompt/PromptPipeline                 layered, cache-friendly prompt assembly
   memory/ShortTermMemory                history compression with tool-pair anchors
   agent/*                               agent loading, toolsets, delegation
   tools/*                               builtin tools, path guard, risk gate
   mcp/*                                 MCP client (stdio + Streamable HTTP)
   skills/*                              platform skill registry
   providers/*                           model adapters, usage normalization
   observe/*                             turn tracing
   repos/* + db/                         SQLite
```

---

## Contributing & community

- [CONTRIBUTING.md](./CONTRIBUTING.md) — dev setup, workflow, non-negotiable invariants
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — Contributor Covenant
- [SECURITY.md](./SECURITY.md) — private vulnerability reporting
- [CHANGELOG.md](./CHANGELOG.md)

The engineering knowledge base lives in [docs/engineering/](./docs/engineering/); the AI-agent collaboration guide is [CLAUDE.md](./CLAUDE.md). Issues and PRs are welcome — please read CONTRIBUTING first.

---

## License

[MIT](./LICENSE) © Quinn-Talor
