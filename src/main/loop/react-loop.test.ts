// src/main/loop/react-loop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Module mocks (must be hoisted before imports) ---

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('../ipc/chat-utils', () => ({
  buildStreamSignal: vi.fn((signal: AbortSignal) => signal),
  toolResultPartsToBlocks: vi.fn(() => []),
}))

// Use vi.hoisted so these variables are available inside the vi.mock factories
const { mockMessageCreate, mockSessionTouch, mockStreamText } = vi.hoisted(() => ({
  mockMessageCreate: vi.fn(),
  mockSessionTouch: vi.fn(),
  mockStreamText: vi.fn(),
}))

vi.mock('../repos/session-repo', () => ({
  messageRepo: { create: mockMessageCreate },
  sessionRepo: { touch: mockSessionTouch },
}))

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

// --- Now import the module under test ---
import { runReactLoop } from './react-loop'
import type { ReactLoopOptions } from './types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOpts(overrides: Partial<ReactLoopOptions> = {}): ReactLoopOptions {
  const controller = new AbortController()
  return {
    model: {} as ReactLoopOptions['model'],
    tools: undefined,
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
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runReactLoop — text-only response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls onTextDelta with text and persists assistant message', async () => {
    // Arrange: streamText that fires one text-delta chunk then resolves with no tool calls
    mockStreamText.mockImplementation((params: { onChunk: (arg: { chunk: unknown }) => void }) => {
      // Synchronously invoke the callback so it runs before consumeStream resolves
      params.onChunk({ chunk: { type: 'text-delta', text: 'hello' } })
      return {
        consumeStream: vi.fn().mockResolvedValue(undefined),
        toolResults: Promise.resolve([]),
      }
    })

    const opts = makeOpts()

    // Act
    await runReactLoop(opts)

    // Assert: text delta was forwarded
    expect(opts.callbacks.onTextDelta).toHaveBeenCalledWith('hello')

    // Assert: assistant message was persisted
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
    // Arrange: pre-abort the signal
    const controller = new AbortController()
    controller.abort()

    const opts = makeOpts({ abortSignal: controller.signal })

    // Act
    await runReactLoop(opts)

    // Assert: nothing should have been called
    expect(opts.callbacks.onTextDelta).not.toHaveBeenCalled()
    expect(mockMessageCreate).not.toHaveBeenCalled()
  })
})
