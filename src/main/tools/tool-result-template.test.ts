import { describe, it, expect } from 'vitest'
import { buildToolResultGuide } from './tool-result-template'

describe('buildToolResultGuide', () => {
  describe('common guide (present for every tool)', () => {
    it('every guide starts with the common interpretation header', () => {
      for (const tool of ['bash', 'read', 'write', 'edit', 'ls', 'glob', 'grep', 'skill', 'mcp_foo']) {
        const g = buildToolResultGuide(tool)
        expect(g.startsWith('[How to interpret this result]')).toBe(true)
      }
    })

    it('every guide references the three outcome categories', () => {
      const g = buildToolResultGuide('bash')
      expect(g).toMatch(/SUCCESS/)
      expect(g).toMatch(/FAILURE/)
      expect(g).toMatch(/PARTIAL/)
    })

    it('common guide includes "do not retry same call with same inputs"', () => {
      const g = buildToolResultGuide('bash')
      expect(g).toMatch(/Do NOT retry the same call with the same[\s\S]+inputs/)
    })

    it('common guide tells model to stop calling tools on success (Principle 7 content)', () => {
      const g = buildToolResultGuide('bash')
      expect(g).toMatch(/report the result[\s\S]+stop calling tools/)
    })
  })

  describe('bash specifics', () => {
    const g = buildToolResultGuide('bash')
    it('contains bash-specific section', () => {
      expect(g).toMatch(/\[bash specifics\]/)
    })
    it('warns against inventing new field names (cmd/args/flags)', () => {
      expect(g).toMatch(/cmd\/args\/flags/)
    })
    it('warns against retrying interactive auth-login', () => {
      expect(g).toMatch(/NEVER retry interactive[\s\S]+auth-login/)
    })
    it('handles JSON "ok": false case', () => {
      expect(g).toMatch(/JSON "ok": false/)
      expect(g).toMatch(/missing_scope/)
    })
  })

  describe('skill specifics', () => {
    const g = buildToolResultGuide('skill')
    it('contains skill-specific section', () => {
      expect(g).toMatch(/\[skill specifics\]/)
    })
    it('recognizes [SKILL:<name> activated] as success signal', () => {
      expect(g).toMatch(/\[SKILL:<name> activated\]/)
    })
    it('tells model NOT to pre-read all prerequisite files', () => {
      expect(g).toMatch(/Do NOT pre-read every file/)
    })
    it('tells model NOT to re-activate an activated skill', () => {
      expect(g).toMatch(/Do NOT re-activate/)
    })
  })

  describe('read specifics', () => {
    const g = buildToolResultGuide('read')
    it('contains read-specific section', () => {
      expect(g).toMatch(/\[read specifics\]/)
    })
    it('guides relative-path failure → absolute path or ls/glob', () => {
      expect(g).toMatch(/relative.*absolute path/i)
      expect(g).toMatch(/glob or ls/)
    })
    it('handles binary-file case (use bash with binary tools)', () => {
      expect(g).toMatch(/Cannot read binary file/)
    })
  })

  describe('write specifics', () => {
    const g = buildToolResultGuide('write')
    it('contains write-specific section', () => {
      expect(g).toMatch(/\[write specifics\]/)
    })
    it('tells model NOT to re-read after write to "verify"', () => {
      expect(g).toMatch(/Do NOT re-read the file to "verify"/)
    })
  })

  describe('edit specifics', () => {
    const g = buildToolResultGuide('edit')
    it('guides "String not found" → read file first', () => {
      expect(g).toMatch(/String not found in file/)
      expect(g).toMatch(/Use read \(or grep\).*FIRST/s)
    })
  })

  describe('glob/grep specifics (empty != failure)', () => {
    const glob = buildToolResultGuide('glob')
    const grep = buildToolResultGuide('grep')
    it('glob: empty list is a fact, not failure', () => {
      expect(glob).toMatch(/EMPTY result is NOT a failure/)
    })
    it('grep: zero matches is a fact, not failure', () => {
      expect(grep).toMatch(/ZERO matches is NOT a failure/)
    })
    it('both warn against retrying same pattern', () => {
      expect(glob).toMatch(/Do NOT retry the same pattern/)
      expect(grep).toMatch(/Do NOT retry the same pattern/)
    })
  })

  describe('ls specifics', () => {
    const g = buildToolResultGuide('ls')
    it('contains ls-specific section', () => {
      expect(g).toMatch(/\[ls specifics\]/)
    })
  })

  describe('generic fallback for MCP / unknown tools', () => {
    it('unknown tool name falls back to generic guide', () => {
      const g = buildToolResultGuide('browser_navigate')
      expect(g).toMatch(/\[generic tool specifics\]/)
      expect(g).toMatch(/MCP or custom tool/)
    })

    it('generic guide covers JSON "ok" check + permission errors', () => {
      const g = buildToolResultGuide('random_mcp_tool')
      expect(g).toMatch(/JSON "ok": true/)
      expect(g).toMatch(/Permission \/ scope \/ authentication errors/)
    })
  })

  describe('no mixing: specific guide does not contain generic fallback marker', () => {
    it('bash guide does not contain generic marker', () => {
      expect(buildToolResultGuide('bash')).not.toMatch(/\[generic tool specifics\]/)
    })
    it('generic guide does not contain bash marker', () => {
      expect(buildToolResultGuide('some_mcp_tool')).not.toMatch(/\[bash specifics\]/)
    })
  })
})
