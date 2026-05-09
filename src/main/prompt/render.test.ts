// src/main/prompt/render.test.ts
import { describe, it, expect } from 'vitest'
import { render } from './render'

describe('render — variable substitution', () => {
  it('replaces simple var', () => {
    expect(render('Hello {{name}}', { name: 'World' })).toBe('Hello World')
  })

  it('replaces nested path', () => {
    expect(render('{{user.name}}', { user: { name: 'X' } })).toBe('X')
  })

  it('undefined → empty string', () => {
    expect(render('A{{missing}}B', {})).toBe('AB')
  })

  it('undefined nested → empty string', () => {
    expect(render('{{a.b.c}}', { a: { b: undefined } })).toBe('')
  })

  it('strips comments', () => {
    expect(render('A{{!-- comment --}}B', {})).toBe('AB')
  })
})

describe('render — if blocks', () => {
  it('truthy renders body', () => {
    expect(render('{{#if x}}YES{{/if}}', { x: true })).toBe('YES')
  })

  it('falsy skips body', () => {
    expect(render('{{#if x}}YES{{/if}}', { x: false })).toBe('')
  })

  it('empty array is falsy', () => {
    expect(render('{{#if list}}YES{{/if}}', { list: [] })).toBe('')
  })

  it('non-empty array is truthy', () => {
    expect(render('{{#if list}}YES{{/if}}', { list: [1] })).toBe('YES')
  })

  it('string truthiness', () => {
    expect(render('{{#if s}}A{{/if}}', { s: '' })).toBe('')
    expect(render('{{#if s}}A{{/if}}', { s: 'x' })).toBe('A')
  })

  it('zero is falsy', () => {
    expect(render('{{#if n}}A{{/if}}', { n: 0 })).toBe('')
    expect(render('{{#if n}}A{{/if}}', { n: 1 })).toBe('A')
  })
})

describe('render — each blocks', () => {
  it('iterates list of strings', () => {
    expect(render('{{#each l}}-{{this}}{{/each}}', { l: ['a', 'b'] })).toBe('-a-b')
  })

  it('iterates list of objects with named field', () => {
    expect(
      render('{{#each items}}{{name}};{{/each}}', { items: [{ name: 'A' }, { name: 'B' }] }),
    ).toBe('A;B;')
  })

  it('@index_plus_1 available', () => {
    expect(render('{{#each l}}{{@index_plus_1}}.{{this}} {{/each}}', { l: ['x', 'y'] })).toBe(
      '1.x 2.y ',
    )
  })

  it('non-array → empty', () => {
    expect(render('{{#each l}}A{{/each}}', { l: null })).toBe('')
  })
})

describe('render — nested blocks', () => {
  it('if inside each', () => {
    const out = render('{{#each l}}{{#if x}}({{n}}){{/if}}{{/each}}', {
      l: [
        { x: true, n: 1 },
        { x: false, n: 2 },
        { x: true, n: 3 },
      ],
    })
    expect(out).toBe('(1)(3)')
  })

  it('each inside if', () => {
    const out = render('{{#if show}}{{#each l}}{{this}}{{/each}}{{/if}}', {
      show: true,
      l: ['a', 'b'],
    })
    expect(out).toBe('ab')
  })
})

describe('render — helpers', () => {
  it('helper with single arg', () => {
    const helpers = { upper: (s: unknown) => String(s).toUpperCase() }
    expect(render('{{upper name}}', { name: 'hi' }, helpers)).toBe('HI')
  })

  it('helper with multiple args', () => {
    const helpers = {
      join: (arr: unknown, sep: unknown) => (Array.isArray(arr) ? arr.join(String(sep)) : ''),
    }
    expect(render('{{join l ","}}', { l: ['a', 'b', 'c'] }, helpers)).toBe('a,b,c')
  })

  it('unknown helper renders empty', () => {
    expect(render('{{unknownHelper x}}', { x: 'a' })).toBe('')
  })
})
