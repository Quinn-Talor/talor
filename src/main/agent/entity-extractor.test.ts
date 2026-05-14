import { describe, it, expect } from 'vitest'
import { extractEntities, redactEntities } from './entity-extractor'

describe('extractEntities', () => {
  describe('Chinese names', () => {
    it('extracts 2-char Chinese name', () => {
      const r = extractEntities('搜索百度股价走势')
      const texts = r.map((e) => e.text)
      expect(texts).toContain('百度')
    })

    it('extracts 3-4 char Chinese names', () => {
      const r = extractEntities('为中际旭创和阿里巴巴写一首诗')
      const texts = r.map((e) => e.text)
      expect(texts).toContain('中际旭创')
      expect(texts).toContain('阿里巴巴')
    })

    it('filters common 2-char stopwords (allows few false positives at non-stopword boundaries)', () => {
      const r = extractEntities('我们这个使用工具来处理数据')
      const texts = r.map((e) => e.text)
      // 主要 stopword 都被过滤；regex-only NER 在中文连续块上无法零误伤,
      // 允许少量"夹缝"窗口被保留(如 "具来" / "来处" 介于 stopword 之间但本身不是)。
      expect(texts.length).toBeLessThanOrEqual(4)
      // 但典型 stopword 一定被过滤
      expect(texts).not.toContain('我们')
      expect(texts).not.toContain('使用')
      expect(texts).not.toContain('工具')
      expect(texts).not.toContain('处理')
      expect(texts).not.toContain('数据')
    })

    it('extracts the full 4-char entity along with substrings (overlapping window)', () => {
      // 重叠滑窗策略：返回 2-4 char 候选,下游用子串包含匹配,不依赖唯一性。
      const r = extractEntities('中际旭创')
      const texts = r.map((e) => e.text)
      expect(texts).toContain('中际旭创')
    })
  })

  describe('tickers', () => {
    it('extracts uppercase ticker codes', () => {
      const r = extractEntities('Buy BIDU and TSLA at the open')
      const texts = r.map((e) => e.text)
      expect(texts).toContain('BIDU')
      expect(texts).toContain('TSLA')
    })

    it('filters technical acronyms (HTTP/JSON/API)', () => {
      const r = extractEntities('Use the HTTP JSON API to fetch data')
      const texts = r.map((e) => e.text)
      expect(texts).not.toContain('HTTP')
      expect(texts).not.toContain('JSON')
      expect(texts).not.toContain('API')
    })

    it('extracts ticker with exchange suffix', () => {
      const r = extractEntities('Hold BIDU.US for long term')
      expect(r.map((e) => e.text)).toContain('BIDU.US')
    })
  })

  describe('stock codes', () => {
    it('extracts 6-digit stock codes with exchange', () => {
      const r = extractEntities('Stock 300308.SZ closed up 5%')
      const codes = r.filter((e) => e.category === 'stock-code').map((e) => e.text)
      expect(codes).toContain('300308.SZ')
    })

    it('does not double-count stock-code as ticker', () => {
      const r = extractEntities('300308.SZ today')
      const tickers = r.filter((e) => e.category === 'ticker')
      expect(tickers.length).toBe(0)
    })
  })

  describe('paths', () => {
    it('extracts absolute file paths', () => {
      const r = extractEntities('Read the file at /tmp/report.txt now')
      const paths = r.filter((e) => e.category === 'path').map((e) => e.text)
      expect(paths).toContain('/tmp/report.txt')
    })

    it('does not match single-segment paths like / or /tmp', () => {
      // PATH_RE 要求至少 2 个段
      const r = extractEntities('Just /tmp here')
      const paths = r.filter((e) => e.category === 'path')
      expect(paths.length).toBe(0)
    })
  })

  describe('deduplication', () => {
    it('returns each unique entity only once', () => {
      const r = extractEntities('百度 again 百度 and BIDU then BIDU')
      const cnNames = r.filter((e) => e.category === 'cn-name')
      const tickers = r.filter((e) => e.category === 'ticker')
      expect(cnNames.length).toBe(1)
      expect(tickers.length).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('returns empty array for empty input', () => {
      expect(extractEntities('')).toEqual([])
    })

    it('returns empty array for purely generic text', () => {
      expect(extractEntities('hello world this is plain text')).toEqual([])
    })
  })
})

// v3.7.2: extractEntitySet 测试组删除 — function 已删除

describe('redactEntities', () => {
  it('replaces Chinese names with <COMPANY_*> placeholders', () => {
    const { redacted, mapping } = redactEntities('为中际旭创写一首诗')
    expect(redacted).not.toContain('中际旭创')
    expect(redacted).toMatch(/<COMPANY_[A-Z0-9]+>/)
    expect(Object.values(mapping)).toContain('中际旭创')
  })

  it('replaces tickers with <TICKER_*>', () => {
    const { redacted } = redactEntities('Buy BIDU and TSLA')
    expect(redacted).not.toContain('BIDU')
    expect(redacted).not.toContain('TSLA')
    expect(redacted).toContain('<TICKER_A>')
    expect(redacted).toContain('<TICKER_B>')
  })

  it('uses long-first replacement to avoid partial matches', () => {
    const { redacted } = redactEntities('中际旭创和中际')
    // "中际旭创" 4字应整体替换，不能让 "中际" 先替换破坏 4 字串
    expect(redacted).not.toContain('中际旭创')
    expect(redacted).toMatch(/<COMPANY_[A-Z0-9]+>/)
  })

  it('removes all specific entities (over-masking is acceptable for D1 purpose)', () => {
    // regex-only NER 不能精确切词,可能连带屏蔽周围内容。D1 的核心目标是让
    // crystallizer 看不到具体实体,过度屏蔽不会造成正确性问题(只是上下文减少)。
    const { redacted, mapping } = redactEntities('为百度写一首诗')
    expect(redacted).not.toContain('百度')
    // 至少有一个 placeholder
    expect(redacted).toMatch(/<COMPANY_/)
    // mapping 含原始实体（具体哪个被分配 placeholder 取决于排序）
    const allMapped = Object.values(mapping)
    expect(allMapped.some((v) => v.includes('百度'))).toBe(true)
  })

  it('returns same text when no entities', () => {
    const { redacted, mapping } = redactEntities('hello world')
    expect(redacted).toBe('hello world')
    expect(Object.keys(mapping).length).toBe(0)
  })
})
