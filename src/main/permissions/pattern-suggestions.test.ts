import { describe, it, expect } from 'vitest'
import { homedir } from 'os'
import { suggestBashPatterns, suggestPathPatterns } from './pattern-suggestions'

describe('suggestBashPatterns', () => {
  describe('readonly binaries', () => {
    it('ls gives exact + same-binary', () => {
      const s = suggestBashPatterns('ls -la /tmp')
      expect(s.map(x => x.id)).toEqual(['exact', 'same_binary'])
      expect(s[0].pattern).toBe('^ls -la /tmp$')
      expect(s[1].pattern).toBe('^ls( .*)?$')
    })

    it('cat gives same-binary', () => {
      const s = suggestBashPatterns('cat foo.txt')
      expect(s.map(x => x.id)).toContain('same_binary')
    })
  })

  describe('subcommand-based binaries', () => {
    it('git log gives exact + same-subcommand', () => {
      const s = suggestBashPatterns('git log --oneline -20')
      expect(s.map(x => x.id)).toEqual(['exact', 'same_subcommand'])
      expect(s[1].pattern).toBe('^git log( .*)?$')
      expect(s[1].label).toMatch(/git log/)
    })

    it('npm test only falls back to exact when no subcommand present', () => {
      const s = suggestBashPatterns('npm')
      expect(s.map(x => x.id)).toEqual(['exact'])
    })

    it('docker run gives same-subcommand', () => {
      const s = suggestBashPatterns('docker run --rm alpine ls')
      const same = s.find(x => x.id === 'same_subcommand')
      expect(same?.pattern).toBe('^docker run( .*)?$')
    })

    it('skips flag tokens when identifying subcommand', () => {
      const s = suggestBashPatterns('git --no-pager log')
      // the subcommand picker skips tokens starting with '-'
      const same = s.find(x => x.id === 'same_subcommand')
      expect(same?.pattern).toBe('^git log( .*)?$')
    })
  })

  describe('danger binaries', () => {
    it.each(['rm -rf /tmp/x', 'sudo ls', 'curl https://foo.com', 'chmod 777 x'])(
      'only gives exact for %s',
      (cmd) => {
        const s = suggestBashPatterns(cmd)
        expect(s.map(x => x.id)).toEqual(['exact'])
      },
    )
  })

  describe('unknown binary → default danger', () => {
    it('my-custom-script only gets exact', () => {
      const s = suggestBashPatterns('my-custom-script --flag')
      expect(s.map(x => x.id)).toEqual(['exact'])
    })
  })

  describe('complex syntax → downgrade to exact', () => {
    it.each([
      'cat a.txt | grep foo',
      'ls && pwd',
      'ls; pwd',
      'ls > out.txt',
      'echo $(whoami)',
      'echo `whoami`',
      'FOO=bar npm test',
    ])('downgrades "%s" to exact only', (cmd) => {
      const s = suggestBashPatterns(cmd)
      expect(s.map(x => x.id)).toEqual(['exact'])
    })
  })

  it('exact pattern is anchored and regex-escaped', () => {
    const s = suggestBashPatterns('ls /tmp/foo.bar')
    const exact = s[0]
    expect(exact.pattern).toBe('^ls /tmp/foo\\.bar$')
    // '.' must be escaped
    expect(exact.pattern).not.toMatch(/[^\\]\./)
  })
})

describe('suggestPathPatterns', () => {
  const home = homedir()

  it('Desktop path gives exact + parent + top', () => {
    const s = suggestPathPatterns(`${home}/Desktop/reports/q1.md`)
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir', 'top_dir'])
    expect(s[0].pattern).toBe(`${home}/Desktop/reports/q1.md`)
    expect(s[1].pattern).toBe(`${home}/Desktop/reports/`)
    expect(s[2].pattern).toBe(`${home}/Desktop/`)
  })

  it('Desktop root file: parent==top_dir, only 2 suggestions', () => {
    const s = suggestPathPatterns(`${home}/Desktop/foo.md`)
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir'])
  })

  it('/tmp path gives exact + /tmp/', () => {
    const s = suggestPathPatterns('/tmp/x.log')
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir'])
    expect(s[1].pattern).toBe('/tmp/')
  })

  it('/private/tmp also classified as tmp', () => {
    const s = suggestPathPatterns('/private/tmp/foo')
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir'])
  })

  it('other_home path: exact + parent, no top', () => {
    const s = suggestPathPatterns(`${home}/myproject/src/index.ts`)
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir'])
    expect(s[1].pattern).toBe(`${home}/myproject/src/`)
  })

  it('/usr path: exact + parent', () => {
    const s = suggestPathPatterns('/usr/local/share/man/man1/foo.1')
    expect(s.map(x => x.id)).toEqual(['exact', 'parent_dir'])
  })

  it('unclassified path (/Volumes/...) gives only exact', () => {
    const s = suggestPathPatterns('/Volumes/ExternalDisk/data.csv')
    expect(s.map(x => x.id)).toEqual(['exact'])
  })

  it('parent_dir pattern always ends with /', () => {
    const samples = [
      `${home}/Desktop/a/b.md`,
      `${home}/myproj/foo.ts`,
      '/tmp/x',
      '/usr/local/foo',
    ]
    for (const p of samples) {
      const s = suggestPathPatterns(p)
      const parent = s.find(x => x.id === 'parent_dir')
      expect(parent?.pattern.endsWith('/')).toBe(true)
    }
  })
})
