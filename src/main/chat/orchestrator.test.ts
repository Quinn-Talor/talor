import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

const { hoisted } = vi.hoisted(() => ({
  hoisted: {
    validateAttachment: vi.fn(),
    buildUserBlocks: vi.fn(() => [{ type: 'text', text: 'x' }]),
    checkVisionSupport: vi.fn(),
    getDefaultProvider: vi.fn(),
    register: vi.fn(),
    cleanup: vi.fn(),
    getApiKey: vi.fn(),
    createModel: vi.fn(),
    sessionGetById: vi.fn(),
    messageCreate: vi.fn(),
    sessionTouch: vi.fn(),
    buildTools: vi.fn(),
    runReactLoop: vi.fn(),
    resolveProviderConfig: vi.fn(() => ({})),
    configGet: vi.fn(),
    configGetTrace: vi.fn(),
    getLastAssistantText: vi.fn(),
    resolveStreamOptions: vi.fn((_adapter: unknown, _provider: { reasoning?: unknown }) => ({})),
  },
}))

vi.mock('./attachments', () => ({
  validateAttachment: hoisted.validateAttachment,
  buildUserBlocks: hoisted.buildUserBlocks,
  checkVisionSupport: hoisted.checkVisionSupport,
}))

vi.mock('./provider-selector', () => ({
  getDefaultProvider: hoisted.getDefaultProvider,
}))

vi.mock('./stream-registry', () => ({
  streamRegistry: { register: hoisted.register, cleanup: hoisted.cleanup, abort: vi.fn() },
}))

vi.mock('../services/safe-storage', () => ({
  SafeStorageService: { getInstance: () => ({ getApiKey: hoisted.getApiKey }) },
}))

vi.mock('../providers/model-adapter', () => ({
  getAdapter: () => ({
    createModel: hoisted.createModel,
    fetchModels: vi.fn(async () => []),
    buildStreamOptions: vi.fn(() => ({})),
  }),
  // provider.reasoning 未设置时，真实实现直接返回 adapter.buildStreamOptions()（AC-012 回归）；
  // reasoning 翻译本身已在 model-adapter.test.ts 单测覆盖，这里只验证 session 覆盖优先级。
  resolveStreamOptions: hoisted.resolveStreamOptions,
}))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: { getById: hoisted.sessionGetById, touch: hoisted.sessionTouch },
  messageRepo: {
    create: hoisted.messageCreate,
    getLastAssistantText: hoisted.getLastAssistantText,
  },
}))

vi.mock('../loop/react-loop', () => ({
  runReactLoop: hoisted.runReactLoop,
}))

vi.mock('../prompt/PromptPipeline', () => ({
  resolveProviderConfig: hoisted.resolveProviderConfig,
  PromptPipeline: class {
    build() {
      return Promise.resolve({ messages: [], tools: [] })
    }
  },
}))

vi.mock('../memory/MemoryManager', () => ({ MemoryManager: class {} }))

vi.mock('../store/config-store', () => ({
  ConfigStore: {
    getInstance: () => ({ get: hoisted.configGet, getTrace: hoisted.configGetTrace }),
  },
}))

vi.mock('../tools/builtin', () => ({}))

import { sendChat } from './orchestrator'
import { traceRecorder } from '../observe/trace-recorder'
import { traceRepo } from '../repos/trace-repo'
import { DEFAULT_TRACE_CONFIG } from '@shared/types/trace'

const LOOP_RESULT = {
  exitReason: 'no_tool_calls' as const,
  policyExitReason: null,
  totalSteps: 1,
  totalToolCalls: 0,
}

function makeCallbacks() {
  return {
    onTextDelta: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onDone: vi.fn(),
  }
}
function makePorts() {
  return {
    confirmTool: vi.fn(async () => true),
    agentManager: {
      getAgent: vi.fn(() => ({
        id: '__chat__',
        name: 'Talor',
        profile: { id: '__chat__', name: 'Talor', dependencies: { tools: [] } },
        toolRegistry: {
          listTools: () => [],
          getBuiltinTool: () => undefined,
          getToolNames: () => [],
        },
        skillRegistry: { isEmpty: () => true, listDescriptions: () => [] },
      })),
      getChatAgent: vi.fn(() => ({
        id: '__chat__',
        name: 'Talor',
        profile: { id: '__chat__', name: 'Talor', dependencies: { tools: [] } },
        toolRegistry: {
          listTools: () => [],
          getBuiltinTool: () => undefined,
          getToolNames: () => [],
        },
        skillRegistry: { isEmpty: () => true, listDescriptions: () => [] },
      })),
    } as unknown as import('../agent/agent-manager').AgentManager,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getDefaultProvider.mockReturnValue({ id: 'p1', supports_vision: true })
  hoisted.sessionGetById.mockReturnValue({ id: 's1', workspace: '/ws', model_id: 'm1' })
  hoisted.register.mockReturnValue(new AbortController())
  hoisted.createModel.mockReturnValue({})
  hoisted.runReactLoop.mockResolvedValue(LOOP_RESULT)
  hoisted.configGet.mockReturnValue(undefined)
  hoisted.configGetTrace.mockReturnValue({ ...DEFAULT_TRACE_CONFIG })
})

describe('sendChat', () => {
  it('空消息 + 无附件时通过 onDone 回报错，返回 messageId', async () => {
    const cb = makeCallbacks()
    const res = await sendChat({ sessionId: 's1', content: '  ', attachments: [] }, cb, makePorts())
    expect(res.messageId).toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'LLM_ERROR' }),
    )
  })

  it('编排顺序：register → validate → provider → persist user → runReactLoop → onDone', async () => {
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    expect(hoisted.register).toHaveBeenCalled()
    expect(hoisted.getDefaultProvider).toHaveBeenCalled()
    expect(hoisted.messageCreate).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }))
    expect(hoisted.runReactLoop).toHaveBeenCalled()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String))
  })

  it('session.reasoning 覆盖 provider.reasoning（AC-014）', async () => {
    hoisted.getDefaultProvider.mockReturnValue({
      id: 'p1',
      supports_vision: true,
      reasoning: { enabled: true, effort: 'low' },
    })
    hoisted.sessionGetById.mockReturnValue({
      id: 's1',
      workspace: '/ws',
      model_id: 'm1',
      reasoning: { enabled: true, effort: 'high' },
    })
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    const [, providerArg] = hoisted.resolveStreamOptions.mock.calls[0]
    expect(providerArg.reasoning).toEqual({ enabled: true, effort: 'high' })
  })

  it('session 未设置 reasoning → 沿用 provider.reasoning（不触发）', async () => {
    hoisted.getDefaultProvider.mockReturnValue({
      id: 'p1',
      supports_vision: true,
      reasoning: { enabled: true, effort: 'low' },
    })
    hoisted.sessionGetById.mockReturnValue({ id: 's1', workspace: '/ws', model_id: 'm1' })
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    const [, providerArg] = hoisted.resolveStreamOptions.mock.calls[0]
    expect(providerArg.reasoning).toEqual({ enabled: true, effort: 'low' })
  })

  it('附件校验失败 → 错误码映射到 onDone', async () => {
    hoisted.validateAttachment.mockRejectedValue(new Error('FILE_TOO_LARGE'))
    const cb = makeCallbacks()
    await sendChat(
      {
        sessionId: 's1',
        content: 'hi',
        attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }],
      },
      cb,
      makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
    )
    expect(hoisted.runReactLoop).not.toHaveBeenCalled()
  })

  it('视觉不匹配 → PROVIDER_NO_VISION', async () => {
    hoisted.checkVisionSupport.mockImplementation(() => {
      throw new Error('PROVIDER_NO_VISION')
    })
    hoisted.validateAttachment.mockResolvedValue({
      path: '/p',
      mime_type: 'image/png',
      filename: 'a',
      size_bytes: 1,
      base64_data: 'data:image/png;base64,x',
    })
    const cb = makeCallbacks()
    await sendChat(
      {
        sessionId: 's1',
        content: '',
        attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }],
      },
      cb,
      makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'PROVIDER_NO_VISION' }),
    )
  })

  it('成功完成时调用 streamRegistry.cleanup', async () => {
    const cb = makeCallbacks()
    await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    expect(hoisted.cleanup).toHaveBeenCalledWith('s1')
  })

  it('runReactLoop 抛错时通过 onDone 回错，不 throw', async () => {
    hoisted.runReactLoop.mockRejectedValue(new Error('HTTP 429 Too Many Requests'))
    const cb = makeCallbacks()
    await expect(
      sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts()),
    ).resolves.toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: 'RATE_LIMITED' }),
    )
  })
})

describe('sendChat — turn trace（turn-trace AC-021）', () => {
  beforeEach(() => {
    vi.spyOn(traceRepo, 'upsertBatch').mockImplementation(() => {})
    hoisted.getLastAssistantText.mockReturnValue('done')
    vi.spyOn(traceRecorder, 'startTrace')
    vi.spyOn(traceRecorder, 'updateRoot')
    vi.spyOn(traceRecorder, 'endTrace')
    vi.spyOn(traceRecorder, 'addSecret')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AC-021 ①: default config → trace keyed by messageId, root renamed to the agent, ended with the loop result', async () => {
    hoisted.getApiKey.mockReturnValue('sk-live-key-0123456789')
    const cb = makeCallbacks()
    const { messageId } = await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [] },
      cb,
      makePorts(),
    )

    expect(traceRecorder.startTrace).toHaveBeenCalledWith(
      expect.objectContaining({ id: messageId, sessionId: 's1', input: 'hi', name: 'turn' }),
    )
    expect(traceRecorder.updateRoot).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({ name: 'agent:__chat__' }),
    )
    expect(traceRecorder.addSecret).toHaveBeenCalledWith(messageId, 'sk-live-key-0123456789')
    expect(traceRecorder.endTrace).toHaveBeenCalledTimes(1)
    expect(traceRecorder.endTrace).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        output: 'done',
        level: 'DEFAULT',
        metadata: expect.objectContaining({ exit_reason: 'no_tool_calls', total_steps: 1 }),
      }),
    )
    // 本轮输出只取本 session 的 assistant 文本(委托子 session 也带同一 trace_id)
    expect(hoisted.getLastAssistantText).toHaveBeenCalledWith('s1', messageId)
    expect(traceRepo.upsertBatch).toHaveBeenCalled()
    expect(cb.onDone).toHaveBeenCalledWith(messageId)
  })

  it('AC-021 ②: trace disabled → no trace scope, nothing written, chat result unchanged', async () => {
    hoisted.configGetTrace.mockReturnValue({ ...DEFAULT_TRACE_CONFIG, enabled: false })
    const cb = makeCallbacks()
    const res = await sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())

    expect(traceRecorder.startTrace).toHaveReturnedWith(null)
    expect(traceRepo.upsertBatch).not.toHaveBeenCalled()
    expect(res).toEqual({ messageId: res.messageId })
    expect(cb.onDone).toHaveBeenCalledTimes(1)
    expect(cb.onDone.mock.calls[0]).toEqual([res.messageId])
  })

  it('AC-021 ③: runReactLoop throws → trace ends as ERROR with the classified code', async () => {
    hoisted.runReactLoop.mockRejectedValue(new Error('401 Unauthorized'))
    const cb = makeCallbacks()
    const { messageId } = await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [] },
      cb,
      makePorts(),
    )

    expect(traceRecorder.endTrace).toHaveBeenCalledTimes(1)
    expect(traceRecorder.endTrace).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        level: 'ERROR',
        statusMessage: 'AUTH_FAILED: 401 Unauthorized',
        metadata: { error_code: 'AUTH_FAILED' },
      }),
    )
  })

  it('an aborted loop ends the trace as WARNING; an empty API key is not registered as a secret', async () => {
    hoisted.getApiKey.mockReturnValue(null)
    hoisted.runReactLoop.mockResolvedValue({ ...LOOP_RESULT, exitReason: 'abort' })
    const cb = makeCallbacks()
    const { messageId } = await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [] },
      cb,
      makePorts(),
    )

    expect(traceRecorder.addSecret).not.toHaveBeenCalled()
    expect(traceRecorder.endTrace).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({ level: 'WARNING' }),
    )
  })

  it('attachments are summarized (name, type, size) in the trace metadata', async () => {
    // clearAllMocks 不清实现:前面的视觉校验用例会让它保持抛错
    hoisted.checkVisionSupport.mockImplementation(() => {})
    hoisted.validateAttachment.mockResolvedValue({
      path: '/p/chart.png',
      mime_type: 'image/png',
      filename: 'chart.png',
      size_bytes: 2048,
      base64_data: 'data:image/png;base64,x',
    })
    const { messageId } = await sendChat(
      {
        sessionId: 's1',
        content: 'look',
        attachments: [
          { path: '/p/chart.png', mime_type: 'image/png', filename: 'chart.png', size_bytes: 2048 },
        ],
      },
      makeCallbacks(),
      makePorts(),
    )
    expect(traceRecorder.updateRoot).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        metadata: expect.objectContaining({
          attachments: [{ name: 'chart.png', mime_type: 'image/png', size_bytes: 2048 }],
        }),
      }),
    )
  })

  it('(no-trigger) a text-only turn has no attachments entry', async () => {
    const { messageId } = await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [] },
      makeCallbacks(),
      makePorts(),
    )
    const call = vi.mocked(traceRecorder.updateRoot).mock.calls.find((c) => c[0] === messageId)!
    expect(call[1].metadata).not.toHaveProperty('attachments')
  })

  it('a loop that fell back to the forced summary (every model call failed) ends the trace as WARNING', async () => {
    // loop 自己兜底收尾、不抛错 → orchestrator 走成功路径;root 不能记成 DEFAULT
    hoisted.runReactLoop.mockResolvedValue({ ...LOOP_RESULT, exitReason: 'fallback_summary' })
    const cb = makeCallbacks()
    const { messageId } = await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [] },
      cb,
      makePorts(),
    )

    expect(traceRecorder.endTrace).toHaveBeenCalledWith(
      messageId,
      expect.objectContaining({
        level: 'WARNING',
        metadata: expect.objectContaining({ exit_reason: 'fallback_summary' }),
      }),
    )
  })
})
