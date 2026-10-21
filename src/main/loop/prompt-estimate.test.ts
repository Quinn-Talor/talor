import { describe, it, expect } from 'vitest'
import type { ModelMessage } from 'ai'
import { estimate } from '../memory/types'
import {
  MEDIA_PART_TOKENS,
  estimatePartTokens,
  estimateMessageTokens,
  estimatePromptTokens,
  calibratedContextEstimate,
} from './prompt-estimate'

const BIG_BASE64 = 'data:image/png;base64,' + 'A'.repeat(1_500_000)

describe('estimatePartTokens — 媒体 part 固定计数', () => {
  it('image part 不论 base64 多大都按固定 token 计', () => {
    expect(estimatePartTokens({ type: 'image', image: BIG_BASE64 })).toBe(MEDIA_PART_TOKENS)
  })

  it('file part (PDF) 按固定 token 计', () => {
    expect(
      estimatePartTokens({ type: 'file', data: BIG_BASE64, mediaType: 'application/pdf' }),
    ).toBe(MEDIA_PART_TOKENS)
  })

  it('tool-result 的 content 输出里的媒体项按固定 token 计, 文本项按文本', () => {
    const tokens = estimatePartTokens({
      type: 'tool-result',
      toolCallId: 'c',
      toolName: 'screenshot',
      output: {
        type: 'content',
        value: [
          { type: 'text', text: 'captured' },
          { type: 'image-data', data: 'A'.repeat(1_000_000), mediaType: 'image/png' },
        ],
      },
    })
    expect(tokens).toBe(estimate('captured') + MEDIA_PART_TOKENS)
  })

  it('(不触发) 文本 / 推理 / 工具结果文本照常按字符估算', () => {
    expect(estimatePartTokens({ type: 'text', text: 'hello world' })).toBe(estimate('hello world'))
    expect(estimatePartTokens({ type: 'reasoning', text: 'think' })).toBe(estimate('think'))
    expect(
      estimatePartTokens({
        type: 'tool-result',
        toolCallId: 'c',
        toolName: 'read',
        output: { type: 'text', value: 'x'.repeat(400) },
      }),
    ).toBe(estimate('x'.repeat(400)))
    expect(
      estimatePartTokens({ type: 'tool-call', toolCallId: 'c', toolName: 'r', input: { a: 1 } }),
    ).toBe(estimate(JSON.stringify({ a: 1 })))
  })
})

describe('estimateMessageTokens / estimatePromptTokens', () => {
  it('含 1.5MB 截图的消息估算远小于把 base64 当文本', () => {
    const m: ModelMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'what is this' },
        { type: 'image', image: BIG_BASE64 },
      ],
    }
    expect(estimateMessageTokens(m)).toBe(estimate('what is this') + MEDIA_PART_TOKENS)
  })

  it('字符串 content 与工具定义照常计入', () => {
    const tools = [{ name: 't', description: 'd' }] as never
    expect(estimatePromptTokens([{ role: 'user', content: 'hello' }], tools)).toBe(
      estimate('hello') + estimate(JSON.stringify(tools)),
    )
  })
})

describe('calibratedContextEstimate', () => {
  it('按上次实际/估算比例缩放', () => {
    expect(calibratedContextEstimate(100, { inputTokens: 150, promptEstimate: 100 })).toBe(150)
  })

  it('(不触发) 无上次实际值 → 原估算', () => {
    expect(calibratedContextEstimate(100, {})).toBe(100)
  })

  it('比例夹在 [0.5, 2]', () => {
    expect(calibratedContextEstimate(100, { inputTokens: 1000, promptEstimate: 100 })).toBe(200)
    expect(calibratedContextEstimate(100, { inputTokens: 10, promptEstimate: 100 })).toBe(50)
  })
})
