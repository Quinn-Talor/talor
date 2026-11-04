import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const { metadata, sessions } = vi.hoisted(() => ({
  metadata: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, { agent_id: string }>(),
}))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: {
    getMetadata: (id: string) => metadata.get(id) ?? {},
    getById: (id: string) => sessions.get(id) ?? null,
    touch: vi.fn(),
    addUsage: vi.fn(),
  },
}))

import type { RunEvent, RunSummary } from 'agent-engine'
import { phaseMarker } from '@shared/turn-phase'
import { createProjection } from './projection'
import {
  INTERRUPTED_NOTE,
  clearRowCache,
  createTurnFold,
  rowsOfRun,
  sessionRows,
  userContentOf,
} from './turn-rows'

const wrap = (body: string) => `<tool_output>\n${body}\n</tool_output>`

/** 一组运行的事件与 blob；read 计数。 */
function fakeArchive(runs: Record<string, RunEvent[]>, blobs: Record<string, string>) {
  const reads: string[] = []
  return {
    reads,
    async *read(runId: string) {
      reads.push(runId)
      for (const e of runs[runId] ?? []) yield e
    },
    async getBlob(ref: string) {
      if (!(ref in blobs)) throw new Error(`no blob ${ref}`)
      return blobs[ref]!
    },
    async query(filter: { session?: string }) {
      return Object.keys(runs)
        .map(
          (runId, i) => ({ runId, turn: i + 1, session: filter.session }) as unknown as RunSummary,
        )
        .reverse()
    },
  }
}

let seq = 0
const ev = (body: Record<string, unknown>) =>
  ({ seq: ++seq, at: 1_000 * seq, ...body }) as unknown as RunEvent

const startedEv = (content: string) =>
  ev({ t: 'run_started', task: { fingerprint: 'f', subject: 's1', content, goal: 'goal' } })
const responded = (step: number, text: string, calls: Array<{ id: string; name: string }> = []) =>
  ev({
    t: 'model_responded',
    step,
    response: {
      text,
      toolCalls: calls.map((c) => ({ ...c, input: {} })),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  })
const finished = (callId: string, shown: string) =>
  ev({ t: 'tool_finished', callId, shown, isError: false, durationMs: 1 })
const evaluated = (step: number, verdict: Record<string, unknown>) =>
  ev({ t: 'evaluated', step, verdict: { ...verdict, sources: [] } })
const stepEnded = (step: number) => ev({ t: 'step_ended', step })
const delivered = (step: number) => ev({ t: 'delivery_checked', step, outcome: 'delivered' })
const ended = (status = 'completed', code?: string) =>
  ev({ t: 'run_ended', result: { status, ...(code ? { code } : {}) } })

const input = (...segments: unknown[][]) =>
  JSON.stringify({ input: segments.map((parts) => ({ role: 'user', parts })) })

/** 一轮：第 1 步调 read，第 2 步答复并通过交付。 */
function readThenAnswer() {
  seq = 0
  return [
    startedEv('in'),
    responded(1, '先看看', [{ id: 'c1', name: 'read' }]),
    evaluated(1, { continue: {} }),
    finished('c1', 'out'),
    stepEnded(1),
    responded(2, '答复'),
    evaluated(2, { complete: true }),
    stepEnded(2),
    delivered(2),
    ended(),
  ]
}

const BLOBS = { in: input([{ type: 'text', text: '帮我看看' }]), out: wrap('file body') }

beforeEach(() => {
  clearRowCache()
  metadata.clear()
  sessions.clear()
})

describe('createTurnFold / rowsOfRun', () => {
  it('AC-001 folds a run into user, step and tool rows with stable ids and event times', async () => {
    const archive = fakeArchive({ r1: readThenAnswer() }, BLOBS)
    const rows = await rowsOfRun(archive, { runId: 'r1', sessionId: 's1', agentId: '__chat__' })

    expect(rows.map((r) => [r.id, r.role])).toEqual([
      ['r1:u', 'user'],
      ['r1:s1:a', 'assistant'],
      ['r1:s1:t', 'tool'],
      ['r1:s2:a', 'assistant'],
    ])
    expect(rows.every((r) => r.trace_id === 'r1' && r.session_id === 's1')).toBe(true)
    expect(JSON.parse(rows[0]!.content)).toBe('帮我看看')
    expect(rows[0]!.created_at).toBe(new Date(1_000).toISOString())
    expect(JSON.parse(rows[1]!.content)).toEqual([
      { type: 'text', text: '先看看', providerOptions: phaseMarker('process') },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'read',
        input: {},
        providerOptions: phaseMarker('process'),
      },
    ])
    expect(JSON.parse(rows[2]!.content)).toEqual([
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'read',
        output: { type: 'text', value: wrap('file body') },
        isError: false,
      },
    ])
    expect(JSON.parse(rows[3]!.content)).toEqual([
      { type: 'text', text: '答复', providerOptions: phaseMarker('answer') },
    ])
    // 第 2 步在交付结果到达时折叠
    expect(rows[3]!.created_at).toBe(new Date(9_000).toISOString())
  })

  it('AC-002 gives the same rows live through the projection as read back from the archive', async () => {
    const events = readThenAnswer()
    const persisted: number[] = []
    const projection = createProjection({
      sessionId: 's1',
      messageId: 'r1',
      agentId: '__chat__',
      callbacks: {
        onTextDelta: vi.fn(),
        onToolCall: vi.fn(),
        onToolResult: vi.fn(),
        onDone: vi.fn(),
        onMessagePersisted: (_s, step) => void persisted.push(step),
      },
      getBlob: async (ref) => BLOBS[ref as keyof typeof BLOBS],
    })
    for (const e of events) await projection.subscriber.onEvent?.(e, { runId: 'r1' })
    await projection.idle()

    const archive = fakeArchive({ r1: events }, BLOBS)
    const read = await rowsOfRun(archive, { runId: 'r1', sessionId: 's1', agentId: '__chat__' })
    expect(projection.fold().rows()).toEqual(read)
    expect(persisted).toEqual([1, 2])
  })

  it('AC-003 adds an interrupted notice only for runs cut off by quitting', async () => {
    seq = 0
    const cut = [startedEv('in'), responded(1, '写到一半'), ended('aborted', 'interrupted')]
    seq = 0
    const stopped = [startedEv('in'), responded(1, '写到一半'), ended('aborted', 'user')]
    const archive = fakeArchive({ cut, stopped }, BLOBS)

    const cutRows = await rowsOfRun(archive, { runId: 'cut', sessionId: 's1', agentId: 'a' })
    expect(cutRows.at(-1)).toMatchObject({
      id: 'cut:notice',
      role: 'assistant',
      content_type: 'notice',
    })
    expect(JSON.parse(cutRows.at(-1)!.content)).toEqual([{ type: 'text', text: INTERRUPTED_NOTE }])
    const stoppedRows = await rowsOfRun(archive, {
      runId: 'stopped',
      sessionId: 's1',
      agentId: 'a',
    })
    expect(stoppedRows.some((r) => r.content_type === 'notice')).toBe(false)
  })

  it('AC-004 cuts tool results over 2000 characters in preview mode only', async () => {
    const run = (shown: string) => {
      seq = 0
      return [
        startedEv('in'),
        responded(1, '', [{ id: 'c1', name: 'read' }]),
        finished('c1', shown),
        stepEnded(1),
        ended(),
      ]
    }
    const archive = fakeArchive(
      { long: run('long'), edge: run('edge') },
      { ...BLOBS, long: wrap('a'.repeat(2001)), edge: wrap('b'.repeat(2000)) },
    )
    const toolText = async (runId: string, full?: boolean) => {
      const rows = await rowsOfRun(archive, {
        runId,
        sessionId: 's1',
        agentId: 'a',
        ...(full ? { full } : {}),
      })
      const [part] = JSON.parse(rows.find((r) => r.role === 'tool')!.content) as Array<{
        output: { value: string }
      }>
      return part!.output.value
    }

    expect(await toolText('long')).toBe(wrap(`${'a'.repeat(2000)}\n…[已截断，共 2001 字]`))
    expect(await toolText('edge')).toBe(wrap('b'.repeat(2000)))
    expect(await toolText('long', true)).toBe(wrap('a'.repeat(2001)))
  })

  it('AC-005 takes the user row from the last input segment only', async () => {
    seq = 0
    const both = [startedEv('two'), ended()]
    const archive = fakeArchive(
      { both },
      {
        two: input(
          [{ type: 'text', text: '源对话快照' }],
          [
            { type: 'text', text: '看图' },
            { type: 'image', image: 'iVBOR', mediaType: 'image/png' },
          ],
        ),
      },
    )
    const [user] = await rowsOfRun(archive, { runId: 'both', sessionId: 's1', agentId: 'a' })
    expect(JSON.parse(user!.content)).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', image: 'iVBOR' },
    ])
    expect(userContentOf([{ type: 'text', text: 'hi' }])).toBe('hi')
    expect(userContentOf([{ type: 'file', data: 'JVBER', mediaType: 'application/pdf' }])).toEqual([
      { type: 'file', data: 'JVBER', mediaType: 'application/pdf' },
    ])
  })

  it('keeps the rest of a run when one tool result cannot be read', async () => {
    seq = 0
    const events = [
      startedEv('in'),
      responded(1, '', [{ id: 'c1', name: 'read' }]),
      finished('c1', 'gone'),
      stepEnded(1),
      ended(),
    ]
    const rows = await rowsOfRun(fakeArchive({ r: events }, BLOBS), {
      runId: 'r',
      sessionId: 's1',
      agentId: 'a',
    })
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant', 'tool'])
    expect(rows[2]!.content).toContain('读不到这次调用的结果正文')
  })

  it('AC-009 reads an ended run once and never caches a run in progress', async () => {
    const events = readThenAnswer()
    const archive = fakeArchive({ done: events, open: events.slice(0, 5) }, BLOBS)
    const opts = { sessionId: 's1', agentId: 'a' }

    const first = await rowsOfRun(archive, { runId: 'done', ...opts })
    expect(await rowsOfRun(archive, { runId: 'done', ...opts })).toBe(first)
    await rowsOfRun(archive, { runId: 'open', ...opts })
    await rowsOfRun(archive, { runId: 'open', ...opts })

    expect(archive.reads).toEqual(['done', 'open', 'open'])
  })

  it('folds the fallback text as an answer row', async () => {
    seq = 0
    const events = [
      startedEv('in'),
      responded(1, 'step one'),
      stepEnded(1),
      ev({ t: 'fallback_generated', code: 'max_steps', text: '总结', degradation: 1 }),
      ended('finalized', 'max_steps'),
    ]
    const fold = createTurnFold({
      sessionId: 's1',
      runId: 'r',
      agentId: 'a',
      getBlob: async (ref) => BLOBS[ref as keyof typeof BLOBS],
    })
    const folded: number[][] = []
    for (const e of events) folded.push(await fold.apply(e))
    expect(folded[3]).toEqual([2])
    expect(fold.rows().at(-1)).toMatchObject({ id: 'r:fallback', role: 'assistant' })
  })
})

describe('sessionRows', () => {
  /** n 轮，每轮一条用户行与一条答复。 */
  function turns(n: number) {
    const runs: Record<string, RunEvent[]> = {}
    const blobs: Record<string, string> = {}
    for (let i = 1; i <= n; i++) {
      seq = 0
      blobs[`in${i}`] = input([{ type: 'text', text: `问题 ${i}` }])
      runs[`t${i}`] = [startedEv(`in${i}`), responded(1, `答 ${i}`), stepEnded(1), ended()]
    }
    return fakeArchive(runs, blobs)
  }
  const turnOf = (rows: Array<{ trace_id?: string }>) => [
    ...new Set(rows.map((r) => Number(r.trace_id?.slice(1)))),
  ]

  it('AC-010 pages a long session by 20 turns from the newest', async () => {
    const archive = turns(45)

    const latest = await sessionRows(archive, 's1')
    expect(turnOf(latest.messages)).toEqual(Array.from({ length: 20 }, (_, i) => 26 + i))
    expect(latest.hasMore).toBe(true)

    const middle = await sessionRows(archive, 's1', { before: 't26' })
    expect(turnOf(middle.messages)).toEqual(Array.from({ length: 20 }, (_, i) => 6 + i))
    expect(middle.hasMore).toBe(true)

    const oldest = await sessionRows(archive, 's1', { before: 't6' })
    expect(turnOf(oldest.messages)).toEqual([1, 2, 3, 4, 5])
    expect(oldest.hasMore).toBe(false)

    expect(await sessionRows(archive, 's1', { before: 'missing' })).toEqual({
      messages: [],
      hasMore: false,
    })
  })

  it('places notices before the turn after them, and at the end when they follow the last turn', async () => {
    const archive = turns(2)
    metadata.set('wb', {
      notices: [
        { id: 'n0', afterTurn: 0, role: 'user', text: '快照' },
        { id: 'n1', afterTurn: 1, role: 'assistant', text: '更新' },
        { id: 'n2', afterTurn: 2, role: 'assistant', text: '末尾' },
        { id: 'bad', afterTurn: 'x' },
      ],
    })
    sessions.set('wb', { agent_id: '__crystallizer__' })

    const { messages } = await sessionRows(archive, 'wb')
    expect(messages.map((m) => m.id)).toEqual([
      'n0',
      't1:u',
      't1:s1:a',
      'n1',
      't2:u',
      't2:s1:a',
      'n2',
    ])
    expect(messages[0]).toMatchObject({
      role: 'user',
      content_type: 'notice',
      agent_id: '__crystallizer__',
    })

    // 没有任何轮时只返回提示行
    expect((await sessionRows(fakeArchive({}, {}), 'wb')).messages.map((m) => m.id)).toEqual([
      'n0',
      'n1',
      'n2',
    ])
  })
})
