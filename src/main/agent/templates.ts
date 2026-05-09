// src/main/agent/templates.ts — 业务层：内置 agent 模板库
//
// IPC `agents:list-templates` 返回。用户从模板复制后可改 identity.id 保存。
//
// 允许依赖: shared/*
// 禁止依赖: ipc/*

import type { AgentProfile } from '@shared/types/agent'

export interface AgentTemplate {
  id: string
  name: string
  description: string
  /** 模板 profile (符合 schema 1.0). */
  profile: AgentProfile
}

const CODE_REVIEWER: AgentProfile = {
  schemaVersion: '1.0',
  identity: {
    id: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews PRs against team coding standards.',
    version: '1.0.0',
  },
  mission: {
    objective: 'Produce a structured PR review aligned with team standards.',
    outcomes: [
      {
        id: 'review_done',
        description: 'User receives a structured review report classified by severity',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'review_report',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
    inputs: [
      {
        id: 'pr_url_or_diff',
        description: 'Pull request URL or raw diff to review',
        type: 'text',
        required: true,
        examples: ['https://github.com/org/repo/pull/123'],
      },
    ],
  },
  method: {
    capabilities: [
      'Apply project standards to a diff and produce structured review findings',
      'Cross-reference patterns from codebase',
      'Classify findings by severity (blocker / major / minor / nit)',
    ],
    tools: [
      { name: 'read', required: true, purpose: 'Load source + standards' },
      { name: 'grep', required: true, purpose: 'Find usages and prior art' },
      { name: 'glob', required: true, purpose: 'Locate related files' },
      { name: 'bash', disabled: true, purpose: 'Reviewer never executes — explicit disable' },
      { name: 'write', disabled: true, purpose: 'Reviewer never modifies code' },
      { name: 'edit', disabled: true, purpose: 'Reviewer never modifies code' },
    ],
    workflow: {
      steps: [
        {
          id: 'load_context',
          description: 'Load standards, patterns, and the diff',
          tools: ['read', 'bash'],
          inputs: ['user-input'],
          produces: 'context_loaded',
        },
        {
          id: 'analyze',
          description: 'Walk the diff and classify findings against rules',
          tools: ['read', 'grep'],
          inputs: ['context_loaded'],
          produces: 'findings_list',
          requires: ['load_context'],
        },
        {
          id: 'report',
          description: 'Emit final review report',
          inputs: ['findings_list'],
          produces: 'review_report',
          requires: ['analyze'],
        },
      ],
    },
    personality: 'Concise, direct, evidence-based. Cite rule references for blockers.',
    language: 'en',
  },
  delivery: {
    deliverables: [
      {
        id: 'review_report',
        format: 'json',
        schema: {
          type: 'object',
          required: ['summary', 'findings'],
          properties: {
            summary: { type: 'string' },
            verdict: { enum: ['approve', 'request-changes', 'comment'] },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                required: ['file', 'line', 'severity', 'issue'],
                properties: {
                  file: { type: 'string' },
                  line: { type: 'integer' },
                  severity: { enum: ['blocker', 'major', 'minor', 'nit'] },
                  issue: { type: 'string' },
                  suggestion: { type: 'string' },
                },
              },
            },
          },
        },
        extractFrom: { type: 'json-fenced-block', firstOrLast: 'last' },
        rubric: [
          '✓ Each finding cites a specific line range',
          "✗ Don't list style nits if there are blockers (focus signal)",
          "✗ Don't propose code rewrites — one-line suggestions only",
        ],
        trigger: 'after analyze step completes',
        required: true,
      },
    ],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'review_report',
        kind: 'deterministic',
        severity: 'must',
      },
      {
        type: 'tool-was-used',
        toolName: 'read',
        kind: 'deterministic',
        severity: 'must',
      },
      {
        type: 'tool-not-used',
        toolName: 'write',
        kind: 'deterministic',
        severity: 'must',
      },
      {
        type: 'tool-not-used',
        toolName: 'edit',
        kind: 'deterministic',
        severity: 'must',
      },
    ],
  },
  execution: {
    limits: { maxSteps: 30, maxTokens: 200000 },
    retryPolicy: {
      maxAttempts: 2,
      onMustFail: 'retry-then-mark',
      onShouldFail: 'mark-only',
    },
  },
  preferences: {
    modelId: 'claude-opus-4-7',
    providerId: 'anthropic',
  },
}

const WEEKLY_REPORTER: AgentProfile = {
  schemaVersion: '1.0',
  identity: {
    id: 'weekly_reporter',
    name: 'Weekly Reporter',
    description: 'Generates weekly status reports from a list of activities.',
    version: '1.0.0',
  },
  mission: {
    objective: 'Generate a structured weekly status report from user-provided activities.',
    outcomes: [
      {
        id: 'report_done',
        description: 'User receives a markdown weekly report with sections',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'weekly_report',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
    inputs: [
      {
        id: 'time_range',
        description: 'Date range covered by the report',
        type: 'text',
        required: true,
        examples: ['2026-04-29 to 2026-05-05'],
      },
      {
        id: 'activities',
        description: 'List of activities or pointers (file/url) where activity log lives',
        type: 'text',
        required: true,
      },
    ],
  },
  method: {
    capabilities: [
      'Compose markdown weekly status report',
      'Categorize activities into Done / In-Progress / Blocked sections',
      'Highlight key wins and risks',
    ],
    tools: [{ name: 'read', required: false, purpose: 'Read activity logs from files' }],
    personality: 'Professional, concise, action-oriented.',
    language: 'en',
  },
  delivery: {
    deliverables: [
      {
        id: 'weekly_report',
        format: 'markdown',
        mustContain: ['# Weekly Report', '## Done', '## In Progress'],
        rubric: [
          '✓ Each section uses bullets',
          '✓ Wins and risks called out separately',
          "✗ Don't pad with filler if activity log is short",
        ],
        required: true,
      },
    ],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'weekly_report',
        kind: 'deterministic',
        severity: 'must',
      },
    ],
  },
  execution: {
    limits: { maxSteps: 15, maxTokens: 50000 },
    retryPolicy: {
      maxAttempts: 2,
      onMustFail: 'retry-then-mark',
      onShouldFail: 'mark-only',
    },
  },
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
