// 守护测试:可缓存稳定层跨 build 必须字节一致(append-only 设计的核心不变量)。
//
// 任何混进稳定层(system/agent/tools/history)的"每轮会变"内容——毫秒时间戳、
// 随机数、自增计数——都会让本测试失败。历史上 SystemPlugin 里的 `Current time`
// 毫秒戳就是这类:它把 deepseek 前缀缓存命中率从 ~99% 打到 ~14%。
// 易变内容必须归 RuntimeMetaPlugin / MessagePlugin 等 volatile 尾部。

import { describe, it, expect } from 'vitest'
import { SystemPlugin } from './plugins/SystemPlugin'
import { UiBlockPlugin } from './plugins/UiBlockPlugin'
import { RuntimeMetaPlugin } from './plugins/RuntimeMetaPlugin'
import type { PipelineContext } from './types'

function makeCtx(): PipelineContext {
  return {
    sessionId: 's1',
    currentMessage: { text: 'hi' },
    provider: { id: 'p1' } as PipelineContext['provider'],
    providerConfig: {} as PipelineContext['providerConfig'],
    workspacePath: '/tmp/ws',
  }
}

const flatten = (r: { messages: Array<{ content: unknown }> }) =>
  r.messages.map((m) => JSON.stringify(m.content)).join('|')

describe('prompt 缓存稳定性(append-only 守护)', () => {
  it('SystemPlugin(system 层)跨两次 build 字节一致', async () => {
    const a = await new SystemPlugin().build(makeCtx())
    const b = await new SystemPlugin().build(makeCtx())
    expect(flatten(a)).toBe(flatten(b))
  })

  it('UiBlockPlugin(agent 层)跨两次 build 字节一致', async () => {
    const a = await new UiBlockPlugin().build(makeCtx())
    const b = await new UiBlockPlugin().build(makeCtx())
    expect(flatten(a)).toBe(flatten(b))
  })

  it('易变内容(运行时元)归 volatile 层,不在稳定层', () => {
    expect(new RuntimeMetaPlugin().layer).toBe('volatile')
    expect(new SystemPlugin().layer).toBe('system')
    expect(new UiBlockPlugin().layer).toBe('agent')
  })
})
