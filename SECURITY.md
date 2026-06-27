# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Report privately via **GitHub Security Advisories**:
[**Report a vulnerability**](https://github.com/Quinn-Talor/talor/security/advisories/new) (repo → Security → Advisories → "Report a vulnerability").

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (PoC if possible)
- Affected version / commit
- Any suggested mitigation

We aim to acknowledge reports within **5 business days** and will coordinate a fix and disclosure timeline with you.

## Scope

Talor is a **local-first desktop app** — your data lives under `~/.talor/` and API keys are stored via the OS keychain (`safe-storage`). Areas of particular interest:

- Credential handling (`accounts/`, `services/safe-storage`) — secrets must never reach prompts, IPC payloads, or the LLM
- Tool sandboxing (`tools/path-guard`, `tools/builtin/bash` blacklist) — path traversal, command injection
- Prompt injection via tool output (`<tool_output>` wrapping)
- MCP transport / Electron IPC surface

## Supported versions

Talor is pre-1.0 (`0.x`); only the latest `master` receives security fixes.
