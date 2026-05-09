import { describe, it, expect, vi } from 'vitest'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { serializeS1History, parseAgentDraft, SNAPSHOT_MAX_CHARS } from './draft-extractor'
import type { ChatMessage } from '../repos/session-repo'
import type { AgentProfile } from '@shared/types/agent'

function msg(
  role: ChatMessage['role'],
  content: unknown,
  agentId: string = '__chat__',
): ChatMessage {
  return {
    id: `m-${Math.random()}`,
    session_id: 'S1',
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    agent_id: agentId,
    created_at: '2026-05-08T00:00:00.000Z',
  }
}

const VALID_PROFILE_JSON = {
  schemaVersion: '1.0',
  identity: {
    id: 'love_letter_writer',
    name: '情感挽回助手',
    description: '基于对话生成挽回语录',
    version: '1.0.0',
  },
  mission: {
    objective: '基于对话生成挽回语录',
    outcomes: [
      {
        id: 'letter_done',
        description: '用户收到结构化的挽回语录',
        priority: 'core',
        verifyBy: [
          {
            type: 'deliverable-present',
            deliverableId: 'letter',
            kind: 'deterministic',
            severity: 'must',
          },
        ],
      },
    ],
  },
  method: { capabilities: ['撰写挽回语录'] },
  delivery: {
    deliverables: [{ id: 'letter', format: 'markdown', mustContain: ['# 挽回'] }],
    acceptance: [
      {
        type: 'deliverable-present',
        deliverableId: 'letter',
        kind: 'deterministic',
        severity: 'must',
      },
    ],
  },
  execution: {
    limits: { maxSteps: 10, maxTokens: 10000 },
    retryPolicy: { maxAttempts: 1, onMustFail: 'abort', onShouldFail: 'mark-only' },
  },
}

describe('serializeS1History (TASK-1, AC-004)', () => {
  it('AC-004 (normal): renders user/assistant/tool with prefixes', () => {
    const messages: ChatMessage[] = [
      msg('user', [{ type: 'text', text: '帮我写一段挽回语录' }]),
      msg('assistant', [
        { type: 'tool_use', toolCallId: 'tc-1', toolName: 'read', input: { path: '/tmp/x' } },
      ]),
      msg('tool', [
        {
          type: 'tool_result',
          toolCallId: 'tc-1',
          toolName: 'read',
          output: { value: 'file contents...' },
        },
      ]),
      msg('assistant', [{ type: 'text', text: '好的，下面是挽回语录...' }]),
    ]
    const result = serializeS1History(messages)
    // D1: 中文专有内容会被脱敏成占位符 / 路径同样脱敏。验证结构而非具体文本。
    expect(result).toContain('**user**:')
    expect(result).toContain('[tool: read(')
    // 路径已被脱敏成 <PATH_*> 占位符
    expect(result).toMatch(/<PATH_\d+>/)
    expect(result).toContain('**assistant**:')
    // 分隔符
    expect(result).toContain('\n\n---\n\n')
    // 原始具体实体已被脱敏（"挽回语录"等会触发 cn-name 实体）
    expect(result).not.toContain('帮我写一段挽回语录')
  })

  it('AC-004 (D1 unredacted variant): serializeS1HistoryRaw preserves original text', async () => {
    const { serializeS1HistoryRaw } = await import('./draft-extractor')
    const messages: ChatMessage[] = [msg('user', [{ type: 'text', text: '帮我写一段挽回语录' }])]
    const result = serializeS1HistoryRaw(messages)
    expect(result).toContain('**user**: 帮我写一段挽回语录')
  })

  it('D1: redacts specific entities (companies / tickers / paths) before crystallizer sees', () => {
    const messages: ChatMessage[] = [
      msg('user', [{ type: 'text', text: '为中际旭创和阿里巴巴写诗' }]),
      msg('assistant', [
        {
          type: 'tool_use',
          toolCallId: 'tc-1',
          toolName: 'read',
          input: { path: '/var/log/x.log' },
        },
      ]),
      msg('user', [{ type: 'text', text: 'Buy BIDU stock' }]),
    ]
    const result = serializeS1History(messages)
    expect(result).not.toContain('中际旭创')
    expect(result).not.toContain('阿里巴巴')
    expect(result).not.toContain('BIDU')
    expect(result).not.toContain('/var/log/x.log')
    expect(result).toMatch(/<COMPANY_/)
    expect(result).toMatch(/<TICKER_/)
    expect(result).toMatch(/<PATH_/)
  })

  it('AC-004 (skip system messages)', () => {
    const messages: ChatMessage[] = [
      msg('system', [{ type: 'text', text: 'You are a helper' }]),
      msg('user', [{ type: 'text', text: 'hi' }]),
    ]
    const result = serializeS1History(messages)
    expect(result).not.toContain('You are a helper')
    expect(result).toContain('**user**: hi')
  })

  it('AC-004 (truncate at SNAPSHOT_MAX_CHARS)', () => {
    const longText = 'a'.repeat(SNAPSHOT_MAX_CHARS + 10_000)
    const messages: ChatMessage[] = [msg('user', [{ type: 'text', text: longText }])]
    const result = serializeS1History(messages)
    expect(result.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS + '\n[...truncated]'.length)
    expect(result.endsWith('[...truncated]')).toBe(true)
  })

  it('content 是 raw string（content_type 不是 blocks）也能工作', () => {
    const messages: ChatMessage[] = [msg('user', 'plain text content')]
    const result = serializeS1History(messages)
    expect(result).toContain('**user**: plain text content')
  })

  it('content 解析失败时用 raw fallback', () => {
    const messages: ChatMessage[] = [msg('user', 'not-valid-json{')]
    const result = serializeS1History(messages)
    expect(result).toContain('**user**: not-valid-json{')
  })

  it('truncate tool_use input 超长时', () => {
    const longInput = { command: 'x'.repeat(500) }
    const messages: ChatMessage[] = [
      msg('assistant', [
        { type: 'tool_use', toolCallId: 'tc', toolName: 'bash', input: longInput },
      ]),
    ]
    const result = serializeS1History(messages)
    // input JSON 截断到 200 字符
    expect(result.length).toBeLessThan(JSON.stringify(longInput).length + 100)
    expect(result).toContain('...')
  })
})

describe('parseAgentDraft (TASK-1, AC-005~008)', () => {
  it('AC-005 (trigger): single fenced ```json``` block parses + validates', () => {
    const text =
      '我提议这样定义：\n' +
      '```json\n' +
      JSON.stringify(VALID_PROFILE_JSON, null, 2) +
      '\n```\n' +
      '请确认。'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(true)
    expect(r.profile?.id).toBe('love-letter-writer')
    expect(r.raw).toBe(text)
  })

  it('AC-006 (no-trigger): no ```json``` block returns valid:false', () => {
    const r = parseAgentDraft('我建议这样：\nid: love-letter-writer\nname: 挽回助手')
    expect(r.valid).toBe(false)
    expect(r.error).toBe('no json code block found')
    expect(r.raw).toBe('我建议这样：\nid: love-letter-writer\nname: 挽回助手')
  })

  it('AC-007 (multiple blocks): pick the LAST valid one', () => {
    const v1 = { ...VALID_PROFILE_JSON, id: 'v1-version' }
    const v2 = { ...VALID_PROFILE_JSON, id: 'v2-final' }
    const text =
      '草稿 v1：\n```json\n' +
      JSON.stringify(v1) +
      '\n```\n用户反馈后修改为：\n```json\n' +
      JSON.stringify(v2) +
      '\n```'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(true)
    expect(r.profile?.id).toBe('v2-final')
  })

  it('AC-007 fallback: last block invalid → fall back to earlier valid block', () => {
    const v1 = { ...VALID_PROFILE_JSON, id: 'v1-good' }
    const text =
      '初版：\n```json\n' +
      JSON.stringify(v1) +
      '\n```\n再试一版：\n```json\n{ "id": "broken", broken JSON\n```'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(true)
    expect(r.profile?.id).toBe('v1-good')
  })

  it('AC-008 (validation fail): valid JSON but missing required field', () => {
    const text = '```json\n{ "id": "x" }\n```'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(false)
    expect(r.error).toMatch(/name|description|version|role|dependencies/)
  })

  it('AC-008 (parse fail): malformed JSON in only block', () => {
    const text = '```json\n{ "id": "x", missing colon "name" "y" }\n```'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('multi-line JSON inside fenced block parses correctly', () => {
    const text =
      'here you go:\n```json\n' +
      `{
  "id": "love-letter-writer",
  "name": "挽回助手",
  "description": "...",
  "version": "1.0.0",
  "role": { "capabilities": ["写"], "outputFormat": "md" },
  "knowledge": { "files": [] },
  "dependencies": { "tools": [], "mcpServers": [], "skills": [], "cli": [] }
}` +
      '\n```'
    const r = parseAgentDraft(text)
    expect(r.valid).toBe(true)
    expect((r.profile as AgentProfile).id).toBe('love-letter-writer')
  })
})
