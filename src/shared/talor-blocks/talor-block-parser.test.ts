import { describe, it, expect } from 'vitest'
import { parseTalorBlocks, detectStreamingTalorType } from './talor-block-parser'

describe('parseTalorBlocks', () => {
  describe('成功路径', () => {
    it('解析单个 done block', () => {
      const text = '完成了。\n\n```talor\n{\n  "type": "done",\n  "summary": "已完成"\n}\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
      expect(invalid).toHaveLength(0)
      expect(blocks[0]).toEqual({ type: 'done', summary: '已完成' })
    })

    it('解析含 result 字段的 done block', () => {
      const text =
        '```talor\n{\n  "type": "done",\n  "summary": "OK",\n  "result": { "id": 4 }\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks).toEqual([{ type: 'done', summary: 'OK', result: { id: 4 } }])
    })

    it('解析 need_input block + choices 数组', () => {
      const text =
        '```talor\n{\n  "type": "need_input",\n  "question": "哪个?",\n  "choices": ["A", "B"]\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks[0]).toEqual({ type: 'need_input', question: '哪个?', choices: ['A', 'B'] })
    })

    it('解析 blocked block + can_retry', () => {
      const text =
        '```talor\n{\n  "type": "blocked",\n  "reason": "connection refused",\n  "can_retry": true,\n  "retry_hint": "重启服务"\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks[0]).toMatchObject({
        type: 'blocked',
        reason: 'connection refused',
        can_retry: true,
        retry_hint: '重启服务',
      })
    })

    it('解析 pending_confirm block + pattern + preview', () => {
      const text =
        '```talor\n{\n  "type": "pending_confirm",\n  "summary": "INSERT 1 row",\n  "pattern": "sql:INSERT:game.rule",\n  "preview": "INSERT INTO game.rule ..."\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks[0]).toMatchObject({
        type: 'pending_confirm',
        summary: 'INSERT 1 row',
        pattern: 'sql:INSERT:game.rule',
      })
    })

    it('解析 warning block + severity', () => {
      const text =
        '```talor\n{\n  "type": "warning",\n  "message": "DROP 不可撤销",\n  "severity": "high"\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks[0]).toEqual({ type: 'warning', message: 'DROP 不可撤销', severity: 'high' })
    })

    // v4 Phase 4a: pending_continuation block 退役 (替代为 request_continuation virtual tool)。
    // 老 session 含此 block 时 parser 归入 invalid (unknown-type),不再解析为 V1 block。
    it('legacy pending_continuation block (deprecated) → invalid (unknown-type)', () => {
      const text = '```talor\n{ "type": "pending_continuation" }\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid).toHaveLength(1)
      expect(invalid[0].reason).toContain('unknown-type')
    })

    it('多个 block 同一 stepText 全部提取', () => {
      const text = `
准备开始。

\`\`\`talor
{ "type": "warning", "message": "注意操作" }
\`\`\`

正在执行。

\`\`\`talor
{ "type": "pending_confirm", "summary": "INSERT 1 row", "pattern": "sql:INSERT:x" }
\`\`\`
      `
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(2)
      expect(invalid).toHaveLength(0)
      expect(blocks.map((b) => b.type)).toEqual(['warning', 'pending_confirm'])
    })
  })

  describe('JSONC 容错', () => {
    it('支持 // 注释', () => {
      const text = '```talor\n{\n  // 这是注释\n  "type": "done",\n  "summary": "OK"\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe('done')
    })

    it('支持 trailing comma', () => {
      const text = '```talor\n{\n  "type": "done",\n  "summary": "OK",\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
    })

    it('支持 /* 块注释 */', () => {
      const text =
        '```talor\n{\n  /* 多行\n   注释 */\n  "type": "done",\n  "summary": "OK"\n}\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
    })
  })

  describe('失败路径 (invalidBlocks 记录)', () => {
    it('JSON 语法错误 → jsonc-parse-error', () => {
      const text = '```talor\n{\n  "type": "done"\n  "summary": "missing comma"\n}\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid).toHaveLength(1)
      expect(invalid[0].reason).toBe('jsonc-parse-error')
    })

    it('解析结果是数组 → not-object', () => {
      const text = '```talor\n[1, 2, 3]\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid[0].reason).toBe('not-object')
    })

    it('缺 type 字段 → missing-type', () => {
      const text = '```talor\n{\n  "summary": "no type"\n}\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid[0].reason).toBe('missing-type')
    })

    it('未知 type → unknown-type', () => {
      const text = '```talor\n{\n  "type": "future_block_type",\n  "x": 1\n}\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid[0].reason).toMatch(/unknown-type/)
    })

    it('已知 type 但必填字段缺失 → field-validation', () => {
      const text = '```talor\n{\n  "type": "done"\n}\n```' // 缺 summary
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid[0].reason).toMatch(/field-validation/)
    })

    it('summary 字段为空字符串 → field-validation (lenient 防空)', () => {
      const text = '```talor\n{\n  "type": "done",\n  "summary": ""\n}\n```'
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(0)
      expect(invalid[0].reason).toMatch(/field-validation/)
    })

    it('混合: 部分 block 成功 + 部分失败', () => {
      const text = `
\`\`\`talor
{ "type": "done", "summary": "OK" }
\`\`\`

\`\`\`talor
{ "type": "bogus" }
\`\`\`
      `
      const { blocks, invalid } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
      expect(invalid).toHaveLength(1)
      expect(blocks[0].type).toBe('done')
    })
  })

  describe('无 block / 边界', () => {
    it('空 stepText → 空数组', () => {
      expect(parseTalorBlocks('')).toEqual({ blocks: [], invalid: [] })
    })

    it('纯文本无 talor block → 空数组', () => {
      expect(parseTalorBlocks('just some text without any blocks')).toEqual({
        blocks: [],
        invalid: [],
      })
    })

    it('其他 fenced block (非 talor) 不触发', () => {
      const text = '```ts\nconst x = 1\n```\n\n```json\n{"x": 1}\n```'
      expect(parseTalorBlocks(text)).toEqual({ blocks: [], invalid: [] })
    })

    it('fence tag 后多余空格仍支持', () => {
      const text = '```talor   \n{ "type": "done", "summary": "OK" }\n```'
      const { blocks } = parseTalorBlocks(text)
      expect(blocks).toHaveLength(1)
    })
  })
})

describe('detectStreamingTalorType', () => {
  it('完整 block 提取 type', () => {
    const text = '```talor\n{ "type": "done", "summary": "OK" }\n```'
    expect(detectStreamingTalorType(text)).toBe('done')
  })

  it('未闭合 fence + type 已流出 → 仍能提取', () => {
    const text = 'before\n```talor\n{ "type": "need_input", "ques'
    expect(detectStreamingTalorType(text)).toBe('need_input')
  })

  it('未闭合 fence + type 未流出 → null', () => {
    const text = '```talor\n{ "summary": "OK" }'
    expect(detectStreamingTalorType(text)).toBeNull()
  })

  it('多个 block: 返回最后一个 (即流式中的"当前块")', () => {
    const text =
      '```talor\n{ "type": "warning", "message": "..." }\n```\n\n```talor\n{ "type": "pending_confirm"'
    expect(detectStreamingTalorType(text)).toBe('pending_confirm')
  })

  it('完全无 block → null', () => {
    expect(detectStreamingTalorType('no blocks here')).toBeNull()
  })

  // v3.7.1: 位置无关 regression
  it('type 不在 first key (summary 在前) → 仍能识别', () => {
    const text = '```talor\n{ "summary": "OK", "type": "done" }\n```'
    expect(detectStreamingTalorType(text)).toBe('done')
  })

  it('未闭合 fence + summary 在前 + type 已流出 → 仍能识别', () => {
    const text = '```talor\n{ "summary": "preparing", "type": "need_input"'
    expect(detectStreamingTalorType(text)).toBe('need_input')
  })

  it('多字段乱序 + type 在末尾 → 仍能识别', () => {
    const text =
      '```talor\n{\n  "summary": "x",\n  "pattern": "sql:INSERT:t",\n  "type": "pending_confirm"\n}\n```'
    expect(detectStreamingTalorType(text)).toBe('pending_confirm')
  })
})
