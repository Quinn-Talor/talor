# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-session token usage statistics — vendor-agnostic normalizer reading AI SDK v7 unified `inputTokenDetails`, recorded at all three LLM call sites (main loop / reflect / compression) into the `sessions` table, shown in the composer seam with compact `k`/`M` units.
- Anthropic prefix-cache breakpoints (`cacheControl`) on the stable prompt prefix; non-Anthropic providers rely on their automatic caching.
- Append-only stability-layered prompt assembly: plugins carry a `layer`; the cacheable prefix (system/agent/tools/history) stays contiguous, volatile content trails.
- Subagent delegation via the `delegate_agent` tool; Feature framework for business objects (`ArtifactStore` + `ArtifactUI`).

### Changed

- Upgraded Vercel AI SDK v6 → v7 (providers v3 → v4); `CoreMessage` → `ModelMessage`; Ollama routed through the official `@ai-sdk/openai-compatible`.
- Agent profile reduced to a minimal 8-field schema; `agentPrompt` split into a sibling `prompt.md`.

### Fixed

- Tool turns failed with `AI_MissingToolResultsError`: a volatile system message (runtime meta) split the `tool_use`/`tool_result` pair during prompt rebuild.
- `listBySession` now orders by `(created_at, rowid)` so same-timestamp tool pairs keep their order.
- `bash` now returns stdout (not only stderr) on non-zero exit, so command failures are diagnosable.
- System runtime timestamp coarsened to date-level, restoring prefix-cache hits.

## [0.1.0]

- Initial pre-release: pure local agent platform — ReAct runtime, 7 builtin tools, MCP integration, skill system, Crystallizer (distill reusable agents from chat history), credential management.

[Unreleased]: https://github.com/Quinn-Talor/talor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Quinn-Talor/talor/releases/tag/v0.1.0
