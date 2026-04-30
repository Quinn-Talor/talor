import { describe, it, expect } from 'vitest'
import { checkSchema, type SchemaParams } from './schema-check'

const params: SchemaParams = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 50 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    mode: { type: 'string', enum: ['read', 'write', 'append'] },
    email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
    tags: { type: 'array' },
    score: { type: 'number', minimum: 0 },
  },
}

describe('checkSchema', () => {
  it('returns null for valid input', () => {
    expect(
      checkSchema('t', params, { name: 'alice', age: 30, mode: 'read', email: 'a@b', tags: ['x'], score: 1.5 }),
    ).toBeNull()
  })

  it('skips fields that are absent (required check is a different phase)', () => {
    expect(checkSchema('t', params, { name: 'alice' })).toBeNull()
  })

  it('rejects wrong type for optional field', () => {
    const msg = checkSchema('t', params, { name: 'alice', age: 'thirty' })
    expect(msg).toMatch(/^Invalid type for "age"/)
    expect(msg).toContain('expected integer')
  })

  it('rejects non-integer number when type=integer', () => {
    const msg = checkSchema('t', params, { name: 'a', age: 3.14 })
    expect(msg).toMatch(/expected integer/)
  })

  it('rejects value not in enum', () => {
    const msg = checkSchema('t', params, { name: 'a', mode: 'execute' })
    expect(msg).toMatch(/^Invalid value for "mode"/)
    expect(msg).toContain('"read"')
    expect(msg).toContain('"execute"')
  })

  it('rejects string shorter than minLength', () => {
    const msg = checkSchema('t', params, { name: '' })
    expect(msg).toMatch(/"name" on "t" too short/)
  })

  it('rejects string longer than maxLength', () => {
    const msg = checkSchema('t', params, { name: 'x'.repeat(100) })
    expect(msg).toMatch(/"name" on "t" too long/)
  })

  it('rejects value failing pattern', () => {
    const msg = checkSchema('t', params, { name: 'a', email: 'invalid-email' })
    expect(msg).toMatch(/does not match pattern/)
  })

  it('rejects number below minimum', () => {
    const msg = checkSchema('t', params, { name: 'a', age: -1 })
    expect(msg).toMatch(/"age" on "t" too small/)
  })

  it('rejects number above maximum', () => {
    const msg = checkSchema('t', params, { name: 'a', age: 999 })
    expect(msg).toMatch(/"age" on "t" too large/)
  })

  it('rejects non-array when type=array', () => {
    const msg = checkSchema('t', params, { name: 'a', tags: 'not-array' })
    expect(msg).toMatch(/expected array/)
  })

  it('skips invalid regex in schema gracefully', () => {
    const bad: SchemaParams = {
      properties: { s: { type: 'string', pattern: '[invalid(regex' } },
    }
    expect(checkSchema('t', bad, { s: 'anything' })).toBeNull()
  })

  it('handles undefined input', () => {
    expect(checkSchema('t', params, undefined)).toBeNull()
  })

  it('handles null properties gracefully', () => {
    expect(checkSchema('t', {}, { x: 1 })).toBeNull()
  })

  it('allows enum with numeric values', () => {
    const p: SchemaParams = { properties: { n: { type: 'number', enum: [1, 2, 3] } } }
    expect(checkSchema('t', p, { n: 2 })).toBeNull()
    expect(checkSchema('t', p, { n: 4 })).toMatch(/^Invalid value for "n"/)
  })
})
