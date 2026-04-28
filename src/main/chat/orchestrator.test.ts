import { describe, it, expect, vi, beforeEach } from 'vitest'

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

vi.mock('../providers/llm-provider', () => ({
  createModel: hoisted.createModel,
}))

vi.mock('../repos/session-repo', () => ({
  sessionRepo: { getById: hoisted.sessionGetById, touch: hoisted.sessionTouch },
  messageRepo: { create: hoisted.messageCreate },
}))

vi.mock('../loop/react-loop', () => ({
  runReactLoop: hoisted.runReactLoop,
}))

vi.mock('../prompt/PromptPipeline', () => ({
  resolveProviderConfig: hoisted.resolveProviderConfig,
  PromptPipeline: class { build() { return Promise.resolve({ messages: [], tools: [] }) } },
}))

vi.mock('../memory/MemoryManager', () => ({ MemoryManager: class {} }))

vi.mock('../store/config-store', () => ({
  ConfigStore: { getInstance: () => ({ get: hoisted.configGet }) },
}))

vi.mock('../tools/builtin', () => ({}))

import { sendChat } from './orchestrator'

function makeCallbacks() {
  return {
    onTextDelta: vi.fn(), onToolCall: vi.fn(), onToolResult: vi.fn(), onDone: vi.fn(),
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
        toolRegistry: { listTools: () => [], getBuiltinTool: () => undefined, getToolNames: () => [] },
        skillRegistry: { isEmpty: () => true, listDescriptions: () => [] },
      })),
      getChatAgent: vi.fn(() => ({
        id: '__chat__',
        name: 'Talor',
        profile: { id: '__chat__', name: 'Talor', dependencies: { tools: [] } },
        toolRegistry: { listTools: () => [], getBuiltinTool: () => undefined, getToolNames: () => [] },
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
  hoisted.runReactLoop.mockResolvedValue(undefined)
  hoisted.configGet.mockReturnValue(undefined)
})

describe('sendChat', () => {
  it('空消息 + 无附件时通过 onDone 回报错，返回 messageId', async () => {
    const cb = makeCallbacks()
    const res = await sendChat({ sessionId: 's1', content: '  ', attachments: [] }, cb, makePorts())
    expect(res.messageId).toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'LLM_ERROR' }))
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

  it('附件校验失败 → 错误码映射到 onDone', async () => {
    hoisted.validateAttachment.mockRejectedValue(new Error('FILE_TOO_LARGE'))
    const cb = makeCallbacks()
    await sendChat(
      { sessionId: 's1', content: 'hi', attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }] },
      cb, makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'FILE_TOO_LARGE' }))
    expect(hoisted.runReactLoop).not.toHaveBeenCalled()
  })

  it('视觉不匹配 → PROVIDER_NO_VISION', async () => {
    hoisted.checkVisionSupport.mockImplementation(() => { throw new Error('PROVIDER_NO_VISION') })
    hoisted.validateAttachment.mockResolvedValue({
      path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1, base64_data: 'data:image/png;base64,x',
    })
    const cb = makeCallbacks()
    await sendChat(
      { sessionId: 's1', content: '', attachments: [{ path: '/p', mime_type: 'image/png', filename: 'a', size_bytes: 1 }] },
      cb, makePorts(),
    )
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'PROVIDER_NO_VISION' }))
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
      sendChat({ sessionId: 's1', content: 'hi', attachments: [] }, cb, makePorts())
    ).resolves.toBeTruthy()
    expect(cb.onDone).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ code: 'RATE_LIMITED' }))
  })
})
