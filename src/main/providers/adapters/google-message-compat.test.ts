import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateText, type ModelMessage } from 'ai'

vi.mock('electron-log', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('../../services/safe-storage', () => ({
  SafeStorageService: { getInstance: () => ({ getApiKey: () => 'g-key' }) },
}))

import {
  demoteNonLeadingSystemMessages,
  mergeAdjacentUserContents,
  SYSTEM_NOTE_PREFIX,
} from './google-message-compat'
import { googleAdapter } from './google-adapter'
import type { Provider } from '../../store/config-store'

type Prompt = Parameters<typeof demoteNonLeadingSystemMessages>[0]

const sys = (content: string) => ({ role: 'system' as const, content })
const user = (text: string) => ({
  role: 'user' as const,
  content: [{ type: 'text' as const, text }],
})

describe('demoteNonLeadingSystemMessages', () => {
  it('只有前导 system 时原样保留(不触发)', () => {
    const prompt: Prompt = [sys('a'), sys('b'), user('hi')]
    expect(demoteNonLeadingSystemMessages(prompt)).toEqual(prompt)
  })

  it('user 之后的 system → 追加为该 user 的 [system note] 文本 part', () => {
    const out = demoteNonLeadingSystemMessages([sys('a'), user('hi'), sys('meta')])
    expect(out).toEqual([
      sys('a'),
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'text', text: `${SYSTEM_NOTE_PREFIX} meta` },
        ],
      },
    ])
  })

  it('tool 之后的多条 system → 合成一条 user 消息', () => {
    const tool = {
      role: 'tool' as const,
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: 'c1',
          toolName: 'bash',
          output: { type: 'text' as const, value: 'ok' },
        },
      ],
    }
    const out = demoteNonLeadingSystemMessages([sys('a'), user('hi'), tool, sys('m1'), sys('m2')])
    expect(out).toHaveLength(4)
    expect(out[3]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: `${SYSTEM_NOTE_PREFIX} m1` },
        { type: 'text', text: `${SYSTEM_NOTE_PREFIX} m2` },
      ],
    })
  })

  it('note 后紧随真实 user → 并入同一条 user,不产生连续 user', () => {
    const assistant = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'x' }],
    }
    const out = demoteNonLeadingSystemMessages([user('q'), assistant, sys('summary'), user('next')])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[2].content).toEqual([
      { type: 'text', text: `${SYSTEM_NOTE_PREFIX} summary` },
      { type: 'text', text: 'next' },
    ])
  })
})

describe('mergeAdjacentUserContents', () => {
  it('相邻 user 合并为一条多 part content', () => {
    const out = mergeAdjacentUserContents([
      { role: 'model', parts: [{ functionCall: { name: 'bash' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'bash' } }] },
      { role: 'user', parts: [{ text: 'note' }] },
    ])
    expect(out).toEqual([
      { role: 'model', parts: [{ functionCall: { name: 'bash' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'bash' } }, { text: 'note' }] },
    ])
  })

  it('user/model 交替时不变(不触发)', () => {
    const contents = [
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
    ]
    expect(mergeAdjacentUserContents(contents)).toEqual(contents)
  })
})

describe('googleAdapter.createModel — 尾部 system 不再导致 SDK 抛错', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const provider = {
    id: 'g1',
    type: 'google',
    name: 'Gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    models: [],
    enabled: true,
    is_default: false,
    supports_vision: true,
    created_at: '',
    updated_at: '',
  } as Provider

  it('system / tool_use / tool_result / 尾部 system → 请求成功,线格式无连续 user', async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' },
            ],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const model = googleAdapter.createModel(provider, 'google/gemini-2.5-flash')
    const messages: ModelMessage[] = [
      { role: 'system', content: 'constitution' },
      { role: 'user', content: 'list files' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'bash', input: { cmd: 'ls' } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'bash',
            output: { type: 'text', value: 'a.txt' },
          },
        ],
      },
      { role: 'system', content: 'Current date: 2026-10-21' },
    ]

    const res = await generateText({ model, messages, allowSystemInMessages: true })
    expect(res.text).toBe('done')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash',
    )
    const body = JSON.parse(init!.body as string) as {
      systemInstruction?: { parts: Array<{ text: string }> }
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>
    }
    expect(body.systemInstruction?.parts.map((p) => p.text)).toEqual(['constitution'])
    expect(body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    const last = body.contents[2].parts
    expect(last[0]).toHaveProperty('functionResponse')
    expect(last[last.length - 1]).toEqual({
      text: `${SYSTEM_NOTE_PREFIX} Current date: 2026-10-21`,
    })
  })
})
