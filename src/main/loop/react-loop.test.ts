// src/main/loop/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('./stream-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
}))

const { mockMessageCreate, mockSessionTouch, mockStreamText, mockBuildTools } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockSessionTouch: vi.fn(),
  mockStreamText: vi.fn(),
  mockBuildTools: vi.fn(),
}))

vi.mock('../repos/session-repo', () => ({
  messageRepo: { create: mockMessageCreate },
  sessionRepo: { touch: mockSessionTouch },
}))

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

vi.mock('../tools/build-tools', () => ({
  buildTools: (...args: unknown[]) => mockBuildTools(...args),
}))

import { runReactLoop } from './react-loop'
import type { ReactLoopOptions } from './types'

function makeOpts(overrides: Partial<ReactLoopOptions> = {}): ReactLoopOptions {
  const controller = new AbortController()
  return {
    model: {} as ReactLoopOptions['model'],
    sessionId: 'session-1',
    messageId: 'msg-1',
    userContent: 'hello',
    mappedAttachments: [],
    abortSignal: controller.signal,
    pipeline: {
      build: vi.fn().mockResolvedValue({ messages: [{ role: 'user', content: 'hello' }], tools: [] }),
    } as unknown as ReactLoopOptions['pipeline'],
    provider: { id: 'p1' } as ReactLoopOptions['provider'],
    providerConfig: {} as ReactLoopOptions['providerConfig'],
    workspace: '/tmp',
    callbacks: {
      onTextDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
    },
    maxSteps: 5,
    agent: {
      id: '__chat__',
      toolRegistry: { listTools: () => [], execute: vi.fn() },
    } as unknown as ReactLoopOptions['agent'],
    confirmTool: vi.fn(async () => true),
    ...overrides,
  }
}

describe('runReactLoop — text-only response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildTools.mockResolvedValue(undefined)
  })

  it('calls onTextDelta with text and persists assistant message', async () => {
    mockStreamText.mockImplementation((params: { onChunk: (arg: { chunk: unknown }) => void }) => {
      params.onChunk({ chunk: { type: 'text-delta', text: 'hello' } })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([]),
      }
    })

    const opts = makeOpts()
    await runReactLoop(opts)

    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello')
    expect(mockMessageCreate).toHaveBeenCalled()
    const createCall = mockMessageCreate.mock.calls[0][0]
    expect(createCall.role).toBe('assistant')
  })
})

describe('runReactLoop — abort before loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not call onTextDelta or messageRepo.create when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const opts = makeOpts({ abortSignal: controller.signal })
    await runReactLoop(opts)

    expect(opts.callbacks.onTextDelta).not.toHaveBeenCalled()
    expect(mockMessageCreate).not.toHaveBeenCalled()
  })
})
