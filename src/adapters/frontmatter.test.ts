import { describe, expect, it } from 'vitest'
import { parse, stringify } from './frontmatter'

describe('frontmatter parse', () => {
  it('returns body unchanged when no fence is present', () => {
    const result = parse('plain body\nsecond line')
    expect(result.hadFrontmatter).toBe(false)
    expect(result.data).toEqual({})
    expect(result.body).toBe('plain body\nsecond line')
  })

  it('parses YAML frontmatter and trims leading blank lines from body', () => {
    const text = '---\nname: foo\ntags: [a, b]\n---\n\nbody here'
    const result = parse<{ name: string; tags: string[] }>(text)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.data.name).toBe('foo')
    expect(result.data.tags).toEqual(['a', 'b'])
    expect(result.body).toBe('body here')
  })

  it('tolerates BOM and leading whitespace before opening fence', () => {
    const text = '﻿\n  ---\nx: 1\n---\nbody'
    const result = parse<{ x: number }>(text)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.data.x).toBe(1)
    expect(result.body).toBe('body')
  })

  it('handles CRLF line endings', () => {
    const text = '---\r\nname: foo\r\n---\r\nbody'
    const result = parse<{ name: string }>(text)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.data.name).toBe('foo')
    expect(result.body).toBe('body')
  })

  it('returns empty data for malformed YAML rather than throwing', () => {
    const text = '---\n: : : invalid : :\n---\nbody'
    const result = parse(text)
    expect(result.hadFrontmatter).toBe(true)
    expect(result.data).toEqual({})
    expect(result.body).toBe('body')
  })
})

describe('frontmatter stringify', () => {
  it('emits fenced YAML and body', () => {
    const out = stringify({ name: 'foo', count: 2 }, 'body text')
    expect(out).toContain('---\n')
    expect(out).toContain('name: foo')
    expect(out).toContain('count: 2')
    expect(out.endsWith('body text')).toBe(true)
  })

  it('omits null, undefined, empty arrays, and empty objects', () => {
    const out = stringify(
      { keep: 1, dropNull: null, dropUndef: undefined, dropArr: [], dropObj: {} },
      'body',
    )
    expect(out).toContain('keep: 1')
    expect(out).not.toContain('dropNull')
    expect(out).not.toContain('dropUndef')
    expect(out).not.toContain('dropArr')
    expect(out).not.toContain('dropObj')
  })

  it('returns body alone when nothing survives cleaning', () => {
    expect(stringify({ a: null, b: [] }, 'just body')).toBe('just body')
  })

  it('round-trips through parse', () => {
    const data = { name: 'foo', tags: ['x', 'y'] }
    const body = 'hello world'
    const text = stringify(data, body)
    const back = parse<typeof data>(text)
    expect(back.data).toEqual(data)
    expect(back.body).toBe(body)
  })
})
