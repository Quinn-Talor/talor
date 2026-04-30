import { describe, it, expect } from 'vitest'
import { verifyQuotedFacts } from './quote-verifier'

describe('verifyQuotedFacts', () => {
  it('keeps long quote that exists verbatim in tool outputs', () => {
    const tool = 'The server responded with "authentication token expired, please login again"'
    const summary = 'Task failed: "authentication token expired, please login again"'
    const r = verifyQuotedFacts(summary, [tool])
    expect(r.unverifiedCount).toBe(0)
    expect(r.cleaned).toBe(summary)
  })

  it('replaces fabricated long quote with ⟨unverifiable⟩', () => {
    const tool = 'File written: /tmp/report.txt (120 bytes)'
    const summary = 'The tool reported: "all 42 records inserted successfully into the database"'
    const r = verifyQuotedFacts(summary, [tool])
    expect(r.unverifiedCount).toBe(1)
    expect(r.cleaned).toContain('⟨unverifiable⟩')
    expect(r.cleaned).not.toContain('42 records inserted')
  })

  it('does not touch short quotes (below threshold)', () => {
    const summary = 'Wrote "ok" and "done"'
    const r = verifyQuotedFacts(summary, [])
    expect(r.unverifiedCount).toBe(0)
    expect(r.cleaned).toBe(summary)
  })

  it('handles multiple quotes (some valid, some fabricated)', () => {
    const tool = 'error: unable to connect to the remote repository origin'
    const summary =
      'Two things happened: "unable to connect to the remote repository origin" and ' +
      '"the local working tree was fully reset to initial state".'
    const r = verifyQuotedFacts(summary, [tool])
    expect(r.unverifiedCount).toBe(1)
    expect(r.cleaned).toContain('unable to connect to the remote repository origin')
    expect(r.cleaned).toContain('⟨unverifiable⟩')
  })

  it('matches despite whitespace differences (newlines / extra spaces)', () => {
    const tool = 'line one\nline two with   extra   spaces   here okay'
    const summary = 'Captured: "line one line two with extra spaces here okay"'
    const r = verifyQuotedFacts(summary, [tool])
    expect(r.unverifiedCount).toBe(0)
  })

  it('supports backtick quotes', () => {
    const tool = 'installed package express-middleware-v2 successfully'
    const summary = 'The log said `installed package express-middleware-v2 successfully`'
    const r = verifyQuotedFacts(summary, [tool])
    expect(r.unverifiedCount).toBe(0)
  })

  it('replaces when tool output list is empty (no source → unverifiable)', () => {
    const summary = 'Confirmation: "the deployment completed without any warnings reported"'
    const r = verifyQuotedFacts(summary, [])
    expect(r.unverifiedCount).toBe(1)
    expect(r.cleaned).toContain('⟨unverifiable⟩')
  })

  it('handles empty input gracefully', () => {
    expect(verifyQuotedFacts('', ['anything'])).toEqual({ cleaned: '', unverifiedCount: 0 })
  })

  it('does not match cross-line quotes (opening " without closing on same line)', () => {
    // 现实中跨行引用极罕见;避免误伤长段落里的孤立引号。
    const summary = 'He said: "first half\nsecond half"'
    const r = verifyQuotedFacts(summary, [])
    // 不会被 QUOTE_RE 匹配上(\n 禁止),因此不算作引用,不替换
    expect(r.unverifiedCount).toBe(0)
    expect(r.cleaned).toBe(summary)
  })
})
