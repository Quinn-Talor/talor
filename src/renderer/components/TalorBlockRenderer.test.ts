// 纯函数 splitMessageWithTalorBlocks 的单元测试。组件渲染部分留给 e2e (Playwright)
// 覆盖 — 单测只保护切片逻辑 + 解析降级路径。

import { describe, it, expect } from 'vitest'
import { splitMessageWithTalorBlocks } from './TalorBlockRenderer'

describe('splitMessageWithTalorBlocks', () => {
  it('纯文本 → 单 markdown 段', () => {
    const segs = splitMessageWithTalorBlocks('Hello world')
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('markdown')
    expect(segs[0].content).toBe('Hello world')
  })

  it('空字符串 → 单空 markdown 段', () => {
    const segs = splitMessageWithTalorBlocks('')
    expect(segs).toHaveLength(1)
    expect(segs[0].type).toBe('markdown')
    expect(segs[0].content).toBe('')
  })

  it('单个 done block → 1 markdown(可空) + 1 talor', () => {
    const text = '```talor\n{"type":"done","summary":"ok"}\n```'
    const segs = splitMessageWithTalorBlocks(text)
    const talorSegs = segs.filter((s) => s.type === 'talor')
    expect(talorSegs).toHaveLength(1)
    expect(talorSegs[0].block?.type).toBe('done')
  })

  it('block 前后有 markdown → 三段交替', () => {
    const text = 'before\n\n```talor\n{"type":"done","summary":"ok"}\n```\n\nafter'
    const segs = splitMessageWithTalorBlocks(text)
    expect(segs).toHaveLength(3)
    expect(segs[0].type).toBe('markdown')
    expect(segs[0].content).toContain('before')
    expect(segs[1].type).toBe('talor')
    expect(segs[2].type).toBe('markdown')
    expect(segs[2].content).toContain('after')
  })

  it('两个 talor block → 两个 talor 段', () => {
    const text =
      '```talor\n{"type":"done","summary":"a"}\n```\n\n' +
      '```talor\n{"type":"warning","message":"b"}\n```'
    const segs = splitMessageWithTalorBlocks(text)
    const talorSegs = segs.filter((s) => s.type === 'talor')
    expect(talorSegs).toHaveLength(2)
    expect(talorSegs[0].block?.type).toBe('done')
    expect(talorSegs[1].block?.type).toBe('warning')
  })

  it('解析失败的 talor block → invalid-talor 段', () => {
    const text = '```talor\n{not valid json at all\n```'
    const segs = splitMessageWithTalorBlocks(text)
    const invalidSegs = segs.filter((s) => s.type === 'invalid-talor')
    expect(invalidSegs).toHaveLength(1)
    // 原始 fence 文本保留供降级渲染
    expect(invalidSegs[0].content).toContain('not valid json')
  })

  it('未闭合 fence → streaming-talor 段, type 已知', () => {
    const text = 'streaming\n\n```talor\n{"type":"done","summary":"WIP'
    const segs = splitMessageWithTalorBlocks(text)
    const streamSeg = segs.find((s) => s.type === 'streaming-talor')
    expect(streamSeg).toBeDefined()
    expect(streamSeg?.streamingType).toBe('done')
    // 前置 markdown 仍然保留
    expect(segs[0].type).toBe('markdown')
    expect(segs[0].content).toContain('streaming')
  })

  it('未闭合 fence + type 尚未流到 → streamingType=null', () => {
    const text = 'preamble\n\n```talor\n{"summary":'
    const segs = splitMessageWithTalorBlocks(text)
    const streamSeg = segs.find((s) => s.type === 'streaming-talor')
    expect(streamSeg).toBeDefined()
    expect(streamSeg?.streamingType).toBeNull()
  })

  it('完整 block + 末尾未闭合 fence → 两段都存在', () => {
    const text =
      '```talor\n{"type":"warning","message":"a"}\n```\n\n' + '```talor\n{"type":"need_input"'
    const segs = splitMessageWithTalorBlocks(text)
    const talorSegs = segs.filter((s) => s.type === 'talor')
    const streamSegs = segs.filter((s) => s.type === 'streaming-talor')
    expect(talorSegs).toHaveLength(1)
    expect(talorSegs[0].block?.type).toBe('warning')
    expect(streamSegs).toHaveLength(1)
    expect(streamSegs[0].streamingType).toBe('need_input')
  })

  it('done block 解析后 block 字段完整', () => {
    const text = '```talor\n{"type":"done","summary":"全部完成","result":{"count":3}}\n```'
    const segs = splitMessageWithTalorBlocks(text)
    const blk = segs.find((s) => s.type === 'talor')?.block
    expect(blk).toBeDefined()
    expect(blk!.type).toBe('done')
    if (blk!.type === 'done') {
      expect(blk!.summary).toBe('全部完成')
      expect(blk!.result).toEqual({ count: 3 })
    }
  })

  it('need_input block + choices', () => {
    const text =
      '```talor\n' +
      '{"type":"need_input","question":"哪种货币?","choices":["港币","美元"]}\n' +
      '```'
    const segs = splitMessageWithTalorBlocks(text)
    const blk = segs.find((s) => s.type === 'talor')?.block
    expect(blk?.type).toBe('need_input')
    if (blk?.type === 'need_input') {
      expect(blk.choices).toEqual(['港币', '美元'])
    }
  })

  it('pending_confirm + risk_level=destructive', () => {
    const text =
      '```talor\n' +
      '{"type":"pending_confirm","summary":"DROP TABLE","risk_level":"destructive"}\n' +
      '```'
    const segs = splitMessageWithTalorBlocks(text)
    const blk = segs.find((s) => s.type === 'talor')?.block
    expect(blk?.type).toBe('pending_confirm')
    if (blk?.type === 'pending_confirm') {
      expect(blk.risk_level).toBe('destructive')
    }
  })
})
