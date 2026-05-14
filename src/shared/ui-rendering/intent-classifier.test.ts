import { describe, it, expect } from 'vitest'
import { inferIntent, __TEST__ } from './intent-classifier'

describe('inferIntent (v3.7 UI 渲染辅助)', () => {
  describe('need_input 推断', () => {
    it('中文问号 → need_input', () => {
      const r = inferIntent('目标市场是哪里?')
      expect(r.type).toBe('need_input')
      expect(r.confidence).toBeGreaterThanOrEqual(1.5)
      expect(r.signals).toContain('question-mark')
    })

    it('英文问号 → need_input', () => {
      const r = inferIntent('What is the target market?')
      expect(r.type).toBe('need_input')
    })

    it('斜杠列举 X / Y / Z → need_input', () => {
      const r = inferIntent('内地 / 香港 / 日本 或者其他')
      expect(r.type).toBe('need_input')
      expect(r.signals).toContain('slash-list')
    })

    it('"请告诉我" 请求语 → need_input', () => {
      const r = inferIntent('请告诉我你想要哪种奖品类型')
      expect(r.type).toBe('need_input')
      expect(r.signals).toContain('request-phrase')
    })

    it('"let me know" 英文请求语 → need_input', () => {
      const r = inferIntent('Let me know which option you prefer.')
      expect(r.type).toBe('need_input')
      expect(r.signals).toContain('request-phrase')
    })

    it('截图回归 step 1: 列 3 个问题 + 选项 → need_input', () => {
      const text =
        '所以重新来,我把需要你确认的列出来,你一个个回我就行:\n' +
        '① 目标市场是哪里? 比如:内地 / 香港 / 日本 / 东南亚 / 欧美? \n' +
        '② 奖品档次怎么分?'
      const r = inferIntent(text)
      expect(r.type).toBe('need_input')
      expect(r.confidence).toBeGreaterThan(2) // 多信号叠加
    })

    it('截图回归 step 2: "目标市场是哪里? 内地 / 香港 / 日本"', () => {
      const r = inferIntent('好的,那就一个一个来。\n目标市场是哪里?\n内地 / 香港 / 日本 / 东南亚')
      expect(r.type).toBe('need_input')
    })
  })

  describe('done 推断', () => {
    it('"已成功插入" → done', () => {
      const r = inferIntent('已成功插入 4 条规则配置')
      expect(r.type).toBe('done')
      expect(r.signals).toContain('completion-verb')
    })

    it('"completed" 英文 → done', () => {
      const r = inferIntent('Task completed. 4 rules inserted.')
      expect(r.type).toBe('done')
    })

    it('"all set" → done', () => {
      const r = inferIntent('All set, ready for the next request.')
      expect(r.type).toBe('done')
    })

    it('"以下是结果" 总结口吻 → done (弱信号叠加)', () => {
      const r = inferIntent('以下是查询结果,已完成所有 39 张表的扫描')
      expect(r.type).toBe('done')
    })

    it('"完成了但有问号" → 反信号扣分 → 不应误判为 done', () => {
      // "已完成。需要再做什么吗?" — done + ? 同时存在
      // 实际是模型问下一步, 应判 need_input (问号 2 分 vs done 关键词 2 分 + 反信号 -1.5 = 0.5)
      const r = inferIntent('已完成本步操作。需要再做什么吗?')
      expect(r.type).toBe('need_input')
    })
  })

  describe('blocked 推断', () => {
    it('"找不到表" → blocked', () => {
      const r = inferIntent('找不到 game.user 表,无法继续')
      expect(r.type).toBe('blocked')
      expect(r.signals).toContain('failure-keyword')
    })

    it('"cannot connect" 英文 → blocked', () => {
      const r = inferIntent('Cannot connect to the MySQL server.')
      expect(r.type).toBe('blocked')
    })

    it('"connection refused" 含错误词 → blocked', () => {
      const r = inferIntent('The query failed: connection refused.')
      expect(r.type).toBe('blocked')
    })

    it('blocked 句末问号 → 反信号扣分,改判 need_input', () => {
      // "找不到表,你想用哪个?" — failure + question
      // failure-keyword(+2) + trailing-question(-1) = 1 vs question-mark(2) + request(1.5)
      // need_input 更高 → 判 need_input
      const r = inferIntent('找不到 game.user 表,你想用哪个其他表?')
      expect(r.type).toBe('need_input')
    })
  })

  describe('阈值 / 假阴', () => {
    it('普通陈述无信号 → null', () => {
      const r = inferIntent('数据库是 game,有 39 张表。')
      expect(r.type).toBeNull()
      expect(r.confidence).toBe(0)
    })

    it('空字符串 → null', () => {
      expect(inferIntent('').type).toBeNull()
    })

    it('只有空白 → null', () => {
      expect(inferIntent('   \n\t  ').type).toBeNull()
    })

    it('弱信号但低于阈值 → null', () => {
      // "你看一下" 只命中第二人称 +0.3,低于阈值
      const r = inferIntent('你看一下')
      expect(r.type).toBeNull()
    })

    it('代码路径 /etc/foo/bar → 不误命中 slash-list', () => {
      const r = inferIntent('Config is at /etc/foo/bar.conf')
      expect(r.type).toBeNull()
    })

    it('SQL 含 LIKE %game% → 不误判', () => {
      const r = inferIntent('SELECT * FROM x WHERE name LIKE %game%')
      expect(r.type).toBeNull()
    })
  })

  describe('优先级 (同分时 need_input > done > blocked)', () => {
    it('同时含 done 关键词 + 问号 → need_input 胜', () => {
      // 这是同时触发: done(+2) + question(-1.5) = 0.5; need_input(+2) = 2
      // need_input 胜
      const r = inferIntent('已完成,接下来呢?')
      expect(r.type).toBe('need_input')
    })
  })

  describe('confidence 反映强度', () => {
    it('单一强信号 confidence 约 2', () => {
      const r = inferIntent('What now?')
      expect(r.confidence).toBeGreaterThanOrEqual(2)
    })

    it('多信号叠加 confidence 更高', () => {
      const r = inferIntent('请告诉我:A / B / C 选哪个?')
      // request(1.5) + slash-list(1.5) + question(2) = 5
      expect(r.confidence).toBeGreaterThanOrEqual(4)
    })
  })
})

describe('__TEST__.scoreIntent', () => {
  it('暴露常量 + 内部 helper', () => {
    expect(__TEST__.THRESHOLD).toBe(1.5)
    expect(__TEST__.SIGNALS).toHaveProperty('done')
    expect(__TEST__.SIGNALS).toHaveProperty('need_input')
    expect(__TEST__.SIGNALS).toHaveProperty('blocked')
  })
})
