// src/main/agent/templates.ts — 业务层：内置 agent 模板库 (Schema 2.0)
//
// IPC `agents:list-templates` 返回。用户从模板复制后可改 id 保存。
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*

import type { AgentProfile } from '@shared/types/agent'

export interface AgentTemplate {
  id: string
  name: string
  description: string
  /** 模板 profile (符合 schema 2.0). */
  profile: AgentProfile
}

const CODE_REVIEWER: AgentProfile = {
  schemaVersion: '2.0',
  id: 'code_reviewer',
  name: 'Code Reviewer',
  description: `Reviews pull requests against team coding standards and produces structured findings.

会做：分析 diff 并按 blocker/major/minor/nit 分级、引用规则编号佐证每条 blocker、跨文件查找用法和先例、对照项目 standards.md 检查违规。

不会做：修改任何源代码、执行待评审的代码、评审非代码文件、评审超过 2000 行的超大 diff（要求拆分）。`,
  version: '1.0.0',
  agentPrompt: `## Required Inputs
- **pr_url_or_diff** (text, REQUIRED): Pull request URL or raw diff to review.

## Workflow
1. Load the diff (bash + read).
2. If your team's coding standards / common-patterns docs are declared in this agent's references, read them to ground rule citations.
3. Walk the diff hunk-by-hunk and classify findings.
4. Emit the final review report as JSON.

## Principles
- Every blocker MUST cite a concrete rule reference if a standards reference is available; otherwise describe the violation precisely.
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

> Tip: to make rule citations stronger, add references to this agent (e.g. \`references: [{ id: "standards", path: "references/standards.md", description: "..." }]\`) — the LLM will read them via the \`read\` tool when relevant.`.trim(),
  tools: ['read', 'grep', 'glob', 'bash'],
  preferences: {
    modelId: 'claude-opus-4-7',
    providerId: 'anthropic',
  },
}

const WEEKLY_REPORTER: AgentProfile = {
  schemaVersion: '2.0',
  id: 'weekly_reporter',
  name: 'Weekly Reporter',
  description: `Generates weekly status reports from a list of activities.

会做：从活动列表 / 文件 / 日志生成结构化周报、按 Done / In-Progress / Blocked 分类、突出关键进展和风险。

不会做：访问外部系统、修改任何文件、推断未提供的数据。`,
  version: '1.0.0',
  agentPrompt: `## Required Inputs
- **time_range** (text, REQUIRED): Date range covered (e.g., "2026-04-29 to 2026-05-05").
- **activities** (text, REQUIRED): Activity list or path to activity log file.

## Workflow
1. If activities is a file path, read the file.
2. Categorize items into Done / In-Progress / Blocked.
3. Identify key wins and risks.
4. Emit the final markdown report.

## Principles
- Keep each bullet concise (one line).
- Highlight blockers explicitly.
- Don't pad with filler if the activity log is short.

## Output
Markdown report:
\`\`\`markdown
# Weekly Report — <time_range>

## Done
- ...

## In Progress
- ...

## Blocked
- ...

## Key wins
- ...

## Risks
- ...
\`\`\`

## Output style
Professional, concise, action-oriented. English.`.trim(),
  tools: ['read'],
  preferences: { modelId: 'claude-opus-4-7', providerId: 'anthropic' },
}

const TEMPLATES: AgentTemplate[] = [
  {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Review PRs against team standards. Read-only; never modifies code.',
    profile: CODE_REVIEWER,
  },
  {
    id: 'weekly_reporter',
    name: 'Weekly Reporter',
    description: 'Generate weekly status reports from activity logs.',
    profile: WEEKLY_REPORTER,
  },
]

export function listTemplates(): AgentTemplate[] {
  return TEMPLATES.map((t) => ({ ...t, profile: JSON.parse(JSON.stringify(t.profile)) }))
}
